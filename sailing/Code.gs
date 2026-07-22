/**
 * Sailing · Wee센터 상담기록 자동화 시스템 v1.0 (Apps Script 웹앱)
 *
 * 원칙:
 * - 상담일지 전용 DB를 만들지 않음
 * - 새 노션 페이지를 만들지 않음
 * - 기존 캘린더(Database) 예약 페이지만 업데이트
 *
 * 스크립트 속성 (프로젝트 설정 → 스크립트 속성):
 *   NOTION_TOKEN
 *   NOTION_DATABASE_ID
 *   OPENAI_API_KEY
 *   OPENAI_MODEL (선택, 기본 gpt-4o-mini)
 */

var CONFIG = {
  // 상담 타이머와 동일한 예약 캘린더 DB (원본). 연결 DB(linked) ID는 API 불가.
  NOTION_DATABASE_ID: '1ad1b959-3ca0-8187-bc50-e94e057f408d',
  PROP_DATE: 'Date',
  PROP_CASE: '케이스번호', // DB 열 이름이 '사례번호'면 여기만 수정
  PROP_TYPE: '유형',
  PROP_CATEGORY: '일정 구분',
  PROP_PLACE: '장소',
  PROP_NOTE: '비고',
  PROP_CONTACT: '연락처',
  PROP_URL: 'URL',
  CATEGORY_FILTER: '상담', // 일정 구분에 '상담' 포함만
  OPENAI_MODEL: 'gpt-4o-mini',
  NOTION_VERSION: '2022-06-28'
};

// ── 웹앱 ──

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Sailing · 상담기록')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

function getHealth() {
  var missing = [];
  if (!getNotionToken_()) missing.push('NOTION_TOKEN');
  if (!getDatabaseId_()) missing.push('NOTION_DATABASE_ID');
  if (!getOpenAiKey_()) missing.push('OPENAI_API_KEY');
  return {
    ok: missing.length === 0,
    missing: missing,
    version: '1.0.0',
    name: 'Wee센터 상담기록 자동화 시스템'
  };
}

function testNotionConnection() {
  var token = getNotionToken_();
  if (!token) return { ok: false, message: '스크립트 속성에 NOTION_TOKEN이 없습니다.' };
  var dbId = getDatabaseId_();
  if (!dbId) return { ok: false, message: 'NOTION_DATABASE_ID가 없습니다.' };

  var res = notionFetch_('databases/' + dbId);
  var code = res.getResponseCode();
  var body = JSON.parse(res.getContentText());
  if (code === 200) {
    return {
      ok: true,
      message: '노션 연결 성공! DB: ' + ((body.title && body.title[0]) ? body.title[0].plain_text : '캘린더'),
      properties: Object.keys(body.properties || {})
    };
  }
  var msg = body.message || res.getContentText();
  if (String(msg).indexOf('linked database') !== -1) {
    msg += ' → 상담기록 등 연결 DB ID가 아닌, 상담 타이머와 같은 원본 예약 캘린더 DB ID를 쓰세요.';
  }
  return { ok: false, message: '연결 실패 (' + code + '): ' + msg };
}

/** 실행 로그에 결과 출력 (함수 선택 후 실행) */
function testNotionConnectionLog() {
  var r = testNotionConnection();
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

/** 오늘(또는 date=YYYY-MM-DD) 상담 예약 */
function getSchedules(dateStr) {
  try {
    ensureNotion_();
    var range = getDayRange_(dateStr);
    var pages = queryDatabase_({
      and: [
        { property: CONFIG.PROP_DATE, date: { on_or_after: range.start } },
        { property: CONFIG.PROP_DATE, date: { before: range.end } }
      ]
    }, [{ property: CONFIG.PROP_DATE, direction: 'ascending' }]);

    var schedules = [];
    for (var i = 0; i < pages.length; i++) {
      var item = parsePage_(pages[i]);
      if (!item) continue;
      if (CONFIG.CATEGORY_FILTER && item.category.indexOf(CONFIG.CATEGORY_FILTER) === -1) continue;
      schedules.push(item);
    }
    return { ok: true, date: range.start, schedules: schedules };
  } catch (e) {
    return { ok: false, error: String(e.message || e), schedules: [] };
  }
}

/** 학생·사례번호 검색 */
function searchStudents(query) {
  try {
    ensureNotion_();
    var q = String(query || '').trim();
    if (!q) return { ok: true, students: [] };

    var titleProp = getTitlePropertyName_();
    var pages = [];
    try {
      pages = queryDatabase_({
        or: [
          { property: titleProp, title: { contains: q } },
          { property: CONFIG.PROP_CASE, rich_text: { contains: q } }
        ]
      }, [{ property: CONFIG.PROP_DATE, direction: 'descending' }]);
    } catch (e1) {
      pages = queryDatabase_(
        { property: titleProp, title: { contains: q } },
        [{ property: CONFIG.PROP_DATE, direction: 'descending' }]
      );
    }

    var seen = {};
    var students = [];
    for (var i = 0; i < pages.length; i++) {
      var item = parsePage_(pages[i]);
      if (!item) continue;
      if (CONFIG.CATEGORY_FILTER && item.category.indexOf(CONFIG.CATEGORY_FILTER) === -1) continue;
      var key = item.caseNo + '|' + item.title;
      if (seen[key]) continue;
      seen[key] = true;
      students.push({
        title: item.title,
        caseNo: item.caseNo,
        type: item.type,
        latestPageId: item.pageId,
        latestDate: item.startISO,
        latestCategory: item.category
      });
      if (students.length >= 30) break;
    }
    return { ok: true, students: students };
  } catch (e) {
    return { ok: false, error: String(e.message || e), students: [] };
  }
}

/** 회기·이전 회기 컨텍스트 */
function getSessionContext(pageId) {
  try {
    ensureNotion_();
    var current = getPageById_(pageId);
    if (!current) return { ok: false, error: '예약을 파싱할 수 없습니다.' };

    var previous = getPreviousSessions_(current.caseNo, current.title, current.startISO, pageId);
    var sessionNumber = estimateSessionNumber_(previous);

    var previousSummary = '';
    if (previous.length > 0) {
      try {
        previousSummary = getPagePlainText_(previous[0].pageId).substring(0, 3500);
      } catch (e2) {
        previousSummary = '';
      }
    }

    var prevList = [];
    for (var i = 0; i < Math.min(5, previous.length); i++) {
      var s = previous[i];
      prevList.push({
        pageId: s.pageId,
        title: s.title,
        dateLabel: s.dateLabel,
        timeRangeLabel: s.timeRangeLabel,
        category: s.category,
        url: s.url
      });
    }

    return {
      ok: true,
      current: current,
      sessionNumber: sessionNumber,
      sessionLabel: sessionNumber + '회기',
      previousCount: previous.length,
      previous: prevList,
      previousSummary: previousSummary
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/** AI 미리보기 (노션 미수정) */
function previewRecords(payload) {
  try {
    var built = buildGenerationContext_(payload || {});
    var generated = generateWithOpenAI_(built.ctx);
    return {
      ok: true,
      current: built.meta.current,
      sessionNumber: built.meta.sessionNumber,
      sessionLabel: built.meta.sessionLabel,
      previousCount: built.meta.previousCount,
      journal: generated.journal,
      memo: generated.memo,
      model: generated.model
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

/**
 * 저장: AI 작성(또는 전달된 텍스트) → 기존 예약 페이지 본문 append
 */
function saveRecords(payload) {
  try {
    payload = payload || {};
    var pageId = payload.pageId;
    if (!pageId) return { ok: false, error: 'pageId가 필요합니다.' };

    var journal = String(payload.journal || '').trim();
    var memo = String(payload.memo || '').trim();
    var built = buildGenerationContext_(payload);

    if (!journal || !memo) {
      var generated = generateWithOpenAI_(built.ctx);
      journal = journal || generated.journal;
      memo = memo || generated.memo;
    }

    var updated = updateReservationPage_(pageId, journal, memo);
    return {
      ok: true,
      message: '기존 예약 페이지에 상담일지·상담자 메모를 추가했습니다.',
      current: built.meta.current,
      sessionNumber: built.meta.sessionNumber,
      sessionLabel: built.meta.sessionLabel,
      previousCount: built.meta.previousCount,
      journal: journal,
      memo: memo,
      notionUrl: updated.url,
      pageId: updated.pageId
    };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}

// ── 생성 컨텍스트 ──

function buildGenerationContext_(body) {
  var pageId = body.pageId;
  var keywords = String(body.keywords || '').trim();
  if (!pageId) throw new Error('pageId가 필요합니다.');
  if (!keywords) throw new Error('키워드 메모를 입력해 주세요.');

  ensureNotion_();
  var current = getPageById_(pageId);
  if (!current) throw new Error('예약을 파싱할 수 없습니다.');

  var previous = getPreviousSessions_(current.caseNo, current.title, current.startISO, pageId);
  var estimated = body.sessionNumber || estimateSessionNumber_(previous);
  var label = body.sessionLabel || (estimated + '회기');

  var previousSummary = '';
  if (previous.length > 0) {
    try {
      previousSummary = getPagePlainText_(previous[0].pageId).substring(0, 3500);
    } catch (e) {
      previousSummary = '';
    }
  }

  var duration = current.durationMin != null ? current.durationMin + '분' : '';
  var autoDatetime = body.datetimeLabel || (
    current.startLabel
      ? current.dateLabel + ' ' + current.timeRangeLabel + (duration ? ', 소요시간 ' + duration : '')
      : current.dateLabel
  );

  return {
    ctx: {
      sessionLabel: label,
      caseNo: current.caseNo,
      name: body.name || current.title,
      gender: body.gender || '',
      school: body.school || '',
      gradeClass: body.gradeClass || '',
      target: body.target || '학생',
      datetimeLabel: autoDatetime,
      place: body.place || current.place || '',
      category: current.category,
      type: current.type,
      keywords: keywords,
      extraInfo: body.extraInfo || '',
      previousSummary: previousSummary
    },
    meta: {
      current: current,
      sessionNumber: estimated,
      sessionLabel: label,
      previousCount: previous.length
    }
  };
}

// ── OpenAI ──

var SYSTEM_PROMPT_ = [
  '당신은 학교 Wee센터 전문상담교사를 돕는 상담기록 작성 보조 AI입니다.',
  '',
  '반드시 지킬 규칙:',
  '1. 사용자가 입력한 키워드·메모만 바탕으로 작성한다. 추측하지 않는다.',
  '2. 제공되지 않은 내용은 작성하지 않는다. 빈칸으로 두거나 해당 항목을 생략한다.',
  '3. 상담자가 실제 수행한 활동만 기록한다.',
  '4. 키워드를 자연스러운 문장으로 정리하되, 사실을 보태지 않는다.',
  '5. 차회상담계획, 내담자 과제, 차회 상담목표, 차회활동, 유의사항, 준비물은 정보가 있을 때만 작성한다.',
  '6. 이전 회기 본문이 주어지면 흐름을 이어 쓰되, 이전 내용을 그대로 복사하지 않는다.',
  '7. 출력은 반드시 JSON 한 객체만. 설명문·마크다운 코드펜스 금지.',
  '',
  'JSON 스키마:',
  '{ "journal": "상담일지 전체 텍스트", "memo": "상담자 메모 전체 텍스트" }',
  '',
  '상담일지 양식(항목 순서 유지):',
  '회기 : …',
  '사례번호 :',
  '이름 :',
  '성별 :',
  '',
  '학교명 :',
  '학년/반 :',
  '',
  '대상 : (학생 / 보호자 / 교사)',
  '',
  '일시 :',
  '(YYYY.MM.DD.(요일) HH:MM~HH:MM, 소요시간 ○○분)',
  '',
  '장소 :',
  '',
  '내용',
  '',
  '1. 내담자 관찰',
  '',
  '2. 내담자 행동',
  '',
  '3. 상담활동',
  '',
  '4. 차회상담계획',
  '(필요한 경우만 작성)',
  '',
  '5. 내담자 과제',
  '(필요한 경우만 작성)',
  '',
  '6. 기타사항',
  '',
  '상담자 메모 양식:',
  '○회기',
  '',
  '사례번호 :',
  '이름 :',
  '성별 :',
  '',
  '학교명 :',
  '학년/반 :',
  '',
  '일시',
  'YYYY.MM.DD.(요일) ○교시 또는 HH:MM~HH:MM (○○분)',
  '',
  '상담내용',
  '',
  '상담자 의견',
  '',
  '차회일시',
  '○회기',
  'YYYY.MM.DD.(요일)',
  '',
  '차회 상담목표',
  '',
  '차회활동',
  '',
  '유의사항',
  '',
  '준비물',
  '',
  '※ 차회 정보가 없으면 해당 항목은 생략 가능'
].join('\n');

function buildUserPrompt_(ctx) {
  var lines = [
    '[메타데이터 — 사실로 사용]',
    '회기: ' + (ctx.sessionLabel || ''),
    '사례번호: ' + (ctx.caseNo || ''),
    '이름: ' + (ctx.name || ''),
    '성별: ' + (ctx.gender || ''),
    '학교명: ' + (ctx.school || ''),
    '학년/반: ' + (ctx.gradeClass || ''),
    '대상: ' + (ctx.target || '학생'),
    '일시: ' + (ctx.datetimeLabel || ''),
    '장소: ' + (ctx.place || ''),
    '일정 구분: ' + (ctx.category || ''),
    '유형: ' + (ctx.type || ''),
    '',
    '[상담자 키워드 메모]',
    ctx.keywords || '(없음)'
  ];
  if (ctx.extraInfo) {
    lines.push('', '[추가 정보]', ctx.extraInfo);
  }
  if (ctx.previousSummary) {
    lines.push('', '[이전 회기 참고 — 흐름만 이어쓰기]', ctx.previousSummary);
  }
  lines.push(
    '',
    '위 정보를 바탕으로 journal(상담일지)과 memo(상담자 메모)를 JSON으로 작성하세요.',
    '메타데이터에 값이 비어 있으면 해당 칸은 비워 두세요. 임의로 채우지 마세요.'
  );
  return lines.join('\n');
}

function generateWithOpenAI_(ctx) {
  var key = getOpenAiKey_();
  if (!key) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.');
  var model = getOpenAiModel_();

  var payload = {
    model: model,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_ },
      { role: 'user', content: buildUserPrompt_(ctx) }
    ]
  };

  var res = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = JSON.parse(res.getContentText());
  if (code < 200 || code >= 300) {
    throw new Error('OpenAI 오류 (' + code + '): ' + (body.error && body.error.message ? body.error.message : res.getContentText()));
  }

  var raw = (body.choices && body.choices[0] && body.choices[0].message)
    ? body.choices[0].message.content
    : '{}';
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error('OpenAI 응답을 JSON으로 파싱하지 못했습니다.');
  }

  var journal = String(parsed.journal || '').trim();
  var memo = String(parsed.memo || '').trim();
  if (!journal || !memo) throw new Error('OpenAI 응답에 journal 또는 memo가 비어 있습니다.');

  return { journal: journal, memo: memo, model: model };
}

// ── Notion ──

function ensureNotion_() {
  if (!getNotionToken_()) throw new Error('NOTION_TOKEN이 없습니다. 스크립트 속성을 설정하세요.');
  if (!getDatabaseId_()) throw new Error('NOTION_DATABASE_ID가 없습니다.');
}

function getNotionToken_() {
  return PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN') || '';
}

function getDatabaseId_() {
  return CONFIG.NOTION_DATABASE_ID ||
    PropertiesService.getScriptProperties().getProperty('NOTION_DATABASE_ID') || '';
}

function getOpenAiKey_() {
  return PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '';
}

function getOpenAiModel_() {
  return PropertiesService.getScriptProperties().getProperty('OPENAI_MODEL') || CONFIG.OPENAI_MODEL;
}

function notionFetch_(endpoint, method, payload) {
  var options = {
    method: method || 'get',
    headers: {
      Authorization: 'Bearer ' + getNotionToken_(),
      'Notion-Version': CONFIG.NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);
  return UrlFetchApp.fetch('https://api.notion.com/v1/' + endpoint, options);
}

function queryDatabase_(filter, sorts) {
  var results = [];
  var cursor = null;
  do {
    var body = {
      filter: filter,
      sorts: sorts || [],
      page_size: 100
    };
    if (cursor) body.start_cursor = cursor;
    var res = notionFetch_('databases/' + getDatabaseId_() + '/query', 'post', body);
    var code = res.getResponseCode();
    var data = JSON.parse(res.getContentText());
    if (code !== 200) throw new Error(data.message || '노션 조회 실패 (' + code + ')');
    results = results.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

var cachedTitleProp_ = null;
function getTitlePropertyName_() {
  if (cachedTitleProp_) return cachedTitleProp_;
  var res = notionFetch_('databases/' + getDatabaseId_());
  var body = JSON.parse(res.getContentText());
  var props = body.properties || {};
  for (var name in props) {
    if (props[name].type === 'title') {
      cachedTitleProp_ = name;
      return name;
    }
  }
  cachedTitleProp_ = '이름';
  return cachedTitleProp_;
}

function getPageById_(pageId) {
  var res = notionFetch_('pages/' + pageId);
  var code = res.getResponseCode();
  var body = JSON.parse(res.getContentText());
  if (code !== 200) throw new Error(body.message || '페이지 조회 실패');
  return parsePage_(body);
}

function parsePage_(page) {
  var props = page.properties || {};
  var dateInfo = parseNotionDate_(props[CONFIG.PROP_DATE]);
  if (!dateInfo) return null;

  var category = getSelect_(props, CONFIG.PROP_CATEGORY);
  var title = getTitle_(props);
  var place = getRichText_(props, CONFIG.PROP_PLACE) || getSelect_(props, CONFIG.PROP_PLACE);

  return {
    pageId: page.id,
    url: page.url,
    title: title,
    caseNo: getRichText_(props, CONFIG.PROP_CASE),
    type: getSelect_(props, CONFIG.PROP_TYPE),
    category: category,
    place: place,
    note: getRichText_(props, CONFIG.PROP_NOTE),
    contact: getRichText_(props, CONFIG.PROP_CONTACT),
    externalUrl: getRichText_(props, CONFIG.PROP_URL),
    startISO: dateInfo.startISO,
    endISO: dateInfo.endISO,
    startHasTime: dateInfo.startHasTime,
    dateLabel: dateInfo.dateLabel,
    startLabel: dateInfo.startLabel,
    endLabel: dateInfo.endLabel,
    durationMin: dateInfo.durationMin,
    timeRangeLabel: dateInfo.timeRangeLabel,
    displayLabel: (dateInfo.startLabel || '—') + ' ' + title
  };
}

function parseNotionDate_(dateProp) {
  if (!dateProp || !dateProp.date || !dateProp.date.start) return null;
  var startRaw = dateProp.date.start;
  var endRaw = dateProp.date.end || null;
  var startHasTime = startRaw.indexOf('T') !== -1;
  var endHasTime = endRaw ? endRaw.indexOf('T') !== -1 : false;

  var start = new Date(startRaw);
  var end = endRaw ? new Date(endRaw) : null;
  if (!end && startHasTime) end = new Date(start.getTime() + 40 * 60 * 1000);

  var durationMin = (end && startHasTime)
    ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
    : null;

  var dateLabel = start.getFullYear() + '.' + pad2_(start.getMonth() + 1) + '.' + pad2_(start.getDate()) +
    '.(' + weekdayKo_(start) + ')';
  var startLabel = startHasTime ? pad2_(start.getHours()) + ':' + pad2_(start.getMinutes()) : '';
  var endLabel = (end && (endHasTime || startHasTime))
    ? pad2_(end.getHours()) + ':' + pad2_(end.getMinutes())
    : '';

  return {
    startISO: startRaw,
    endISO: endRaw,
    startHasTime: startHasTime,
    dateLabel: dateLabel,
    startLabel: startLabel,
    endLabel: endLabel,
    durationMin: durationMin,
    timeRangeLabel: (startLabel && endLabel) ? (startLabel + '~' + endLabel) : (startLabel || '종일')
  };
}

function getPreviousSessions_(caseNo, title, beforeISO, excludePageId) {
  var filters = [];
  if (caseNo) {
    filters.push({ property: CONFIG.PROP_CASE, rich_text: { equals: caseNo } });
  } else if (title) {
    filters.push({ property: getTitlePropertyName_(), title: { equals: title } });
  } else {
    return [];
  }
  if (beforeISO) {
    filters.push({ property: CONFIG.PROP_DATE, date: { before: String(beforeISO).substring(0, 10) } });
  }

  var pages = [];
  try {
    pages = queryDatabase_({ and: filters }, [{ property: CONFIG.PROP_DATE, direction: 'descending' }]);
  } catch (e) {
    if (caseNo && !isNaN(Number(caseNo))) {
      var numFilters = [
        { property: CONFIG.PROP_CASE, number: { equals: Number(caseNo) } }
      ];
      if (beforeISO) {
        numFilters.push({ property: CONFIG.PROP_DATE, date: { before: String(beforeISO).substring(0, 10) } });
      }
      pages = queryDatabase_({ and: numFilters }, [{ property: CONFIG.PROP_DATE, direction: 'descending' }]);
    }
  }

  var sessions = [];
  for (var i = 0; i < pages.length; i++) {
    if (excludePageId && pages[i].id === excludePageId) continue;
    var item = parsePage_(pages[i]);
    if (!item) continue;
    if (CONFIG.CATEGORY_FILTER && item.category.indexOf(CONFIG.CATEGORY_FILTER) === -1) continue;
    sessions.push(item);
  }
  return sessions;
}

function getPagePlainText_(pageId) {
  var lines = [];
  var cursor = null;
  do {
    var endpoint = 'blocks/' + pageId + '/children?page_size=100';
    if (cursor) endpoint += '&start_cursor=' + encodeURIComponent(cursor);
    var res = notionFetch_(endpoint);
    var data = JSON.parse(res.getContentText());
    if (res.getResponseCode() !== 200) break;
    var results = data.results || [];
    for (var i = 0; i < results.length; i++) {
      var t = extractBlockText_(results[i]);
      if (t) lines.push(t);
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return lines.join('\n');
}

function extractBlockText_(block) {
  var type = block.type;
  var data = block[type];
  if (!data || !data.rich_text) return '';
  var t = '';
  for (var i = 0; i < data.rich_text.length; i++) t += data.rich_text[i].plain_text;
  if (type.indexOf('heading') === 0) return '\n## ' + t;
  if (type === 'bulleted_list_item' || type === 'numbered_list_item') return '• ' + t;
  return t;
}

function estimateSessionNumber_(previousSessions) {
  var maxFromText = 0;
  var limit = Math.min(3, previousSessions.length);
  for (var i = 0; i < limit; i++) {
    try {
      var text = getPagePlainText_(previousSessions[i].pageId);
      var re = /(\d+)\s*회기/g;
      var m;
      while ((m = re.exec(text)) !== null) {
        maxFromText = Math.max(maxFromText, Number(m[1]));
      }
    } catch (e) {}
  }
  return Math.max(previousSessions.length + 1, maxFromText + 1, 1);
}

function updateReservationPage_(pageId, journalText, memoText) {
  var children = [];
  children.push({ object: 'block', type: 'divider', divider: {} });
  children.push(heading2_('상담일지'));
  children = children.concat(textToParagraphBlocks_(journalText));
  children.push({ object: 'block', type: 'divider', divider: {} });
  children.push(heading2_('상담자 메모'));
  children = children.concat(textToParagraphBlocks_(memoText));

  var chunks = chunk_(children, 90);
  for (var i = 0; i < chunks.length; i++) {
    var res = notionFetch_('blocks/' + pageId + '/children', 'post', { children: chunks[i] });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      var body = JSON.parse(res.getContentText());
      throw new Error(body.message || '페이지 업데이트 실패 (' + code + ')');
    }
  }

  var pageRes = notionFetch_('pages/' + pageId);
  var page = JSON.parse(pageRes.getContentText());
  return { pageId: pageId, url: page.url };
}

function heading2_(text) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: text } }] }
  };
}

function textToParagraphBlocks_(text) {
  var lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  var blocks = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].length ? lines[i] : ' ';
    var parts = splitByLength_(line, 1900);
    for (var j = 0; j < parts.length; j++) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: parts[j] } }] }
      });
    }
  }
  if (!blocks.length) {
    blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [] } });
  }
  return blocks;
}

// ── 유틸 ──

function getDayRange_(dateStr) {
  var y, m, d;
  if (dateStr) {
    var parts = String(dateStr).split('-');
    y = Number(parts[0]);
    m = Number(parts[1]);
    d = Number(parts[2]);
  } else {
    var now = new Date();
    var seoul = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd').split('-');
    y = Number(seoul[0]);
    m = Number(seoul[1]);
    d = Number(seoul[2]);
  }
  var start = y + '-' + pad2_(m) + '-' + pad2_(d);
  var next = new Date(Date.UTC(y, m - 1, d + 1));
  var end = next.getUTCFullYear() + '-' + pad2_(next.getUTCMonth() + 1) + '-' + pad2_(next.getUTCDate());
  return { start: start, end: end };
}

function getTitle_(props) {
  for (var key in props) {
    if (props[key].type === 'title' && props[key].title) {
      return props[key].title.map(function (t) { return t.plain_text; }).join('');
    }
  }
  return '(제목 없음)';
}

function getRichText_(props, name) {
  var p = props[name];
  if (!p) return '';
  if (p.type === 'rich_text') return (p.rich_text || []).map(function (t) { return t.plain_text; }).join('');
  if (p.type === 'number') return p.number != null ? String(p.number) : '';
  if (p.type === 'url') return p.url || '';
  if (p.type === 'phone_number') return p.phone_number || '';
  return '';
}

function getSelect_(props, name) {
  var p = props[name];
  if (!p) return '';
  if (p.type === 'select' && p.select) return p.select.name;
  if (p.type === 'status' && p.status) return p.status.name;
  if (p.type === 'multi_select' && p.multi_select) {
    return p.multi_select.map(function (s) { return s.name; }).join(', ');
  }
  return '';
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function weekdayKo_(date) {
  return ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
}

function splitByLength_(str, max) {
  var out = [];
  for (var i = 0; i < str.length; i += max) out.push(str.substring(i, i + max));
  return out.length ? out : [str];
}

function chunk_(arr, size) {
  var out = [];
  for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Sailing · Wee센터 상담기록 자동화 시스템 v1.0 (Apps Script 웹앱)
 *
 * 원칙:
 * - 상담일지 전용 DB를 만들지 않음
 * - 새 노션 페이지를 만들지 않음
 * - 기존 캘린더(Database) 예약 페이지만 업데이트
 *
 * 스크립트 속성 (프로젝트 설정 → 스크립트 속성):
 *   NOTION_TOKEN          ← 필수
 *   OPENAI_API_KEY        ← 필수
 *   OPENAI_MODEL          ← 선택 (기본 gpt-4o-mini)
 *   NOTION_DATABASE_ID    ← 선택 (비우면 아래 CONFIG 값 사용)
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
  if (!getOpenAiKey_()) missing.push('OPENAI_API_KEY');
  // DB ID는 CONFIG 기본값이 있으면 OK (스크립트 속성 없어도 됨)
  var dbId = getDatabaseId_();
  if (!dbId) missing.push('NOTION_DATABASE_ID(Code.gs CONFIG 또는 스크립트 속성)');
  return {
    ok: missing.length === 0,
    missing: missing,
    databaseId: dbId ? (dbId.substring(0, 8) + '…') : '',
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

    var updated = updateReservationPage_(pageId, journal, memo, built.meta.sessionLabel || payload.sessionLabel);
    return {
      ok: true,
      message: '기존 예약 페이지에 상담일지·상담자 메모 토글을 추가했습니다.',
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
      period: body.period || '',
      // 상담일지 「장소」는 캘린더 「일정 구분」을 사용
      place: current.category || body.place || '',
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
  '당신은 학교 Wee센터 전문상담교사의 상담기록 작성 보조입니다.',
  '목표는 “예쁘게 쓴 글”이 아니라, 상담자가 남긴 키워드를 사실 그대로 정리한 실무 기록입니다.',
  '',
  '【상담일지 작성 요령 — 공공기록물 기준】',
  '1. 상담일지는 공공기록물 기준에 맞게 객관적·구체적으로 작성한다.',
  '2. 내담자 발언은 가능한 한 직접 표현을 유지한다. (키워드에 나온 말·표현을 바꾸거나 미화하지 않는다.)',
  '3. 관찰 사실과 상담자 해석을 구분한다. 상담일지(journal)에는 상담자 해석·평가·추측·소감을 넣지 않는다.',
  '4. 상담일지의 「장소-」에는 반드시 제공된 「일정 구분」 값을 쓴다. (장소 속성이 따로 있어도 일정 구분을 우선한다.)',
  '',
  '【절대 규칙】',
  '1. 키워드·메타데이터·추가정보에 있는 사실만 쓴다. 추측·해석·감정 평가·일반론을 넣지 않는다.',
  '2. 키워드에 없는 관찰(“적극적”, “주저함 없음”, “창의력”, “상상력”, “인상적” 등)을 만들어내지 않는다.',
  '3. 정보가 없는 항목은 “(해당 내용 없음)” “없음” “-” 같은 문구로 채우지 말고, 그 항목 자체를 생략한다.',
  '4. 문장은 짧게. 같은 내용을 상담일지와 상담자 메모에서 길게 반복하지 않는다.',
  '5. 키워드를 자연스러운 문장으로 바꾸되, 사실·활동·말을 보태지 않는다. 키워드에 나온 고유명사·활동명·내담자 발언은 유지한다.',
  '6. 차회 일정·목표·활동·유의사항·준비물·과제는 키워드/추가정보에 있을 때만 쓴다.',
  '7. 상담자 의견·해석은 상담자 메모(memo)에만, 키워드에 의견·소감이 있을 때만 쓴다. 상담일지에는 넣지 않는다.',
  '8. 이전 회기 참고가 있어도 복사하지 말고, 이번 키워드와 직접 이어지는 흐름만 한 줄 이내로 반영한다.',
  '9. 출력은 JSON 한 객체만. 코드펜스·설명문 금지.',
  '',
  '【문체】',
  '- 학교 상담일지체: 간결한 서술형, 과장·문학체·상담이론 용어 남발 금지.',
  '- 초등 저학년 기록도 마찬가지. 활동·말·계획을 사실적으로.',
  '- “~한 것으로 보임”, “~로 추측됨”, “~한 듯함”, “~로 여겨짐” 등 해석·추측 표현 금지(특히 상담일지).',
  '',
  'JSON:',
  '{ "journal": "상담일지 전체 텍스트", "memo": "상담자 메모 전체 텍스트" }',
  '',
  '【상담일지 양식 — 아래 형식만 사용. 사례번호·이름·학교 등 인적사항 헤더는 넣지 말 것】',
  '※ 노션에는 「상담일지: n회기」 토글 제목으로 들어가므로, journal 본문 첫 줄에 「상담일지: n회기」를 또 쓰지 말고 아래부터 시작한다.',
  '※ 상담일지에는 관찰 사실·행동·활동·발언만. 상담자 해석·평가·소감 금지.',
  '',
  '일시- YYYY.MM.DD.(요일) n교시(소요시간 ○○분)',
  '※ 교시 정보가 없으면: YYYY.MM.DD.(요일) HH:MM~HH:MM(소요시간 ○○분)',
  '',
  '장소- (일정 구분 값만. 없으면 이 줄 생략)',
  '',
  '내담자 관찰',
  '- 외견, 표정, 말투, 태도 등 객관적 관찰 내용만 기술',
  '- 키워드에 해당 단서가 있을 때만. 해석·평가 금지. 없으면 항목 전체 생략',
  '',
  '내담자 행동',
  '- 내담자가 직접 언급한 내용 (가능한 한 직접 표현 유지)',
  '- 상담 중 나타난 행동',
  '- 사실 중심, 6하원칙(누가·언제·어디서·무엇을·어떻게·왜 — 키워드에 있는 범위만)에 따라 기술',
  '- 키워드에 단서가 있을 때만. 없으면 항목 전체 생략',
  '',
  '상담활동',
  '- 상담 중 실시한 활동',
  '- 놀이, 활동지, 그림, 검사, 상담기법 등',
  '- 키워드·추가정보에 사진·첨부 자료 언급이 있으면 반영 가능 (없으면 지어내지 말 것)',
  '- 키워드에 활동 단서가 있을 때만. 없으면 항목 전체 생략',
  '',
  '차회상담계획',
  '- ※ 제공된 경우에만 작성. 없으면 항목 전체 생략',
  '',
  '내담자 과제',
  '- ※ 제공된 경우에만 작성. 없으면 항목 전체 생략',
  '',
  '기타사항',
  '- ※ 제공된 경우에만 작성. 없으면 항목 전체 생략',
  '',
  '※ 각 본문 항목은 불릿(- )으로 쓴다. “(해당 내용 없음)” 금지.',
  '※ 키워드를 위 세 항목(관찰/행동/활동)에 맞게 분류해 넣고, 근거 없는 항목은 생략.',
  '',
  '【상담자 메모 양식 — 값 없는 선택 항목 생략】',
  '※ 노션에는 「상담자 메모: n회기」 토글 제목으로 들어가므로, memo 본문 첫 줄에 회기 제목만 또 쓰지 말고 본문부터 시작한다.',
  '※ 상담자 해석·의견은 여기(memo)의 「상담자 의견」에만, 키워드에 있을 때 작성.',
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
  '(이번 회기 핵심만 3~6문장. 일지 복붙 금지. 발언은 직접 표현 유지)',
  '',
  '상담자 의견',
  '(키워드에 의견·해석이 있을 때만)',
  '',
  '차회일시',
  '',
  '차회 상담목표',
  '',
  '차회활동',
  '',
  '유의사항',
  '',
  '준비물'
].join('\n');

function buildUserPrompt_(ctx) {
  var journalPlace = ctx.place || ctx.category || '';
  var lines = [
    '[메타데이터]',
    '회기: ' + (ctx.sessionLabel || ''),
    '사례번호: ' + (ctx.caseNo || '') + ' (상담자 메모에만 사용. 상담일지 헤더에는 넣지 말 것)',
    '이름: ' + (ctx.name || '') + ' (상담자 메모에만)',
    '성별: ' + (ctx.gender || '') + ' (상담자 메모에만)',
    '학교명: ' + (ctx.school || '') + ' (상담자 메모에만)',
    '학년/반: ' + (ctx.gradeClass || '') + ' (상담자 메모에만)',
    '대상: ' + (ctx.target || '학생'),
    '일시: ' + (ctx.datetimeLabel || ''),
    '교시: ' + (ctx.period || '') + ' (있으면 상담일지 일시에 n교시로 표기)',
    '일정 구분: ' + (ctx.category || ''),
    '장소(상담일지용·일정 구분 값): ' + journalPlace,
    '유형: ' + (ctx.type || ''),
    '',
    '[상담자 키워드 메모 — 이것만 사실 근거]',
    ctx.keywords || '(없음)',
    '',
    '작성 지시:',
    '- 상담일지 journal: 공공기록물 기준(객관·구체). 상담자 해석 금지.',
    '- 내담자 관찰: 외견·표정·말투·태도 등 객관 관찰만.',
    '- 내담자 행동: 직접 언급(직접 표현 유지) + 상담 중 행동. 사실·6하원칙.',
    '- 상담활동: 실시한 활동(놀이·활동지·그림·검사·기법 등). 사진·첨부 언급 있으면 반영.',
    '- 상담일지 「장소-」에는 「장소(상담일지용·일정 구분 값)」만 사용.',
    '- 상담일지 journal: 일시-/장소-/불릿 본문. 첫 줄에 「상담일지: n회기」를 쓰지 말 것(토글 제목으로 들어감).',
    '- 상담자 메모 memo: 인적·상담내용 등. 해석·의견은 memo에만. 첫 줄 회기 제목만 따로 쓰지 말 것(토글 제목으로 들어감).',
    '- 키워드에 없는 관찰·평가·감정을 추가하지 말 것.',
    '- “(해당 내용 없음)”을 쓰지 말 것. 없는 항목은 아예 빼 것.',
    '- journal과 memo를 JSON으로 작성.'
  ];
  if (ctx.extraInfo) {
    lines.push('', '[추가 정보 — 사실로만 사용]', ctx.extraInfo);
  }
  if (ctx.previousSummary) {
    lines.push(
      '',
      '[이전 회기 참고 — 필요 시 흐름 1줄만. 복사 금지]',
      ctx.previousSummary
    );
  }
  return lines.join('\n');
}

function generateWithOpenAI_(ctx) {
  var key = getOpenAiKey_();
  if (!key) {
    throw new Error(
      'OPENAI_API_KEY가 설정되지 않았습니다. Apps Script → 프로젝트 설정 → 스크립트 속성에 OPENAI_API_KEY를 추가하세요.'
    );
  }
  var model = getOpenAiModel_();

  var payload = {
    model: model,
    temperature: 0.15,
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
    var apiMsg = body.error && body.error.message ? body.error.message : res.getContentText();
    throw new Error('OpenAI 오류 (' + code + '): ' + apiMsg);
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

/**
 * OpenAI 키 연결 테스트 (저장/미리보기 전 확인용)
 * 실행 후 보기 → 로그 또는 반환값 확인
 */
function testOpenAIConnection() {
  var key = getOpenAiKey_();
  if (!key) {
    return {
      ok: false,
      message: '스크립트 속성에 OPENAI_API_KEY가 없습니다. 프로젝트 설정 → 스크립트 속성에 추가하세요.'
    };
  }
  var model = getOpenAiModel_();
  var payload = {
    model: model,
    temperature: 0,
    max_tokens: 16,
    messages: [
      { role: 'user', content: 'Reply with exactly: OK' }
    ]
  };

  try {
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
      var apiMsg = body.error && body.error.message ? body.error.message : res.getContentText();
      return {
        ok: false,
        message: 'OpenAI 연결 실패 (' + code + '): ' + apiMsg,
        hint: '키 오타, 만료, 결제/크레딧, 또는 속성 이름 오타(OPENAI_API_KEY)를 확인하세요.',
        keyPrefix: String(key).substring(0, 7) + '…',
        model: model
      };
    }
    return {
      ok: true,
      message: 'OpenAI 연결 성공!',
      model: model,
      keyPrefix: String(key).substring(0, 7) + '…'
    };
  } catch (e) {
    return { ok: false, message: 'OpenAI 테스트 오류: ' + String(e.message || e) };
  }
}

function testOpenAIConnectionLog() {
  var r = testOpenAIConnection();
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

// ── Notion ──

function ensureNotion_() {
  if (!getNotionToken_()) throw new Error('NOTION_TOKEN이 없습니다. 스크립트 속성을 설정하세요.');
  if (!getDatabaseId_()) throw new Error('NOTION_DATABASE_ID가 없습니다.');
}

function getNotionToken_() {
  return String(PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN') || '').trim();
}

function getDatabaseId_() {
  // Code.gs CONFIG 기본값 우선 (잘못된 스크립트 속성 linked DB ID로 덮이지 않게)
  var raw = String(
    CONFIG.NOTION_DATABASE_ID ||
    PropertiesService.getScriptProperties().getProperty('NOTION_DATABASE_ID') ||
    ''
  ).trim();
  return normalizeNotionId_(raw);
}

function getOpenAiKey_() {
  return String(PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '').trim();
}

function getOpenAiModel_() {
  var m = String(PropertiesService.getScriptProperties().getProperty('OPENAI_MODEL') || CONFIG.OPENAI_MODEL || 'gpt-4o-mini').trim();
  return m || 'gpt-4o-mini';
}

/**
 * Notion ID/URL → API용 UUID (하이픈 포함)
 * Invalid request URL 은 ID가 깨졌을 때 자주 발생
 */
function normalizeNotionId_(raw) {
  if (!raw) return '';
  var s = String(raw).trim();

  // 전체 URL이 들어온 경우: 마지막 path의 32자 hex 추출
  var urlMatch = s.match(/([0-9a-fA-F]{32})/);
  if (urlMatch) {
    s = urlMatch[1];
  }

  s = s.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(s)) {
    return String(raw).trim(); // 그대로 두고 API가 에러 내게 (디버깅용)
  }
  return (
    s.substring(0, 8) + '-' +
    s.substring(8, 12) + '-' +
    s.substring(12, 16) + '-' +
    s.substring(16, 20) + '-' +
    s.substring(20)
  );
}

function notionFetch_(endpoint, method, payload) {
  var options = {
    method: (method || 'get').toLowerCase(),
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
  pageId = normalizeNotionId_(pageId);
  if (!pageId) throw new Error('pageId가 비어 있습니다.');
  var res = notionFetch_('pages/' + pageId);
  var code = res.getResponseCode();
  var body = JSON.parse(res.getContentText());
  if (code !== 200) {
    throw new Error('페이지 조회 실패: ' + (body.message || res.getContentText()));
  }
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
  pageId = normalizeNotionId_(pageId);
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

function updateReservationPage_(pageId, journalText, memoText, sessionLabel) {
  pageId = normalizeNotionId_(pageId);
  if (!pageId) throw new Error('pageId가 비어 있습니다.');

  var label = formatSessionLabel_(sessionLabel);
  var journalTitle = '상담일지: ' + label;
  var memoTitle = '상담자 메모: ' + label;

  // 토글 제목과 본문 첫 줄 중복 방지
  var journalBody = stripLeadingTitleLine_(journalText, ['상담일지:']);
  var memoBody = stripLeadingTitleLine_(memoText, ['상담자 메모:', '상담자메모:']);

  // 1) 토글 껍데기만 추가 → 2) 각 토글 안에 본문 append (중첩·100블록 한도 안전)
  var shellRes = notionFetch_('blocks/' + pageId + '/children', 'patch', {
    children: [
      { object: 'block', type: 'divider', divider: {} },
      toggleBlock_(journalTitle),
      toggleBlock_(memoTitle)
    ]
  });
  var shellCode = shellRes.getResponseCode();
  if (shellCode < 200 || shellCode >= 300) {
    var shellBody = {};
    try { shellBody = JSON.parse(shellRes.getContentText()); } catch (e1) {}
    var shellMsg = shellBody.message || shellRes.getContentText() || ('토글 생성 실패 (' + shellCode + ')');
    if (String(shellMsg).toLowerCase().indexOf('invalid request url') !== -1) {
      shellMsg += ' (pageId=' + pageId + ') — 예약 페이지 ID·Integration 연결을 확인하세요.';
    }
    throw new Error(shellMsg);
  }

  var created = [];
  try { created = JSON.parse(shellRes.getContentText()).results || []; } catch (e2) {}
  var toggles = [];
  for (var i = 0; i < created.length; i++) {
    if (created[i].type === 'toggle') toggles.push(created[i]);
  }
  if (toggles.length < 2) {
    throw new Error('상담일지/상담자 메모 토글을 만들지 못했습니다.');
  }

  appendBlocksInChunks_(toggles[0].id, textToParagraphBlocks_(journalBody));
  appendBlocksInChunks_(toggles[1].id, textToParagraphBlocks_(memoBody));

  var pageRes = notionFetch_('pages/' + pageId);
  var page = JSON.parse(pageRes.getContentText());
  return { pageId: pageId, url: page.url, journalToggleId: toggles[0].id, memoToggleId: toggles[1].id };
}

function formatSessionLabel_(sessionLabel) {
  var s = String(sessionLabel || '').trim();
  if (!s) return '1회기';
  if (/회기/.test(s)) return s;
  if (/^\d+$/.test(s)) return s + '회기';
  return s;
}

function stripLeadingTitleLine_(text, prefixes) {
  var lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  while (lines.length && !String(lines[0]).trim()) lines.shift();
  if (!lines.length) return '';
  var first = String(lines[0]).trim();
  for (var i = 0; i < prefixes.length; i++) {
    if (first.indexOf(prefixes[i]) === 0) {
      lines.shift();
      while (lines.length && !String(lines[0]).trim()) lines.shift();
      break;
    }
  }
  return lines.join('\n');
}

function toggleBlock_(title) {
  return {
    object: 'block',
    type: 'toggle',
    toggle: {
      rich_text: [{ type: 'text', text: { content: String(title || '').substring(0, 2000) } }]
    }
  };
}

function appendBlocksInChunks_(parentId, blocks) {
  parentId = normalizeNotionId_(parentId);
  var chunks = chunk_(blocks, 90);
  for (var i = 0; i < chunks.length; i++) {
    var res = notionFetch_('blocks/' + parentId + '/children', 'patch', { children: chunks[i] });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      var body = {};
      try { body = JSON.parse(res.getContentText()); } catch (e) {}
      throw new Error(body.message || res.getContentText() || ('블록 추가 실패 (' + code + ')'));
    }
  }
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

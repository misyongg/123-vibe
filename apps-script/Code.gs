/**
 * 상담 타이머 - 노션 + 구글 시트 연동
 *
 * 설정 방법: docs/NOTION-연동-가이드.md 참고
 */

// ── 노션 DB 설정 (속성 이름은 본인 DB에 맞게 수정) ──
var CONFIG = {
  NOTION_DATABASE_ID: '1ad1b959-3ca0-8187-bc50-e94e057f408d',
  PROP_DATE: 'Date',           // 일정 날짜 속성명 (예: Date, 일정, 날짜)
  PROP_CASE: '케이스번호',      // 상담케이스 번호 속성명
  PROP_TYPE: '유형',           // (선택) 초등/중등/고등/학부모
  SHEET_NAME: '상담기록',
  TITLE_FILTER: '상담',        // 제목에 포함된 일정만 표시 (비우면 전체)
};

var DURATION_MAP = {
  '초등': 40, '초등학생': 40,
  '중등': 45, '중학생': 45,
  '고등': 50, '고등학생': 50,
  '학부모': 30
};

// ── 웹앱 ──

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Timer')
    .setTitle('상담 타이머')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
}

// ── 8단계: 노션 연결 테스트 ──

function testNotionConnection() {
  var token = getToken_();
  if (!token) {
    return { ok: false, message: '스크립트 속성에 NOTION_TOKEN이 없습니다.' };
  }

  var res = notionFetch_('databases/' + CONFIG.NOTION_DATABASE_ID);
  var code = res.getResponseCode();
  var body = JSON.parse(res.getContentText());

  if (code === 200) {
    return {
      ok: true,
      message: '노션 연결 성공! DB: ' + (body.title && body.title[0] ? body.title[0].plain_text : '일정표'),
      properties: Object.keys(body.properties || {})
    };
  }

  return {
    ok: false,
    message: '연결 실패 (' + code + '): ' + (body.message || res.getContentText())
  };
}

// ── 오늘 일정 가져오기 ──

function getTodaySchedules() {
  var token = getToken_();
  if (!token) return { ok: false, error: 'NOTION_TOKEN 없음', schedules: [] };

  var range = getTodayRange_();
  var payload = {
    filter: {
      and: [
        { property: CONFIG.PROP_DATE, date: { on_or_after: range.start } },
        { property: CONFIG.PROP_DATE, date: { before: range.end } }
      ]
    },
    sorts: [{ property: CONFIG.PROP_DATE, direction: 'ascending' }]
  };

  var res = notionFetch_('databases/' + CONFIG.NOTION_DATABASE_ID + '/query', 'post', payload);
  var code = res.getResponseCode();
  var body = JSON.parse(res.getContentText());

  if (code !== 200) {
    return { ok: false, error: body.message || '조회 실패', schedules: [] };
  }

  var schedules = [];
  (body.results || []).forEach(function(page) {
    var item = parsePage_(page);
    if (!item) return;
    if (CONFIG.TITLE_FILTER && item.title.indexOf(CONFIG.TITLE_FILTER) === -1) return;
    schedules.push(item);
  });

  return { ok: true, schedules: schedules };
}

// ── 상담 종료 → 구글 시트 기록 ──

function logConsultation(data) {
  var sheet = getOrCreateSheet_();
  var now = new Date();
  var row = [
    Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
    data.caseNo || '',
    data.title || '',
    data.type || '',
    data.scheduledStart || '',
    data.actualStart || '',
    data.actualEnd || '',
    data.durationMin || '',
    data.pageId || ''
  ];
  sheet.appendRow(row);
  return { ok: true, message: '시트에 기록되었습니다.' };
}

// ── 시트 초기 설정 ──

function setupSheet() {
  var sheet = getOrCreateSheet_();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      '기록일시', '케이스번호', '제목', '유형',
      '예정시작', '실제시작', '실제종료', '소요(분)', '노션ID'
    ]);
    sheet.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#f3f0f8');
  }
  return { ok: true, message: '시트 준비 완료: ' + CONFIG.SHEET_NAME };
}

// ── 내부 함수 ──

function getToken_() {
  return PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
}

function notionFetch_(endpoint, method, payload) {
  var options = {
    method: method || 'get',
    headers: {
      'Authorization': 'Bearer ' + getToken_(),
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };
  if (payload) options.payload = JSON.stringify(payload);
  return UrlFetchApp.fetch('https://api.notion.com/v1/' + endpoint, options);
}

function getTodayRange_() {
  var now = new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return {
    start: start.toISOString(),
    end: end.toISOString()
  };
}

function parsePage_(page) {
  var props = page.properties || {};
  var title = getTitle_(props);
  var dateProp = props[CONFIG.PROP_DATE];
  if (!dateProp || !dateProp.date || !dateProp.date.start) return null;

  var dateStart = dateProp.date.start;
  var startDate = new Date(dateStart);
  var caseNo = getTextProp_(props, CONFIG.PROP_CASE);
  var type = getSelectProp_(props, CONFIG.PROP_TYPE) || guessType_(title);
  var durationMin = DURATION_MAP[type] || 40;

  return {
    pageId: page.id,
    title: title,
    caseNo: caseNo,
    type: type,
    durationMin: durationMin,
    startISO: dateStart,
    startHour: startDate.getHours(),
    startMinute: startDate.getMinutes(),
    startLabel: formatTime24_(startDate)
  };
}

function getTitle_(props) {
  for (var key in props) {
    if (props[key].type === 'title' && props[key].title) {
      return props[key].title.map(function(t) { return t.plain_text; }).join('');
    }
  }
  return '(제목 없음)';
}

function getTextProp_(props, name) {
  var p = props[name];
  if (!p) return '';
  if (p.type === 'rich_text') return p.rich_text.map(function(t) { return t.plain_text; }).join('');
  if (p.type === 'number') return p.number != null ? String(p.number) : '';
  return '';
}

function getSelectProp_(props, name) {
  var p = props[name];
  if (!p) return '';
  if (p.type === 'select' && p.select) return p.select.name;
  if (p.type === 'status' && p.status) return p.status.name;
  return '';
}

function guessType_(title) {
  if (title.indexOf('학부모') !== -1) return '학부모';
  if (title.indexOf('고등') !== -1 || title.indexOf('고 ') !== -1) return '고등학생';
  if (title.indexOf('중등') !== -1 || title.indexOf('중 ') !== -1) return '중학생';
  if (title.indexOf('초등') !== -1 || title.indexOf('초 ') !== -1) return '초등학생';
  return '';
}

function formatTime24_(date) {
  var h = date.getHours();
  var m = date.getMinutes();
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

function getOrCreateSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  return sheet;
}

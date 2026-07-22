const { Client } = require('@notionhq/client');
const { config } = require('./config');

let notion = null;

function getClient() {
  if (!notion) {
    if (!config.notionToken) {
      const err = new Error('NOTION_TOKEN이 설정되지 않았습니다.');
      err.status = 500;
      throw err;
    }
    notion = new Client({ auth: config.notionToken });
  }
  return notion;
}

function seoulDateParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA → YYYY-MM-DD
  const [y, m, d] = fmt.format(date).split('-').map(Number);
  return { y, m, d };
}

function seoulDayRange(date = new Date()) {
  const { y, m, d } = seoulDateParts(date);
  const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
  return { start, end };
}

function getTitle(props) {
  for (const key of Object.keys(props || {})) {
    const p = props[key];
    if (p && p.type === 'title') {
      return (p.title || []).map((t) => t.plain_text).join('');
    }
  }
  return '(제목 없음)';
}

function getRichText(props, name) {
  const p = props[name];
  if (!p) return '';
  if (p.type === 'rich_text') return (p.rich_text || []).map((t) => t.plain_text).join('');
  if (p.type === 'number') return p.number != null ? String(p.number) : '';
  if (p.type === 'url') return p.url || '';
  if (p.type === 'phone_number') return p.phone_number || '';
  if (p.type === 'email') return p.email || '';
  return '';
}

function getSelect(props, name) {
  const p = props[name];
  if (!p) return '';
  if (p.type === 'select' && p.select) return p.select.name;
  if (p.type === 'status' && p.status) return p.status.name;
  if (p.type === 'multi_select' && p.multi_select) {
    return p.multi_select.map((s) => s.name).join(', ');
  }
  return '';
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function weekdayKo(date) {
  return ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
}

/**
 * Notion date property → 로컬(서울) 기준 파싱
 * start/end가 date-only면 종일, datetime이면 시간 포함
 */
function parseNotionDate(dateProp) {
  if (!dateProp || !dateProp.date || !dateProp.date.start) return null;
  const startRaw = dateProp.date.start;
  const endRaw = dateProp.date.end;

  const startHasTime = startRaw.includes('T');
  const endHasTime = endRaw ? endRaw.includes('T') : false;

  const start = new Date(startRaw);
  let end = endRaw ? new Date(endRaw) : null;

  // end 없으면 유형 기본 40분 가정 (실제 값은 호출측에서 덮어씀)
  if (!end && startHasTime) {
    end = new Date(start.getTime() + 40 * 60 * 1000);
  }

  const durationMin =
    end && startHasTime
      ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
      : null;

  const dateLabel = `${start.getFullYear()}.${pad2(start.getMonth() + 1)}.${pad2(start.getDate())}.(${weekdayKo(start)})`;
  const startLabel = startHasTime ? `${pad2(start.getHours())}:${pad2(start.getMinutes())}` : '';
  const endLabel = end && (endHasTime || startHasTime)
    ? `${pad2(end.getHours())}:${pad2(end.getMinutes())}`
    : '';

  return {
    startISO: startRaw,
    endISO: endRaw || null,
    startHasTime,
    start,
    end,
    dateLabel,
    startLabel,
    endLabel,
    durationMin,
    timeRangeLabel:
      startLabel && endLabel
        ? `${startLabel}~${endLabel}`
        : startLabel || '종일',
  };
}

function parsePage(page) {
  const props = page.properties || {};
  const dateInfo = parseNotionDate(props[config.props.date]);
  if (!dateInfo) return null;

  const category = getSelect(props, config.props.category);
  const title = getTitle(props);

  return {
    pageId: page.id,
    url: page.url,
    title,
    caseNo: getRichText(props, config.props.caseNo),
    type: getSelect(props, config.props.type),
    category,
    place: getRichText(props, config.props.place) || getSelect(props, config.props.place),
    note: getRichText(props, config.props.note),
    contact: getRichText(props, config.props.contact),
    externalUrl: getRichText(props, config.props.url),
    ...dateInfo,
    displayLabel: `${dateInfo.startLabel || '—'} ${title}`,
  };
}

function isCounseling(category) {
  if (!category) return false;
  return config.counselingCategories.some((c) => category.includes(c) || category === c)
    || category.includes('상담');
}

async function queryDatabase(filter, sorts = []) {
  const client = getClient();
  const results = [];
  let cursor = undefined;

  do {
    const res = await client.databases.query({
      database_id: config.notionDatabaseId,
      filter,
      sorts,
      start_cursor: cursor,
      page_size: 100,
    });
    results.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return results;
}

/**
 * 오늘(또는 지정일) 상담 예약 조회
 * — 새 DB/페이지를 만들지 않고 기존 캘린더 DB만 조회
 */
async function getSchedulesForDate(dateStr) {
  let range;
  if (dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const start = `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const end = `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
    range = { start, end };
  } else {
    range = seoulDayRange();
  }

  const pages = await queryDatabase(
    {
      and: [
        { property: config.props.date, date: { on_or_after: range.start } },
        { property: config.props.date, date: { before: range.end } },
      ],
    },
    [{ property: config.props.date, direction: 'ascending' }]
  );

  const schedules = [];
  for (const page of pages) {
    const item = parsePage(page);
    if (!item) continue;
    if (!isCounseling(item.category)) continue;
    schedules.push(item);
  }
  return { date: range.start, schedules };
}

/**
 * 학생 검색 — 제목/사례번호 기준, 상담 일정만
 */
async function searchStudents(query) {
  const q = (query || '').trim();
  if (!q) return [];

  // Notion DB query는 title contains / rich_text contains 지원
  const orFilters = [
    {
      property: await getTitlePropertyName(),
      title: { contains: q },
    },
  ];

  // 사례번호가 rich_text면 contains, number면 equals 시도
  orFilters.push({
    property: config.props.caseNo,
    rich_text: { contains: q },
  });

  let pages = [];
  try {
    pages = await queryDatabase({ or: orFilters }, [
      { property: config.props.date, direction: 'descending' },
    ]);
  } catch (err) {
    // 속성 타입 불일치 시 제목만으로 재시도
    pages = await queryDatabase(
      {
        property: await getTitlePropertyName(),
        title: { contains: q },
      },
      [{ property: config.props.date, direction: 'descending' }]
    );
  }

  const seen = new Map();
  for (const page of pages) {
    const item = parsePage(page);
    if (!item) continue;
    if (!isCounseling(item.category)) continue;
    const key = `${item.caseNo}|${item.title}`;
    if (!seen.has(key)) {
      seen.set(key, {
        title: item.title,
        caseNo: item.caseNo,
        type: item.type,
        latestPageId: item.pageId,
        latestDate: item.startISO,
        latestCategory: item.category,
      });
    }
  }
  return Array.from(seen.values()).slice(0, 30);
}

let cachedTitleProp = null;
async function getTitlePropertyName() {
  if (cachedTitleProp) return cachedTitleProp;
  const client = getClient();
  const db = await client.databases.retrieve({ database_id: config.notionDatabaseId });
  for (const [name, prop] of Object.entries(db.properties || {})) {
    if (prop.type === 'title') {
      cachedTitleProp = name;
      return name;
    }
  }
  cachedTitleProp = '이름';
  return cachedTitleProp;
}

/**
 * 동일 학생(사례번호 우선, 없으면 제목)의 이전 상담 페이지 조회
 * — 회기 추정 + 이전 본문 참고용
 */
async function getPreviousSessions({ caseNo, title, beforeISO, excludePageId }) {
  const filters = [];

  if (caseNo) {
    filters.push({
      property: config.props.caseNo,
      rich_text: { equals: caseNo },
    });
  } else if (title) {
    filters.push({
      property: await getTitlePropertyName(),
      title: { equals: title },
    });
  } else {
    return [];
  }

  if (beforeISO) {
    filters.push({
      property: config.props.date,
      date: { before: beforeISO.slice(0, 10) },
    });
  }

  let pages = [];
  try {
    pages = await queryDatabase(
      { and: filters },
      [{ property: config.props.date, direction: 'descending' }]
    );
  } catch {
    // 사례번호 타입이 number일 수 있음
    if (caseNo && !Number.isNaN(Number(caseNo))) {
      pages = await queryDatabase(
        {
          and: [
            { property: config.props.caseNo, number: { equals: Number(caseNo) } },
            ...(beforeISO
              ? [{ property: config.props.date, date: { before: beforeISO.slice(0, 10) } }]
              : []),
          ],
        },
        [{ property: config.props.date, direction: 'descending' }]
      );
    }
  }

  const sessions = [];
  for (const page of pages) {
    if (excludePageId && page.id === excludePageId) continue;
    const item = parsePage(page);
    if (!item) continue;
    if (!isCounseling(item.category)) continue;
    sessions.push(item);
  }
  return sessions;
}

/**
 * 페이지 본문에서 기존 상담일지/메모 텍스트 추출 (이전 회기 참고)
 */
async function getPagePlainText(pageId) {
  const client = getClient();
  const blocks = [];
  let cursor = undefined;

  do {
    const res = await client.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    blocks.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  const lines = [];
  for (const block of blocks) {
    const text = extractBlockText(block);
    if (text) lines.push(text);
  }
  return lines.join('\n');
}

function extractBlockText(block) {
  const type = block.type;
  const data = block[type];
  if (!data) return '';
  if (Array.isArray(data.rich_text)) {
    const t = data.rich_text.map((r) => r.plain_text).join('');
    if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
      return `\n## ${t}`;
    }
    if (type === 'bulleted_list_item' || type === 'numbered_list_item') {
      return `• ${t}`;
    }
    return t;
  }
  return '';
}

/**
 * 회기 번호 추정: 이전 상담 건수 + 1
 * 본문에 "N회기"가 있으면 그 최대값 + 1 사용
 */
async function estimateSessionNumber(previousSessions) {
  let maxFromText = 0;
  // 최근 3건만 본문 스캔 (속도)
  for (const s of previousSessions.slice(0, 3)) {
    try {
      const text = await getPagePlainText(s.pageId);
      const matches = [...text.matchAll(/(\d+)\s*회기/g)];
      for (const m of matches) {
        maxFromText = Math.max(maxFromText, Number(m[1]));
      }
    } catch {
      // ignore
    }
  }
  const byCount = previousSessions.length + 1;
  return Math.max(byCount, maxFromText + 1, 1);
}

/**
 * 기존 예약 페이지 본문에 상담일지·상담자 메모를 추가한다.
 * — 페이지를 삭제/생성하지 않음. 기존 블록은 유지하고 하단에 append.
 */
async function updateReservationPage(pageId, { journalText, memoText, appendDivider = true }) {
  const client = getClient();

  // 기존에 자동생성 섹션이 있으면 제거 후 재작성할지 여부는
  // v1에서는 append만 수행 (업무 안전). 중복 방지 마커로 구분.
  const children = [];

  if (appendDivider) {
    children.push({
      object: 'block',
      type: 'divider',
      divider: {},
    });
  }

  children.push(
    heading2('상담일지'),
    ...textToParagraphBlocks(journalText),
    {
      object: 'block',
      type: 'divider',
      divider: {},
    },
    heading2('상담자 메모'),
    ...textToParagraphBlocks(memoText)
  );

  // Notion API: 한 번에 최대 100 children
  const chunks = chunk(children, 90);
  for (const part of chunks) {
    await client.blocks.children.append({
      block_id: pageId,
      children: part,
    });
  }

  const page = await client.pages.retrieve({ page_id: pageId });
  return { pageId, url: page.url };
}

function heading2(text) {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: {
      rich_text: [{ type: 'text', text: { content: text } }],
    },
  };
}

function textToParagraphBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  for (const line of lines) {
    // Notion rich_text content max 2000 chars
    const chunks = splitByLength(line.length ? line : ' ', 1900);
    for (const c of chunks) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: c } }],
        },
      });
    }
  }
  return blocks.length ? blocks : [
    {
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [] },
    },
  ];
}

function splitByLength(str, max) {
  const out = [];
  for (let i = 0; i < str.length; i += max) out.push(str.slice(i, i + max));
  return out.length ? out : [str];
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function getPageById(pageId) {
  const client = getClient();
  const page = await client.pages.retrieve({ page_id: pageId });
  return parsePage(page);
}

async function testConnection() {
  const client = getClient();
  const db = await client.databases.retrieve({ database_id: config.notionDatabaseId });
  const title =
    (db.title || []).map((t) => t.plain_text).join('') || '캘린더 DB';
  return {
    ok: true,
    title,
    properties: Object.keys(db.properties || {}),
  };
}

module.exports = {
  getSchedulesForDate,
  searchStudents,
  getPreviousSessions,
  getPagePlainText,
  estimateSessionNumber,
  updateReservationPage,
  getPageById,
  testConnection,
  parsePage,
  seoulDayRange,
};

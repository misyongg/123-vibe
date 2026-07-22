require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

/**
 * 기존 노션 캘린더 DB 속성명을 그대로 사용한다.
 * 속성을 새로 만들지 않는다.
 */
const config = {
  port: Number(process.env.PORT) || 3847,
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  notionToken: process.env.NOTION_TOKEN || '',
  notionDatabaseId: process.env.NOTION_DATABASE_ID || '',

  // 노션 DB 속성 (현재 업무 그대로)
  props: {
    title: 'title', // page title type — 이름은 DB마다 다를 수 있어 자동 탐지
    caseNo: '사례번호',
    type: '유형',
    category: '일정 구분',
    date: 'Date',
    place: '장소',
    note: '비고',
    contact: '연락처',
    url: 'URL',
  },

  // 상담으로 취급하는 일정 구분
  counselingCategories: ['상담(내방)', '상담(이동)'],
};

function missingKeys() {
  const missing = [];
  if (!config.openaiApiKey) missing.push('OPENAI_API_KEY');
  if (!config.notionToken) missing.push('NOTION_TOKEN');
  if (!config.notionDatabaseId) missing.push('NOTION_DATABASE_ID');
  return missing;
}

module.exports = { config, missingKeys };

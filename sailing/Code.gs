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
  // 학생 마스터 DB의 해당학생 Relation에서 가져오는 Rollup 속성명
  // 속성명을 바꿨다면 여기 값도 동일하게 바꿉니다.
  PROP_SCHOOL: '학생 학교명',
  PROP_GRADE: '학생 학년',
  PROP_CLASS: '학생 반',
  PROP_GENDER: '학생 성별',
  PROP_PERIOD: '교시',
  PROP_TARGET: '대상',
  PROP_SESSION: '회기',
  CATEGORY_FILTER: '상담', // 일정 구분에 '상담' 포함만

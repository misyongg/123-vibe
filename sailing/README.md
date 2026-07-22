# Sailing · Wee센터 상담기록 자동화 시스템 v1.0

상담 종료 후 **학생 선택 → 키워드 메모 → 저장**만 하면  
OpenAI가 **상담일지·상담자 메모**를 작성하고,  
**현재 사용 중인 노션 캘린더의 기존 예약 페이지**를 업데이트합니다.

## 원칙

- 상담일지 전용 DB를 **만들지 않음**
- 새 노션 페이지를 **만들지 않음**
- 기존 업무 방식(캘린더 예약)을 **바꾸지 않음**
- 기존 속성만 사용: 제목, 사례번호, 유형, 일정 구분, Date, 장소, 비고, 연락처, URL

## 워크플로우

```
노션에서 상담 예약
  → 상담 진행 (필요 시 Date를 실제 시간으로 수정)
  → Sailing 실행
  → 오늘 상담 자동 조회
  → 학생 선택 + 키워드 메모
  → 저장
  → 기존 예약 페이지 본문에 상담일지·상담자 메모 추가
```

## 시작하기

### 1. 의존성 설치

```bash
cd sailing
npm install
```

### 2. 환경변수

`.env.example`을 복사해 `.env`를 만듭니다.

```bash
cp .env.example .env
```

| 키 | 설명 |
|----|------|
| `OPENAI_API_KEY` | OpenAI API 키 |
| `OPENAI_MODEL` | 기본 `gpt-4o-mini` |
| `NOTION_TOKEN` | [Notion Integration](https://www.notion.so/my-integrations) 토큰 |
| `NOTION_DATABASE_ID` | **현재 쓰는** 캘린더 Database ID |
| `PORT` | 기본 `3847` |

**노션 연결:** 캘린더 페이지 → `···` → Connections → 만든 Integration 연결

Database ID: 캘린더 DB URL의 `https://notion.so/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?...` 32자 (하이픈 유무 무관)

### 3. 실행

```bash
npm start
```

브라우저에서 [http://localhost:3847](http://localhost:3847) 을 엽니다.

## 사용법

1. **오늘 상담** 목록에서 학생 선택 (일정 구분: 상담(내방)·상담(이동))
2. 필요 시 회기·성별·학교·학년 등 보완
3. **키워드 메모** 입력 (문장 대신 키워드)
4. **미리보기**로 확인·수정 (선택)
5. **저장** → 해당 노션 예약 페이지 하단에 상담일지·상담자 메모 추가

검색으로 다른 날짜 학생도 찾을 수 있습니다.  
🎤 음성 입력은 Chrome 등 Web Speech API 지원 브라우저에서 동작합니다.

## 폴더 구조

```
sailing/
  public/          # 웹 입력 화면
  server/
    index.js       # Express API
    config.js      # 환경·속성명
    notion.js      # 기존 DB 조회·페이지 업데이트
    openai.js      # 상담일지·메모 생성
  .env.example
  package.json
```

## API

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/health` | 설정 상태 |
| GET | `/api/notion/test` | 노션 DB 연결 테스트 |
| GET | `/api/schedules?date=` | 해당일 상담 예약 |
| GET | `/api/students?q=` | 학생·사례번호 검색 |
| GET | `/api/sessions/:pageId/context` | 회기·이전 회기 |
| POST | `/api/preview` | AI 미리보기 (노션 미수정) |
| POST | `/api/save` | AI 작성 + **기존 페이지 업데이트** |

## 구현된 기능

1. 웹 입력 화면  
2. OpenAI API 연동  
3. Notion API 연동  
4. 기존 예약 페이지 자동 업데이트  
5. 이전 회기 자동 참고 · 회기 추정  
6. 음성 입력(STT) 기본 지원  

## 앞으로

- 상담 통계  
- 회기·메타데이터 UX 고도화  

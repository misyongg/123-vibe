# Sailing 웹앱 배포 가이드

상담 타이머와 같은 방식입니다. **Google Apps Script 웹 앱**으로 배포하면 폰에서 URL만 열면 됩니다.

## A. 복붙 배포 (가장 쉬움)

1. [script.google.com](https://script.google.com) → **새 프로젝트** → 이름 `Sailing 상담기록`
2. `Code.gs` 붙여넣기
3. **+ → HTML** → 파일명 `Index` → `Index.html` 붙여넣기
4. **프로젝트 설정 → 스크립트 속성**에 키 등록:

| 속성 | 설명 |
|------|------|
| `NOTION_TOKEN` | 노션 Integration 토큰 |
| `NOTION_DATABASE_ID` | 상담 **타이머와 같은** 예약 캘린더 ID (`1ad1b959-3ca0-8187-bc50-e94e057f408d`) |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `OPENAI_MODEL` | 선택 (기본 gpt-4o-mini) |

5. **배포 → 새 배포 → 웹 앱**
   - 실행: 나
   - 액세스: 나만
6. URL을 폰 북마크 / 홈 화면에 추가

### 코드 수정 후

**배포 → 배포 관리 → 연필(수정) → 새 버전 → 배포**  
(또는 새 배포를 다시 만들기)

저장만 하고 새 버전 배포를 안 하면 예전 화면이 그대로일 수 있습니다.

## B. clasp로 올리기 (선택)

```bash
cd sailing
cp .clasp.json.example .clasp.json
# .clasp.json 에 스크립트 ID 입력

npx @google/clasp login
npx @google/clasp push
```

이후에도 Apps Script에서 **새 버전 배포**는 필요합니다.

## 자주 하는 실수

| 증상 | 해결 |
|------|------|
| linked database 오류 | 「상담기록」연결 DB ID X → **타이머 예약 캘린더** 원본 ID 사용 |
| 일정이 안 보임 | `NOTION_DATABASE_ID`, Connections, `Date` / `일정 구분` 속성명 |
| OpenAI 오류 / API 키 연결 안 됨 | 스크립트 속성 `OPENAI_API_KEY` 확인 → `testOpenAIConnectionLog` 실행 |
| 저장 후 노션에 안 보임 | Integration이 해당 DB에 연결됐는지 |
| 폰에서 예전 화면 | **새 버전 배포** 했는지 |
| HTML을 못 찾음 | HTML 파일 이름이 정확히 `Index`인지 |

## 보안

- API 키는 **스크립트 속성**에만 저장
- GitHub에 `.env`나 토큰을 커밋하지 말 것
- 웹앱 액세스는 가능하면 **나만**으로 시작

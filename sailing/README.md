# Sailing · Wee센터 상담기록 자동화 (웹앱)

상담 종료 후 **학생 선택 → 키워드 메모 → 저장**만 하면  
OpenAI가 **상담일지·상담자 메모**를 작성하고,  
**현재 사용 중인 노션 캘린더의 기존 예약 페이지**를 업데이트합니다.

> **Apps Script 웹앱**입니다. PC에서 `npm` 실행이 필요 없습니다.  
> 배포 URL을 폰·PC 브라우저에서 바로 사용합니다.

**바로가기:** [Sailing 웹앱 열기](https://script.google.com/macros/s/AKfycbwHKf_6rpK33-HM6NtudIpjG9uJfh781zfdVemPkp9xCro_xZPm6b52qmtqZhu4h-j0-A/exec)

## 원칙

- 상담일지 전용 DB를 **만들지 않음**
- 새 노션 페이지를 **만들지 않음**
- 기존 속성만 사용: 제목, 사례번호, 유형, 일정 구분, Date, 장소, 비고, 연락처, URL

## 파일

| 파일 | 역할 |
|------|------|
| `Code.gs` | 서버 (Notion + OpenAI + 저장) |
| `Index.html` | 화면 |
| `appsscript.json` | Apps Script 설정 |
| `DEPLOY.md` | 배포·clasp 안내 |

## 설치 (처음 1회)

### 1. Apps Script 프로젝트 만들기

1. [script.google.com](https://script.google.com) → **새 프로젝트**
2. 이름: `Sailing 상담기록`
3. 기본 `코드.gs` 내용을 **전부 삭제** → 이 폴더의 `Code.gs` 붙여넣기
4. 왼쪽 **+** → **HTML** → 파일 이름 **`Index`** (대소문자 주의)
5. `Index.html` 내용 붙여넣기
6. **저장**

### 2. 스크립트 속성 (비밀키)

**프로젝트 설정(톱니바퀴) → 스크립트 속성**에 추가:

| 속성 | 값 |
|------|-----|
| `NOTION_TOKEN` | Notion Integration 토큰 (`ntn_...`) |
| `NOTION_DATABASE_ID` | 현재 쓰는 캘린더 DB ID |
| `OPENAI_API_KEY` | OpenAI API 키 |
| `OPENAI_MODEL` | (선택) 기본 `gpt-4o-mini` |

> 키는 GitHub·채팅에 올리지 마세요. 스크립트 속성에만 둡니다.

**노션 연결:** 상담 타이머용 Integration을 이미 캘린더에 연결해 두었다면 **그대로 재사용**하면 됩니다.  
새로 만들었다면 캘린더 DB → `···` → Connections → 해당 Integration 연결.

### 3. 연결 테스트 (선택)

Apps Script에서 함수 `testNotionConnection` 선택 → **실행** → 로그 확인.

### 4. 웹앱 배포

1. **배포 → 새 배포**
2. 유형: **웹 앱**
3. 실행 계정: **나**
4. 액세스: **나만** (본인만 쓸 때) 또는 필요 시 조직
5. **배포** → **URL 복사**
6. 폰 브라우저에서 URL 열기 → **홈 화면에 추가** 권장

코드를 수정한 뒤에는 **배포 → 배포 관리 → 새 버전 → 배포** 해야 URL에 반영됩니다.

## 사용법

1. 웹앱 열면 **오늘 상담**이 자동 조회됩니다
2. 학생 선택
3. 키워드 메모 입력
4. (선택) 미리보기에서 수정
5. **저장** → 해당 노션 **기존 예약 페이지** 하단에 상담일지·상담자 메모 추가

## 워크플로우

```
노션 예약 → 상담 → Sailing 웹앱
  → 학생 선택 + 키워드
  → 저장
  → 기존 예약 페이지 업데이트
```

## 구현된 기능

1. 웹 입력 화면 (폰·PC)
2. OpenAI API 연동
3. Notion API 연동
4. 기존 예약 페이지 자동 업데이트
5. 이전 회기 참고 · 회기 추정
6. 음성 입력(STT, 지원 브라우저)

## PC 로컬 Node 버전은?

이전 Node(`npm start`) 방식은 **웹앱으로 교체**되었습니다.  
더 이상 `npm install` / `localhost`가 필요 없습니다.

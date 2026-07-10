# Apps Script 자동 배포 (clasp)

**제작**: 전문상담교사 김미선 (misyongg)

Google 계정 로그인이 **한 번** 필요합니다. 이후 터미널에서 `clasp push`로 코드를 올릴 수 있습니다.

## 1. 스크립트 ID 찾기

1. [script.google.com](https://script.google.com) → 상담타이머 프로젝트 열기
2. **프로젝트 설정** (톱니바퀴)
3. **IDs** → **스크립트 ID** 복사 (예: `1AbC...`)

## 2. clasp 설정

```bash
cd apps-script
cp .clasp.json.example .clasp.json
# .clasp.json 에 스크립트 ID 붙여넣기

npx @google/clasp login
npx @google/clasp push
```

## 3. 웹앱 새 버전 배포

`clasp push` 후에도 URL에는 **새 버전 배포**가 필요합니다.

- Apps Script → **배포 → 배포 관리 → 새 버전 → 배포**

또는:

```bash
npx @google/clasp deploy --description "상담타이머 업데이트"
```

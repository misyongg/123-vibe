# 프로젝트 홈 Google 로그인 설정

**제작**: 전문상담교사 김미선 (misyongg)

프로젝트 홈(`index.html`)은 Google 계정으로 로그인한 **허용된 이메일**만 볼 수 있습니다.

## 1. Google Cloud OAuth 클라이언트 만들기

1. [Google Cloud Console](https://console.cloud.google.com/) → 프로젝트 선택/생성
2. **API 및 서비스** → **OAuth 동의 화면** → 외부(또는 내부) 설정
3. **사용자 인증 정보** → **OAuth 클라이언트 ID** → **웹 애플리케이션**
4. **승인된 JavaScript 원본**에 추가:
   - `https://misyongg.github.io`
   - `http://localhost` (로컬 테스트 시)
5. 생성된 **클라이언트 ID** 복사

## 2. 설정 파일 수정

`home-auth-config.js` 파일을 열고:

```javascript
const HOME_AUTH_CONFIG = {
  GOOGLE_CLIENT_ID: "123456789-xxxx.apps.googleusercontent.com",
  ALLOWED_EMAILS: ["본인@gmail.com"]
};
```

- `GOOGLE_CLIENT_ID`: 위에서 복사한 클라이언트 ID
- `ALLOWED_EMAILS`: 홈에 접근할 Gmail 주소 (여러 개 가능)

## 3. 배포

변경 후 GitHub에 push하면 GitHub Pages에 반영됩니다.

## 참고

- 학생용·선생님용 앱 URL은 별도로 공개됩니다. 홈만 Google 로그인으로 보호됩니다.
- 클라이언트 ID가 비어 있으면 홈에서 설정 안내 화면이 표시됩니다.

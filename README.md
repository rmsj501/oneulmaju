# 오늘마주 · ONEULMAJU

오늘마주 로테이션 소개팅 서비스의 웹사이트 소스입니다. 모바일 중심 화면, 회원·프로필, 플랫폼 구매자 신청, 운영자 회차 관리, 개인 QR 메모와 매칭 기능을 포함합니다.

## 개발

Node.js를 설치한 뒤 실행합니다.

```sh
npm ci
npm test
npm run build
```

빌드 결과는 `dist/server/index.js`에 생성되는 Cloudflare Worker입니다. GitHub Pages용 정적 사이트가 아닙니다.

## 설정

`.env.example`의 설정 항목을 참고하세요. 내부 운영 문서는 공개본에서 제외했습니다. 실제 비밀키는 배포 환경에 별도로 설정해야 합니다. Supabase 마이그레이션과 Edge Function 소스는 `supabase/`에 있습니다. 공개본에는 초기 운영자 계정 지정이 제외되어 있으므로 별도로 구성해야 합니다.

회원 데이터, 실제 참가자 사진·자료, 개인 QR 접속 링크, 실제 환경 비밀키는 포함하지 않습니다. GitHub 업로드만으로 운영 사이트와 자동 동기화되지는 않습니다.

## 운영 중인 사이트

https://oneulmaju.rmsj501.chatgpt.site/

브랜드·이미지 등 권리는 원 권리자에게 있습니다. 별도의 오픈소스 라이선스는 부여하지 않습니다.

"use strict";

// 모든 응답에 붙는 보안 헤더. 정적 자산 응답에도 붙어야 하므로 체인 맨 앞에 등록한다.
//
// Helmet을 쓰지 않는 이유: 기본 14종 중 이 앱에서 값이 있는 건 아래 4개 + CSP뿐이고,
// 나머지는 무의미하거나 운영 환경을 깨뜨린다. 특히 켜면 안 되는 것 —
//   HSTS  평문으로 테스트한 사람의 브라우저가 그 호스트를 HTTPS 강제로 영구 기억한다.
//   COEP  CORP/CORS 헤더 없는 외부 리소스를 차단한다 → 외부 CDN 썸네일이 전부 깨진다.
//   COOP  OAuth를 팝업 방식으로 바꾸면 조용히 깨진다.
// 끄는 설정이 켜는 설정보다 길어지므로 직접 쓴다.

// img-src를 https: 전체로 여는 이유: 썸네일이 유튜브·스포티파이·사운드클라우드·디스코드
// CDN에서 온다. 호스트 화이트리스트는 플랫폼이 CDN을 바꾸는 순간 이미지를 조용히 깨뜨린다.
//
// style-src에 'unsafe-inline'이 없는 근거(실측): 빌드 산출물에 인라인 <style>도 style= 속성도
// 없고, 컴포넌트의 :style 바인딩은 CSSOM(el.style)이라 CSP 대상이 아니다.
const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: https:", "connect-src 'self'", "font-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'"].join("; ");

function securityHeaders(req, res, next) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff"); // 정적 파일을 서빙하므로 MIME 스니핑 차단
  res.setHeader("X-Frame-Options", "DENY"); // 대시보드가 iframe에 들어갈 용례 없음
  res.setHeader("Referrer-Policy", "no-referrer"); // 외부 링크로 내부 주소·포트가 새지 않게
  next();
}

module.exports = { securityHeaders, CSP };

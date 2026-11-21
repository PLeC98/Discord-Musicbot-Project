// 대시보드 서버가 화면 앱 없이 직접 그리는 쪽(dashboard/html-page)의 문구. 쪽에 그대로 넣는 HTML 조각이라 태그를 포함한다.
// 넣는 값(host, id)은 부르는 쪽이 이스케이프한다

/** 쪽 제목 */
const title = "대시보드";
/** 허용하지 않은 호스트로 온 요청(dashboard/host-check). host는 그 주소 */
const badHost = (host: string) => `<p>이 주소(${host})로는 대시보드를 열 수 없어요.</p><p>이 주소로 접속하려면 봇의 .env에서 <code>DASHBOARD_URL</code>을 이 주소로 바꾸고 봇을 다시 시작하세요.</p>`;
/** Host 헤더가 없거나 여러 개이거나 형식이 잘못된 요청(dashboard/host-check) */
const badHostHeader = "<p>요청의 Host 헤더가 잘못되어 대시보드를 열 수 없어요.</p>";
/** 인터넷 평문 접속 차단(dashboard/plaintext) */
const plaintext = "<p>인터넷을 평문(http)으로 지나는 연결이라 대시보드를 열지 않았어요. 로그인 정보가 그대로 보일 수 있어요.</p><p>봇 운영자라면 docs/dashboard-network.md의 공개 방법대로 HTTPS로 공개하세요.</p>";
/** 화면을 빌드하지 않았을 때 */
const notBuilt = "<h2>대시보드 화면이 빌드되지 않았어요.<br>봇 폴더에서 <code>pnpm run build:dashboard</code> 를 실행한 뒤 새로고침하세요.</h2>";
/** 오류 쪽(dashboard/middleware/error-handler)의 오류 ID 줄 */
const errorId = (id: string) => `오류 ID: ${id}`;

export { title, badHost, badHostHeader, plaintext, notBuilt, errorId };

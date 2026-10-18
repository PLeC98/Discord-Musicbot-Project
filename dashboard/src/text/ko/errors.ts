// 화면만의 오류 문장: 응답 없이 실패한 요청과 알림의 끝 줄. 봇이 답한 거절 · 오류의 문장은 봇 문장표(src/ui/text/ko/errors)

const timeout = { title: "응답이 너무 늦어요!", body: "봇이 정해진 시간 안에 응답하지 않았어요. 요청이 처리됐을 수도 있으니 화면을 확인한 뒤 다시 시도해 주세요." };
const offline = { title: "봇에 연결할 수 없어요!", body: "봇이 꺼져 있거나 네트워크에 문제가 있어요. 잠시 뒤에 다시 시도해 주세요." };
/** 알림 끝 줄: 오류 코드(웹 쪽 오류는 HTTP 상태까지) */
const codeLine = (code: string, status?: number) => (status === undefined ? `오류 코드: ${code}` : `오류 코드: ${code} (HTTP ${status})`);
/** 복사한 알림의 보고할 곳 줄 */
const reportAt = (url: string) => `보고할 곳: ${url}`;

export { timeout, offline, codeLine, reportAt };

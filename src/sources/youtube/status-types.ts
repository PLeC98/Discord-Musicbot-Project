// 유튜브 접속 경로의 지금 상태(auth 의 statusSnapshot). 대시보드 운영자 화면이 그대로 받으므로 Node 를 부르지 않는 여기에 둔다

/** POToken: 켜짐 · 설정은 켰는데 서버가 없음 · 꺼짐 */
type PotState = "on" | "missing" | "off";
/** 쿠키를 어디서 읽나: 브라우저 · 파일 · 안 씀 */
type CookieSource = "browser" | "file" | "none";

/** 플레이어 클라이언트 하나. excluded 는 실행 중 실패로 뺀 것, tried · failed 는 최근 시도 수 */
type ClientStatus = { name: string; excluded: boolean; tried: number; failed: number; needsPot: boolean; known: boolean };

type YoutubeStatus = { pot: PotState; cookies: CookieSource; configured: boolean; clients: ClientStatus[] };

export type { PotState, CookieSource, ClientStatus, YoutubeStatus };

// 업데이트 탭의 "외부 프로그램 이전 버전" 카드: 외부 프로그램마다 삭제할 수 있는 이전 버전과 크기. /api/admin/vendor/old-versions.
// 지금 쓰는 버전은 다루지 않는다(yt-dlp 카드, 봇 정보 탭에 있다). 봇과 화면이 같이 읽으므로 Node를 부르지 않는다

/** 이전 버전을 남기는 외부 프로그램. legacy: 예전 설치 위치(vendor/bin의 옛 ffmpeg 실행 파일과 yt-dlp 폴더, 옛 bgutil 체크아웃 vendor/bgutil-ytdlp-pot-provider) */
const OLD_TOOLS = ["ytdlp", "ffmpeg", "bgutil", "legacy"] as const;
type OldTool = (typeof OLD_TOOLS)[number];
/**
 * 남기는 사유. in-use: 봇이 쓰는 중(다시 시작하면 삭제할 수 있다), starting: 봇이 아직 쓸 ffmpeg를 정하지 않았다, broken: 기록을 읽지 못했다,
 * only-build: 지금 설치본이 없어 이전 설치본이 하나뿐인 빌드다, link: 심볼릭 링크나 정션이라 따라가지 않는다, busy: 다른 프로세스(터미널의 설치 명령 등)가 폴더를 쓰는 중, failed: 삭제하지 못했다
 */
type OldToolKept = "in-use" | "starting" | "broken" | "only-build" | "link" | "busy" | "failed";
/** 한 도구. versions: 삭제할(삭제한) 이전 버전(yt-dlp 태그, ffmpeg 릴리스, bgutil 태그. 예전 설치 위치는 빈 배열), bytes: 크기 합, kept: 남기는 것의 사유(같은 사유는 한 번) */
type OldToolView = { tool: OldTool; versions: string[]; bytes: number; kept: OldToolKept[] };
/** 삭제한 결과. deferred: 돌고 있는 yt-dlp가 쓰는 폴더라 다음 정리 때 삭제한다 */
type OldToolDone = OldToolView & { deferred: boolean };

export { OLD_TOOLS };
export type { OldTool, OldToolKept, OldToolView, OldToolDone };

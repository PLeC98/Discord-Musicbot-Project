// custom_id 의 모양: 접두사:동작[:나머지]. 접두사와 동작이 처리기(interactions/)를 고른다.
// 세션을 싣는 것은 마지막 칸이 세션이다(지난 재생의 버튼 · 메뉴를 가른다).
// 재생목록 더 넣기(plm · plmm)는 이어 받을 상태를 나머지 칸에 싣는다(usecases/playlistMore). 한도(100자)가 빠듯해 앞머리를 늘리지 않는다

const PANEL = "panel"; // 재생 패널의 버튼 · 곡으로 건너뛰기 메뉴 · 음량 모달
const AUTOPLAY = "autoplay"; // 자동재생 장르 메뉴
const QUEUE = "queue"; // 대기열 보기의 넘기기
const HELP = "help";
const SYSTEM = "system";
const SEARCH = "search"; // 검색 결과 고르기 search:pick:요청자:번호:영상 ID · 취소 search:cancel:요청자

/** 끝난 패널의 세션 자리 표식. 세션이 없다는 뜻이라 어느 플레이어에도 통한다 */
const IDLE_SESSION = "idle";

/** 칸을 이어 custom_id 로 */
const customId = (...parts: Array<string | number>) => parts.join(":");

/** custom_id 의 칸. 모자란 칸은 빈 문자열 */
function partsOf(id: string) {
  const [prefix = "", action = "", ...rest] = id.split(":");
  return { prefix, action, rest };
}

const panelId = (action: string, sessionId: string) => customId(PANEL, action, sessionId);

export { PANEL, AUTOPLAY, QUEUE, HELP, SYSTEM, SEARCH, IDLE_SESSION, customId, partsOf, panelId };

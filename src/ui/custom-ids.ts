// custom_id 의 모양: 접두사:동작[:나머지]. 접두사와 동작이 핸들러(discord/interactions/)를 선택한다.
// 세션을 싣는 것은 마지막 필드가 세션이다(지난 재생의 버튼, 메뉴를 구분한다).
// 재생목록 더 넣기(plm, plmm)는 이어 불러올 상태를 나머지 필드에 싣는다(usecases/playlist-more). 한도(100자)가 빠듯해 접두사를 늘리지 않는다

const PANEL = "panel"; // 재생 패널의 버튼, 곡으로 건너뛰기 메뉴, 볼륨 모달
const AUTOPLAY = "autoplay"; // 자동재생 장르 메뉴
const QUEUE = "queue"; // 대기열 보기의 넘기기
const SYSTEM = "system";
const SEARCH = "search"; // 검색 결과 화면의 선택 메뉴 search:pick:검색한 사람

/** 끝난 패널의 세션 필드 마커. 세션이 없다는 뜻이라 어느 플레이어에도 통한다 */
const IDLE_SESSION = "idle";

/** 필드를 이어 custom_id 로 */
const customId = (...parts: Array<string | number>) => parts.join(":");

/** custom_id 의 필드. 모자란 필드는 빈 문자열 */
function partsOf(id: string) {
  const [prefix = "", action = "", ...rest] = id.split(":");
  return { prefix, action, rest };
}

const panelId = (action: string, sessionId: string) => customId(PANEL, action, sessionId);

/** 곡으로 건너뛰기 메뉴의 값: 대기열 ID. 번호는 메뉴를 그린 뒤 대기열이 바뀌면 다른 곡을 가리켜 쓰지 않는다 */
const jumpValue = (entry: number) => `entry:${entry}`;

/** 메뉴 값의 대기열 ID. 그 모양이 아니면(번호를 값으로 쓰던 옛 메뉴 포함) null */
function entryOfJump(value: string | undefined) {
  const found = /^entry:(\d+)$/.exec(value ?? "");
  return found ? Number(found[1]) : null;
}

export { PANEL, AUTOPLAY, QUEUE, SYSTEM, SEARCH, IDLE_SESSION, customId, partsOf, panelId, jumpValue, entryOfJump };

// /queue 편집 화면의 곡 옮기기: 누른 때의 대기열(대기열 ID 순서)에서 그 곡을 어느 곡 앞에 넣을지. Node를 부르지 않는다.
// 화면을 그린 뒤 대기열이 바뀌었을 수 있어 번호가 아니라 대기열 ID로 찾는다. 이미 그 자리면(맨 앞의 위로, 맨 끝의 아래로) 옮기지 않는다

/** 편집 화면의 동작: 지금 재생, 다음에 재생(맨 앞으로), 위로, 아래로, 삭제 */
const EDIT_ACTIONS = ["play", "next", "up", "down", "remove"] as const;
type EditAction = (typeof EDIT_ACTIONS)[number];
type MoveAction = Extract<EditAction, "next" | "up" | "down">;

const isEditAction = (value: string): value is EditAction => (EDIT_ACTIONS as readonly string[]).includes(value);

/** 옮길 곳: before 앞에(null 이면 맨 끝), 이미 그 자리면 stay, 대기열에 없으면 gone */
type MovePlan = { before: number | null } | "stay" | "gone";

function movePlan(entries: readonly number[], entry: number, action: MoveAction): MovePlan {
  const index = entries.indexOf(entry);
  if (index < 0) return "gone";
  const last = entries.length - 1;
  if (action === "down") return index === last ? "stay" : { before: index + 2 <= last ? entries[index + 2] : null };
  if (index === 0) return "stay";
  return { before: action === "next" ? entries[0] : entries[index - 1] };
}

/** 이 자리에서 할 수 없는 동작(버튼을 끈다): 맨 앞은 다음에 재생, 위로. 맨 끝은 아래로 */
function blockedAt(index: number, size: number): Set<EditAction> {
  const blocked = new Set<EditAction>();
  if (index === 0) blocked.add("next").add("up");
  if (index === size - 1) blocked.add("down");
  return blocked;
}

export { EDIT_ACTIONS, isEditAction, movePlan, blockedAt };
export type { EditAction, MoveAction, MovePlan };

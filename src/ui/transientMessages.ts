// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// 잠시 떴다가 스스로 지워질 봇 메시지. 현재 재생 메시지가 "묻혔는지" 셀 때 빼기 위해 기억한다.
// 지우기로 한 시각이 지나면 잊는다(지우기가 실패해 남았다면 그때부터는 보통 메시지로 센다).

const SLACK_MS = 5000;
const until = new Map(); // messageId → 잊을 시각

function prune(now) {
  for (const [id, t] of until) if (t <= now) until.delete(id);
}

/** ms 뒤 지워질 메시지로 표시한다. 다시 부르면 기한을 새로 잡는다. */
function markTransient(messageId, ms, now = Date.now()) {
  if (!messageId) return;
  prune(now);
  until.set(String(messageId), now + ms + SLACK_MS);
}

function isTransient(messageId, now = Date.now()) {
  const t = until.get(String(messageId));
  if (t === undefined) return false;
  if (t > now) return true;
  until.delete(String(messageId));
  return false;
}

const AUTO_DELETE_MS = 10000;

// 안내 메시지는 채널에 쌓이지 않게 잠시 뒤 지운다. 이미 지워졌을 수 있으므로 실패는 무시.
function scheduleDelete(message, ms = AUTO_DELETE_MS) {
  if (!message || typeof message.delete !== "function") return;
  markTransient(message.id, ms);
  setTimeout(() => {
    Promise.resolve(message.delete()).catch(() => {});
  }, ms);
}

const exported = { markTransient, isTransient, scheduleDelete, AUTO_DELETE_MS };
export default exported;
export { exported as "module.exports" };

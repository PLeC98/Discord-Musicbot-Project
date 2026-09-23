// 본인에게만 보이는 응답을 얼마 뒤 지울지. 한 곳에서 정한다(2026-09-16). 쓰면서 불편하면 이 표만 고친다.
//   거절·오류("재생 중인 음악이 없습니다", 권한 부족, 입력 오류)와 조작 결과(일시정지·스킵·볼륨 …) → 기본값
//   읽는 화면과, 조작하는 동안 떠 있어야 하는 설정·선택 화면 → null(지우지 않는다. 사용자가 닫는다)
// 버튼으로 기존 메시지를 고친 응답(update)은 기본적으로 대상이 아니다. 설정 화면을 지우면 그 화면이 사라진다.
// 표는 "무엇을 눌렀나"만 알고 "무엇을 했나"는 모른다. 분기마다 다른 화면을 내는 버튼은 핸들러가 선언한다:
//   keepReply(). 표가 뭐라 하든 두라 (고르는 동안 떠 있어야 하는 메뉴)
//   expireReply(). 기본 규칙이 거르더라도 지워라 (update로 선택 메뉴를 덮은 결과)

const DEFAULT_MS = 10_000;

// 슬래시 명령. 이름으로
const COMMANDS = {
  leave: 30_000, // 저장된 위치·대기열을 알려 준다
  queue: null,
  nowplaying: null,
  help: null,
  license: null,
  system: null,
  cachestatus: null,
  ping: null,
  setplaylistlimit: null, // 지금 값을 보여 준다
  sponsorblock: null, // 설정 화면
  setdjrole: null, // 설정 화면
};

// 버튼·메뉴·모달. custom_id의 ":" 앞
const COMPONENTS = {
  music_queue: null, // 대기열 보기
  help_refresh: null,
  system_refresh: null,
};

// 상호작용 토큰은 15분 뒤 죽는다. 그보다 긴 수명은 지울 수 없다
const TOKEN_MS = 15 * 60_000;

const scheduled = new WeakSet();
const kept = new WeakSet(); // 핸들러가 "이건 두라"고 선언한 응답
const expiring = new WeakMap(); // 핸들러가 "이건 지워라"고 선언한 응답 → 수명(ms)

/**
 * 이 응답은 지우지 않는다. 핸들러가 직접 선언한다.
 *
 * 표는 "무엇을 눌렀나"만 알고 "무엇을 했나"는 모른다. 자동재생 버튼처럼 한 customId가 분기마다
 * 다른 화면을 내면(끄기=결과, 켜기=선택 메뉴) 표로는 가를 수 없다.
 */
function keepReply(interaction) {
  if (interaction) kept.add(interaction);
}

/**
 * 이 응답은 지운다. 기본 규칙이 거르는 경우에도.
 *
 * update()로 답하면 discord.js가 ephemeral을 기록하지 않아 정리에서 빠진다. 설정 화면을 지키려는
 * 규칙이라 그대로 두되, 선택 메뉴를 결과로 덮은 경우처럼 지워야 하는 자리는 핸들러가 말한다.
 */
function expireReply(interaction, ms = DEFAULT_MS) {
  if (interaction) expiring.set(interaction, ms);
}

function lifetimeOf(interaction) {
  if (kept.has(interaction)) return null;
  if (expiring.has(interaction)) return expiring.get(interaction);
  const command = interaction.isChatInputCommand?.();
  const table = command ? COMMANDS : COMPONENTS;
  const key = command ? interaction.commandName : String(interaction.customId ?? "").split(":")[0];
  return Object.hasOwn(table, key) ? table[key] : DEFAULT_MS;
}

/** 핸들러가 끝난 뒤 부른다. 본인에게만 보이는 첫 응답이면 표에 따라 지우기를 예약한다. 여러 번 불려도 한 번만. */
function scheduleReplyCleanup(interaction) {
  if (!interaction || scheduled.has(interaction)) return;
  if (!(interaction.replied || interaction.deferred)) return;
  if (!interaction.ephemeral && !expiring.has(interaction)) return;
  const ms = lifetimeOf(interaction);
  if (ms == null || ms >= TOKEN_MS) return;
  scheduled.add(interaction);
  const timer = setTimeout(() => {
    Promise.resolve()
      .then(() => interaction.deleteReply())
      .catch(() => {}); // 이미 닫았거나 지웠다
  }, ms);
  timer.unref?.();
}

const exported = { scheduleReplyCleanup, keepReply, expireReply, lifetimeOf, DEFAULT_MS, COMMANDS, COMPONENTS };
export default exported;
export { exported as "module.exports" };

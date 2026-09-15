"use strict";

// 본인에게만 보이는 응답을 얼마 뒤 지울지 — 한 곳에서 정한다(2026-09-16). 쓰면서 불편하면 이 표만 고친다.
//   거절·오류("재생 중인 음악이 없습니다", 권한 부족, 입력 오류)와 조작 결과(일시정지·스킵·볼륨 …) → 기본값
//   읽는 화면과, 조작하는 동안 떠 있어야 하는 설정·선택 화면 → null(지우지 않는다 — 사용자가 닫는다)
// 버튼으로 기존 메시지를 고친 응답(update)은 대상이 아니다. 지우면 그 화면이 사라진다.

const DEFAULT_MS = 10_000;

// 슬래시 명령 — 이름으로
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

// 버튼·메뉴·모달 — custom_id의 ":" 앞
const COMPONENTS = {
  music_queue: null, // 대기열 보기
  music_autoplay: null, // 장르 선택 메뉴를 띄운다
  help_refresh: null,
  system_refresh: null,
};

// 상호작용 토큰은 15분 뒤 죽는다 — 그보다 긴 수명은 지울 수 없다
const TOKEN_MS = 15 * 60_000;

const scheduled = new WeakSet();

function lifetimeOf(interaction) {
  const command = interaction.isChatInputCommand?.();
  const table = command ? COMMANDS : COMPONENTS;
  const key = command ? interaction.commandName : String(interaction.customId ?? "").split(":")[0];
  return Object.hasOwn(table, key) ? table[key] : DEFAULT_MS;
}

/** 핸들러가 끝난 뒤 부른다 — 본인에게만 보이는 첫 응답이면 표에 따라 지우기를 예약한다. 여러 번 불려도 한 번만. */
function scheduleReplyCleanup(interaction) {
  if (!interaction?.ephemeral || !(interaction.replied || interaction.deferred) || scheduled.has(interaction)) return;
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

module.exports = { scheduleReplyCleanup, lifetimeOf, DEFAULT_MS, COMMANDS, COMPONENTS };

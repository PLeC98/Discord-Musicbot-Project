// 디스코드 쪽 아이콘 표. 키마다 머티리얼 기호(Material Symbols Rounded, data/discord-icons) · 모양 · 바탕색 · 유니코드(앱 이모지를 맞추기 전 · 못 맞췄을 때).
// 앱 이모지(봇이 자기 디스코드 앱에 올린 이모지)는 app/app-emojis 가 맞추고 여기에 싣는다. 쓰는 곳은 키로 묻고(icon · buttonEmoji), 직접 덧칠하지 않는다.
// 계획: notes/plan-discord-icons.md. 대시보드 화면 빌드가 이 파일을 거쳐 갈 수 있어 타입 말고는 아무것도 부르지 않는다

/**
 * 모양. tile: 둥근 사각형 타일 + 기호(회색 버튼 · 문장 안), white: 타일 없이 흰 기호(색 버튼), spin: 도는 타일(진행 중)
 * 기호 "sponsorblock" 은 SponsorBlock 의 하이라이트 방패(data/discord-icons/skipIcon.svg)
 */
type Shape = "tile" | "white" | "spin";
/** 타일의 바탕색. brand: 운영자 색(EMBED_COLOR), 나머지는 응답 색(ui/palette 의 FIXED_COLORS) */
type Tint = "brand" | "error" | "warning" | "done" | "notice";
/** scale: 글꼴 칸(960)이 이모지 칸에서 차지하는 비율(기본 0.88). tints: 그려 둘 바탕색(기본 brand 하나) */
type IconSpec = { glyph: string; unicode: string; shape?: Shape; tints?: readonly Tint[]; scale?: number };

const SEVERITY = ["error", "warning"] as const;

const ICONS = {
  // 버튼(지금 재생 패널 · 도움말 · 시스템 · 검색 · 대기열 보기). 색 버튼(초록 · 블러플 · 빨강) 위는 흰 기호
  prev: { glyph: "skip_previous", unicode: "⏮️" },
  play: { glyph: "play_arrow", unicode: "▶️" },
  pause: { glyph: "pause", unicode: "⏸️" },
  next: { glyph: "skip_next", unicode: "⏭️" },
  // 아이콘만 있는 빨강 버튼: 바탕이 비어 기호가 작아 보여 키운다
  stop: { glyph: "stop", unicode: "⏹️", shape: "white", scale: 1.2 },
  volume: { glyph: "volume_up", unicode: "🔊" },
  shuffle: { glyph: "shuffle", unicode: "🔀" },
  repeat: { glyph: "repeat", unicode: "🔁" },
  repeat_off: { glyph: "repeat", unicode: "➡️" },
  repeat_one: { glyph: "repeat_one", unicode: "🔂" },
  repeat_on: { glyph: "repeat", unicode: "🔁", shape: "white" },
  repeat_one_on: { glyph: "repeat_one", unicode: "🔂", shape: "white" },
  queue_button: { glyph: "queue_music", unicode: "📋", shape: "white" },
  autoplay: { glyph: "radio", unicode: "🎲", tints: ["brand", "warning"] },
  autoplay_on: { glyph: "radio", unicode: "🎲", shape: "white" },
  highlight: { glyph: "sponsorblock", unicode: "💡" },
  web: { glyph: "public", unicode: "🌐" },
  refresh: { glyph: "refresh", unicode: "🔄" },
  cancel: { glyph: "close", unicode: "❌", shape: "white" },
  page_prev: { glyph: "chevron_left", unicode: "◀" },
  page_next: { glyph: "chevron_right", unicode: "▶" },

  // 응답 머리 줄의 주제(오류 · 경고 안내, ui/frame). 머리 줄 크기라 기호 안의 기호를 쓰고, 타일은 그 응답 색.
  // 그려 두는 경고 수준은 그 주제로 안내를 만드는 곳이 쓰는 것만(시험이 맞춰 본다)
  failed: { glyph: "error", unicode: "❌", tints: ["error"] },
  permission: { glyph: "block", unicode: "🚫", tints: SEVERITY },
  voice: { glyph: "headphones", unicode: "🎧", tints: SEVERITY },
  stale: { glyph: "hourglass_disabled", unicode: "⌛", tints: ["warning"] },
  input: { glyph: "edit", unicode: "✏️", tints: ["warning"] },
  not_found: { glyph: "search_off", unicode: "🔍", tints: ["warning"] },
  link_off: { glyph: "link_off", unicode: "🔗", tints: ["warning"] },
  blocked: { glyph: "lock", unicode: "🔒", tints: SEVERITY },
  waiting: { glyph: "hourglass_top", unicode: "⏳", tints: ["brand", ...SEVERITY] },
  muted: { glyph: "volume_off", unicode: "🔇", tints: ["brand", "warning"] },
  state: { glyph: "warning", unicode: "⚠️", tints: ["warning"] },

  // 성공 응답의 머리 줄
  done: { glyph: "check_circle", unicode: "✅", tints: ["brand", "done"] },
  first_added: { glyph: "playlist_play", unicode: "⏫" },
  stopped: { glyph: "stop", unicode: "⏹️" },
  highlight_jump: { glyph: "sponsorblock", unicode: "✨" },
  replay: { glyph: "replay", unicode: "🔄" },
  seek: { glyph: "fast_forward", unicode: "⏩" },
  cleared: { glyph: "delete_sweep", unicode: "🗑️" },
  progress: { glyph: "progress_activity", unicode: "🔄", shape: "spin" },
  search: { glyph: "search", unicode: "🔍" },
  queue: { glyph: "queue_music", unicode: "📋" },
  channel: { glyph: "tag", unicode: "🔧", tints: ["done"] },
  dj_role: { glyph: "headphones", unicode: "🎧", tints: ["brand", "done"] },
  sponsorblock: { glyph: "sponsorblock", unicode: "⏭️", tints: ["brand", "done"] },
  playlist_add: { glyph: "playlist_add", unicode: "📃", tints: ["brand", "done"] },
  restored: { glyph: "restart_alt", unicode: "🔄" },
  music: { glyph: "music_note", unicode: "🎵" },

  // 정보 · 도움말 임베드의 제목 · 칸 이름
  system: { glyph: "computer", unicode: "🖥️" },
  uptime: { glyph: "timer", unicode: "⏱️" },
  memory: { glyph: "memory_alt", unicode: "💾" },
  cpu: { glyph: "memory", unicode: "⚙️" },
  runtime: { glyph: "terminal", unicode: "🔧" },
  cache: { glyph: "library_music", unicode: "📦" },
  album: { glyph: "album", unicode: "💿" },
  stats: { glyph: "bar_chart", unicode: "📊" },
  misc: { glyph: "more_horiz", unicode: "🔧" },
  top: { glyph: "emoji_events", unicode: "🏆" },
  recent: { glyph: "new_releases", unicode: "🆕" },
  license: { glyph: "license", unicode: "📜" },
  license_terms: { glyph: "balance", unicode: "⚖️" },
  license_summary: { glyph: "article", unicode: "📑" },
  license_text: { glyph: "menu_book", unicode: "📚" },
  link: { glyph: "link", unicode: "🔗" },
  artist: { glyph: "mic", unicode: "🎤" },
  modes: { glyph: "tune", unicode: "🎛️" },
  session: { glyph: "hub", unicode: "📡" },
  inputs: { glyph: "list", unicode: "📋" },
  shield: { glyph: "shield", unicode: "🛡️" },

  // 문장 안(본문 · 작은 글씨 · 상태). 본문 크기라 기호 안의 기호(check_circle 등)는 쓰지 않는다
  ok: { glyph: "check", unicode: "✅" },
  person: { glyph: "person", unicode: "👤" },
  idle: { glyph: "bedtime", unicode: "💤" },
  position: { glyph: "format_list_numbered", unicode: "📍" },
  time: { glyph: "schedule", unicode: "⏱️" },
  resume: { glyph: "history", unicode: "💾" },
  alone: { glyph: "person_off", unicode: "⏳" },
  dashboard: { glyph: "dashboard", unicode: "🔗" },
  invite: { glyph: "person_add", unicode: "📄" },
  servers: { glyph: "dns", unicode: "🏠" },
  users: { glyph: "group", unicode: "👥" },
  players: { glyph: "graphic_eq", unicode: "🎵" },
  dj: { glyph: "lock", unicode: "🔒" },

  // 운영자 공지(대시보드에서 보내는 임베드의 제목)
  announce_maintenance: { glyph: "build", unicode: "🔧", tints: ["warning"] },
  announce_update: { glyph: "new_releases", unicode: "🆕", tints: ["done"] },
  announce_alert: { glyph: "warning", unicode: "⚠️", tints: ["error"] },
  announce_info: { glyph: "info", unicode: "ℹ️", tints: ["notice"] },
} as const satisfies Record<string, IconSpec>;

type IconKey = keyof typeof ICONS;

/** 앱 이모지 이름: 키, 운영자 색이 아닌 바탕색이면 뒤에 붙인다(앱 안에서 하나뿐이어야 한다. 2 ~ 32자 [A-Za-z0-9_]) */
const emojiName = (key: IconKey, tint: Tint = "brand") => (tint === "brand" ? key : `${key}_${tint}`);

/** 그려 둘 앱 이모지 전부: 이름 · 키 · 바탕색 · 표의 값 */
function iconEntries(): Array<{ name: string; key: IconKey; tint: Tint; spec: IconSpec }> {
  return (Object.entries(ICONS) as Array<[IconKey, IconSpec]>).flatMap(([key, spec]) => (spec.tints ?? ["brand"]).map((tint) => ({ name: emojiName(key, tint), key, tint, spec })));
}

/** 맞춘 앱 이모지(이름 → id · 움직이는가). app/app-emojis 가 싣는다 */
const uploaded = new Map<string, { id: string; animated: boolean }>();

/** 맞춘 것을 통째로 바꾼다 */
function useUploaded(next: ReadonlyMap<string, { id: string; animated: boolean }>) {
  uploaded.clear();
  for (const [name, value] of next) uploaded.set(name, value);
}

/** 그 바탕색으로 그려 두지 않은 키면 운영자 색으로 */
const tintOf = (key: IconKey, tint: Tint): Tint => (((ICONS[key] as IconSpec).tints ?? ["brand"]).includes(tint) ? tint : ((ICONS[key] as IconSpec).tints ?? ["brand"])[0]);

/** 문장 안의 아이콘: 앱 이모지(<:이름:id>, 움직이면 <a:…>) 또는 유니코드 */
function icon(key: IconKey, tint: Tint = "brand"): string {
  const name = emojiName(key, tintOf(key, tint));
  const found = uploaded.get(name);
  return found ? `<${found.animated ? "a" : ""}:${name}:${found.id}>` : ICONS[key].unicode;
}

/** 버튼의 이모지: 앱 이모지면 { id, name, animated }, 아니면 유니코드 { name } */
function buttonEmoji(key: IconKey, tint: Tint = "brand"): { id: string; name: string; animated: boolean } | { name: string } {
  const name = emojiName(key, tintOf(key, tint));
  const found = uploaded.get(name);
  return found ? { id: found.id, name, animated: found.animated } : { name: ICONS[key].unicode };
}

export { ICONS, emojiName, iconEntries, useUploaded, icon, buttonEmoji };
export type { IconKey, IconSpec, Shape, Tint };

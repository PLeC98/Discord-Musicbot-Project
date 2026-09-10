"use strict";

// yt-dlp의 YouTube player_client 순서와 "자주 헛발질하는 클라이언트" 판정.
//
// 왜 필요한가: yt-dlp에 클라이언트를 여러 개 넘기면 **전부 호출해서 포맷을 병합한다.**
// "앞에서부터 시도하다 성공하면 멈춤"이 아니다. 그 시맨틱은 우리가 하나씩 넘겨야 생긴다.
//
// 왜 "죽었다"가 아니라 "헛발질"인가: 같은 클라이언트·같은 영상도 실행마다 결과가 갈린다
// (실측 2026-09-11: POT 없는 web이 한 영상에서 성공했다가 다음 배치에서 실패). 유튜브의
// SABR 적용이 세션·영상 단위로 굴러가기 때문이다. 그래서 확정 판정이 불가능하고,
// **최근 N회 중 M회 실패**라는 빈도로만 다룬다. 20%만 성공하는 클라이언트를 1순위에 두면
// 5번 중 4번을 헛도므로, 빼는 쪽이 이득이라는 판단이다.

const log = require("./logger").child({ category: "youtube", sub: "client" });

// 2026-09-11 기준, yt-dlp가 알아듣는 것을 확인한 이름들.
// 기동 시 "우리가 아는 목록에 없다"고 한 줄 알려주는 용도. 목록에 없어도 그대로 yt-dlp에 넘김.
// 이걸로 거르면 yt-dlp가 나중에 추가하는 클라이언트를 우리가 막게 됨.
const KNOWN = ["web", "web_safari", "web_embedded", "web_music", "web_creator", "mweb", "android", "android_vr", "ios", "tv", "tv_simply", "tv_downgraded", "visionos"];

// POToken이 있어야 제대로 되는 것
// 유튜브가 바꾸면 이 표가 먼저 틀려지므로, 판단의 최종 근거는 실행 중 관측이다.
const NEEDS_POT = ["mweb", "tv_simply"];

/**
 * 쉼표 구분 문자열 → 클라이언트 배열. 정규화(소문자·공백·중복)만 하고 **이름은 검사하지 않는다.**
 *
 * 아는 이름 목록을 우리가 들고 있으면 그건 yt-dlp 지식의 낡은 사본이 된다 — yt-dlp가 새 클라이언트를
 * 추가하면 우리가 막고, 없앤 것은 우리 목록에 남는다(실제로 2026-09-11에 우리 목록의 4개가
 * 이미 없는 이름이었다). 유효한지는 yt-dlp가 판단하고, 아니면 경고를 뱉는다.
 *
 * 그 경고는 그냥 넘기면 안 된다: **모르는 이름을 만나면 yt-dlp는 실패하는 게 아니라 기본
 * 클라이언트로 조용히 떨어져 성공한다.** 그러면 우리 폴백 루프는 첫 항목에서 성공으로 끝나고,
 * 뒤 목록은 통째로 사문화된다. 그래서 YouTube._inspectWarnings가 그 줄을 warn으로 올린다.
 */
function parseClients(raw) {
  if (!raw) return [];
  const out = [];
  for (const piece of String(raw).split(",")) {
    const name = piece.trim().toLowerCase();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

class PlayerClients {
  /**
   * @param {string[]} order   시도할 순서. 비어 있으면 이 모듈은 아무것도 하지 않는다
   *                           (호출부가 yt-dlp 기본값으로 1회 호출하고 끝낸다)
   * @param {number} window    최근 몇 회를 보고 판정할지
   * @param {number} fails     그중 몇 회가 실패면 제외할지
   */
  constructor(order = [], { window = 5, fails = 3 } = {}) {
    this.order = order;
    this.window = Math.max(1, window);
    this.fails = Math.max(1, fails);
    this.history = new Map(); // client → ("ok"|"ng")[] 최근 것이 뒤
    this.excluded = new Set();
    this.exhaustedLogged = false;
  }

  /** 설정이 비었는가 — 그러면 폴백 루프 자체를 돌지 않는다(지금까지와 동일 동작) */
  get idle() {
    return this.order.length === 0;
  }

  /** 지금 시도할 순서. 전부 제외됐으면 빈 배열 */
  list() {
    return this.order.filter((c) => !this.excluded.has(c));
  }

  /**
   * 결과 기록. **클라이언트 탓으로 판단한 실패만** 넣는다 —
   * 영상이 삭제됐거나 연령 제한이거나 네트워크가 끊긴 것은 클라이언트의 잘못이 아니고,
   * 그걸 섞으면 멀쩡한 클라이언트가 제외된다.
   * @param {string} client
   * @param {boolean} ok
   */
  record(client, ok) {
    if (!client || this.excluded.has(client)) return;
    const h = this.history.get(client) || [];
    h.push(ok ? "ok" : "ng");
    while (h.length > this.window) h.shift();
    this.history.set(client, h);

    if (h.length < this.window) return;
    const ng = h.filter((x) => x === "ng").length;
    if (ng < this.fails) return;

    this.excluded.add(client);
    log.warn(`${client} 를 이번 실행 동안 건너뜁니다 (최근 ${h.length}회 중 ${ng}회 실패). .env에서 빼는 것을 검토하세요`);
  }

  /** 전멸했을 때 한 번만 알린다 — 매 곡마다 같은 줄을 쌓지 않도록 */
  noteExhausted() {
    if (this.exhaustedLogged) return;
    this.exhaustedLogged = true;
    log.warn(`지정한 클라이언트가 모두 제외됐습니다. yt-dlp 기본값으로 진행합니다`);
  }

  /** 로그·대시보드용 */
  snapshot() {
    return {
      order: [...this.order],
      excluded: [...this.excluded],
      history: Object.fromEntries(this.history),
    };
  }
}

module.exports = { PlayerClients, parseClients, KNOWN, NEEDS_POT };

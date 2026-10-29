// yt-dlp의 YouTube player_client 순서와 죽은 것 같은 클라이언트 판정
//
// yt-dlp에 클라이언트를 여러 개 넘기면 전부 호출해서 포맷을 병합한다. 폴백하지 않는다.
//
// "죽은 것 같은"인 이유: 같은 클라이언트·같은 영상도 실행마다 결과가 달라진다(유튜브의 SABR 적용이 세션·영상 단위라서).
// 그래서 최근 N회 중 M회 실패라는 빈도로만 판정하고, 제외한 것도 시간이 지나면 다시 테스트한다.

import logger from "../../infra/log/logger.ts";
const log = logger.child({ category: "youtube", sub: "client" });
import config from "../../config/index.ts";
import { josa } from "../../rules/josa.ts";

// yt-dlp가 알아듣는 것을 확인한 클라이언트 이름. 목록에 없는 이름은 기동 시 한 줄 알리고 상태 화면에 표시만 한다.
// 필터링하지 않고 그대로 yt-dlp에 넘긴다(필터링하면 yt-dlp가 나중에 추가하는 클라이언트를 막게 된다).
const KNOWN = ["web", "web_safari", "web_embedded", "web_music", "web_creator", "mweb", "android", "android_vr", "ios", "tv", "tv_simply", "tv_downgraded", "visionos"];

// POToken이 있어야 제대로 되는 것. 유튜브가 바꾸면 이 표가 먼저 틀려지므로, 판단의 최종 근거는 실행 중 관측값이다.
//
// web_creator는 설정에서 선택하는 값이 아니다. 연령 제한 영상에서 yt-dlp가 알아서 끼워 넣는다.
// POToken 없이 부르면 오디오 전용 포맷을 모두 버리고 360p 영상+소리 포맷 하나만 남긴다.
// 정상 동작이므로 경고가 아니라 debug로 남긴다.
const NEEDS_POT = ["mweb", "tv_simply", "web_creator"];

class PlayerClients {
  order: string[];
  window: number;
  fails: number;
  history: Map<string, Array<"ok" | "ng">>; // 최근 것이 뒤
  excluded: Map<string, number>; // 클라이언트 → 제외한 시각(ms)
  retryMs: number;
  now: () => number;
  exhaustedLogged: boolean;

  /**
   * @param {string[]} order   시도할 순서. 비어 있으면 이 모듈은 아무것도 하지 않는다
   *                           (호출부가 yt-dlp 기본값으로 1회 호출하고 끝낸다)
   * @param {number} window    최근 몇 회를 보고 판정할지
   * @param {number} fails     그중 몇 회가 실패면 제외할지
   * @param {number} retryMs   제외한 뒤 다시 테스트하기까지. 0 이면 실행 내내 제외
   */
  constructor(order: string[] = [], { window = 5, fails = 3, retryMs = 0, now = Date.now }: { window?: number; fails?: number; retryMs?: number; now?: () => number } = {}) {
    this.order = order;
    this.window = Math.max(1, window);
    this.fails = Math.max(1, fails);
    this.retryMs = Math.max(0, retryMs);
    this.now = now;
    this.history = new Map();
    this.excluded = new Map();
    this.exhaustedLogged = false;
  }

  /** 설정이 비었는가. 그러면 폴백 루프 자체를 돌지 않는다 */
  get idle() {
    return this.order.length === 0;
  }

  /** 지금 시도할 순서. 전부 제외됐으면 빈 배열. 제외한 지 retryMs 가 지난 것은 기록을 비우고 다시 넣는다 */
  list() {
    if (this.retryMs > 0) {
      for (const [client, at] of this.excluded) {
        if (this.now() - at < this.retryMs) continue;
        this.excluded.delete(client);
        this.history.delete(client);
        this.exhaustedLogged = false;
        log.info(`${client}${josa(client, "을")} 다시 테스트합니다 (제외한 지 ${Math.round((this.now() - at) / 60000)}분)`);
      }
    }
    return this.order.filter((c) => !this.excluded.has(c));
  }

  /**
   * 결과 기록. 클라이언트 탓으로 판단한 실패만.
   * 영상이 삭제됐거나 연령 제한이거나 네트워크가 끊긴 것은 클라이언트의 잘못이 아니고,
   * 그걸 섞으면 멀쩡한 클라이언트가 제외된다.
   */
  record(client: string | null | undefined, ok: boolean) {
    if (!client || this.excluded.has(client)) return;
    const h = this.history.get(client) || [];
    h.push(ok ? "ok" : "ng");
    while (h.length > this.window) h.shift();
    this.history.set(client, h);

    if (h.length < this.window) return;
    const ng = h.filter((x) => x === "ng").length;
    if (ng < this.fails) return;

    this.excluded.set(client, this.now());
    const until = this.retryMs > 0 ? `${Math.round(this.retryMs / 60000)}분 동안` : "이번 실행 동안";
    log.warn(`${client}${josa(client, "을")} ${until} 건너뜁니다 (최근 ${h.length}회 중 ${ng}회 실패). 계속 되풀이되면 유튜브 탭의 "유튜브 클라이언트 순서"에서 빼는 것을 검토하세요`);
  }

  // 모든 클라이언트가 제외됐을 때 한 번만 알린다(곡마다 같은 줄을 쌓지 않게)
  noteExhausted() {
    if (this.exhaustedLogged) return;
    this.exhaustedLogged = true;
    log.warn(`지정한 클라이언트가 모두 제외됐습니다. yt-dlp 기본값으로 진행합니다`);
  }

  // 로그·대시보드용
  snapshot() {
    return {
      order: [...this.order],
      excluded: [...this.excluded.keys()],
      history: Object.fromEntries(this.history),
    };
  }
}

// 봇 전체에 PlayerClients 하나. 설정은 쓸 때 읽고, 운영 조절값이 바뀌었으면 새로 만든다(그동안의 실패 기록은 처음부터)
let table: PlayerClients | null = null;
let tableOf = "";
function playerClients() {
  const { playerClients: order, clientWindow, clientFails: fails, clientRetryMs: retryMs } = config.ytdlp;
  const settings = JSON.stringify([order, clientWindow, fails, retryMs]);
  if (!table || settings !== tableOf) {
    table = new PlayerClients(order, { window: clientWindow, fails, retryMs });
    tableOf = settings;
  }
  return table;
}

export { PlayerClients, KNOWN, NEEDS_POT, playerClients };

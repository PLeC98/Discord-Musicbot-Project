import { ActivityType } from "discord.js";
import lunarCalendar from "korean-lunar-calendar";
import * as statusConfig from "../config/status.ts";
import type { ActivityMessage, StatusConfig } from "../config/status.ts";

// 라이브러리가 ESM 판(.mjs)에도 CJS 로 읽히는 타입 파일(.d.ts)을 붙여 TS 는 기본값을 모듈 전체로 본다.
// Node 는 .mjs 를 열고 그 기본값이 클래스다
const KoreanLunarCalendar = lunarCalendar as unknown as typeof lunarCalendar.default;

// Custom은 말머리("듣는 중" 같은 것) 없이 문구만 보여준다.
// discord.js가 알아서 state로 옮겨 주므로 여기서는 이름만 넘기면 된다(ClientPresence 참고).
const TYPE_MAP: Record<string, ActivityType> = {
  Playing: ActivityType.Playing,
  Listening: ActivityType.Listening,
  Watching: ActivityType.Watching,
  Competing: ActivityType.Competing,
  Custom: ActivityType.Custom,
};

type Range = { start: string; end: string };
/** 풀어 적은 문구 */
type Message = Exclude<ActivityMessage, string>;

// "12-24 ~ 12-26" → { start, end }. 손으로 적는 파일이라 공백은 있든 없든 받는다.
function parseRange(value: unknown): Range | null {
  if (typeof value !== "string") return null;
  const [start, end] = value.split("~").map((part) => part.trim());
  return start && end ? { start, end } : null;
}

// 문구는 그냥 한 줄로 적어도 되고, 활동 종류가 필요할 때만 text/type으로 풀어 적는다.
function toMessage(item: ActivityMessage): Message | null {
  if (typeof item === "string") return { text: item };
  return item && typeof item === "object" ? item : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 오늘(MM-DD) · 음력 오늘 · 지금(HH:MM). 시험은 정한 날을 준다 */
type Calendar = { today(): string; todayLunar(): string; now(): string };
const CALENDAR: Calendar = {
  today() {
    const now = new Date();
    return `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  },
  // 오늘 양력 → 음력으로 바꿔 비교한다
  todayLunar() {
    const now = new Date();
    const cal = new KoreanLunarCalendar();
    cal.setSolarDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const lunar = cal.getLunarCalendar();
    return `${pad(lunar.month)}-${pad(lunar.day)}`;
  },
  now() {
    const now = new Date();
    return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  },
};

/** 활동을 거는 쪽. 로그인 전에는 user 가 없다 */
type PresenceClient = { user?: { setActivity(activity: { name: string; type: ActivityType }): unknown } | null };
type Deps = { load?: () => StatusConfig; calendar?: Calendar };

class StatusManager {
  static TYPE_MAP = TYPE_MAP;
  static parseRange = parseRange;
  static toMessage = toMessage;
  static CALENDAR = CALENDAR;

  client: PresenceClient;
  // 부를 때마다 읽는다. 로더가 mtime을 보고 바뀌었을 때만 실제로 다시 읽는다.
  // 코드에 박힌 기본값으로 조용히 넘어가지 않는다: 파일이 없으면 로더가 기동을 멈추고 무엇을 할지 알린다.
  load: () => StatusConfig;
  calendar: Calendar;
  rotationIndex = 0;
  intervalId: NodeJS.Timeout | null = null;

  constructor(client: PresenceClient, { load = statusConfig.status, calendar = CALENDAR }: Deps = {}) {
    this.client = client;
    this.load = load;
    this.calendar = calendar;
  }

  // 시작이 끝보다 크면 자정·연말을 걸친 범위다 (22:00~06:00, 12-28~01-05)
  inRange(cur: string, range: Range | null) {
    if (!range) return true;
    return range.start <= range.end ? cur >= range.start && cur <= range.end : cur >= range.start || cur <= range.end;
  }

  // 위에서부터 먼저 맞는 항목 하나. 조건을 둘 이상 적었으면 전부 맞아야 한다.
  getCurrentEntry(config: StatusConfig) {
    for (const entry of Object.values(config.special ?? {})) {
      if (!entry || typeof entry !== "object") continue;
      if (!this.inRange(this.calendar.today(), parseRange(entry.date))) continue;
      if (!this.inRange(this.calendar.todayLunar(), parseRange(entry.lunar))) continue;
      if (!this.inRange(this.calendar.now(), parseRange(entry.time))) continue;

      const picked = this.pick(entry.messages);
      if (picked) return picked;
    }
    return this.pick(config.messages);
  }

  pick(messages: ActivityMessage[] | undefined) {
    const list = (Array.isArray(messages) ? messages : []).map(toMessage).filter((m): m is Message => Boolean(m?.text));
    if (!list.length) return null;
    return list[this.rotationIndex % list.length];
  }

  apply() {
    const config = this.load();
    const entry = this.getCurrentEntry(config);
    if (!entry || !this.client.user) return;
    const type = (entry.type ? TYPE_MAP[entry.type] : undefined) ?? ActivityType.Listening;
    this.client.user.setActivity({ name: entry.text, type });
  }

  start() {
    const config = this.load();
    const intervalSec = Math.max(Number(config.interval ?? 30), 10);

    this.apply();

    this.intervalId = setInterval(() => {
      this.rotationIndex++;
      this.apply();
    }, intervalSec * 1000);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}

export default StatusManager;
export { StatusManager as "module.exports" };

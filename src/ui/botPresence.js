const { ActivityType } = require("discord.js");
const KoreanLunarCalendar = require("korean-lunar-calendar");
const statusConfig = require("../config/status");

// Custom은 말머리("듣는 중" 같은 것) 없이 문구만 보여준다.
// discord.js가 알아서 state로 옮겨 주므로 여기서는 이름만 넘기면 된다(ClientPresence 참고).
const TYPE_MAP = {
  Playing: ActivityType.Playing,
  Listening: ActivityType.Listening,
  Watching: ActivityType.Watching,
  Competing: ActivityType.Competing,
  Custom: ActivityType.Custom,
};

// "12-24 ~ 12-26" → { start, end }. 손으로 적는 파일이라 공백은 있든 없든 받는다.
function parseRange(value) {
  if (typeof value !== "string") return null;
  const [start, end] = value.split("~").map((part) => part.trim());
  return start && end ? { start, end } : null;
}

// 문구는 그냥 한 줄로 적어도 되고, 활동 종류가 필요할 때만 text/type으로 풀어 적는다.
function toMessage(item) {
  if (typeof item === "string") return { text: item };
  return item && typeof item === "object" ? item : null;
}

class StatusManager {
  constructor(client) {
    this.client = client;
    this.rotationIndex = 0;
    this.intervalId = null;
  }

  // 부를 때마다 읽는다. 로더가 mtime을 보고 바뀌었을 때만 실제로 다시 읽는다.
  // 코드에 박힌 기본값으로 조용히 넘어가지 않는다: 파일이 없으면 로더가 기동을 멈추고 무엇을 할지 알린다.
  load() {
    return statusConfig.status();
  }

  // 시작이 끝보다 크면 자정·연말을 걸친 범위다 (22:00~06:00, 12-28~01-05)
  inRange(cur, range) {
    if (!range) return true;
    return range.start <= range.end ? cur >= range.start && cur <= range.end : cur >= range.start || cur <= range.end;
  }

  today() {
    const now = new Date();
    return `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }

  // 오늘 양력 → 음력으로 바꿔 비교한다
  todayLunar() {
    const now = new Date();
    const cal = new KoreanLunarCalendar();
    cal.setSolarDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
    const lunar = cal.getLunarCalendar();
    return `${String(lunar.month).padStart(2, "0")}-${String(lunar.day).padStart(2, "0")}`;
  }

  now() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  }

  // 위에서부터 먼저 맞는 항목 하나. 조건을 둘 이상 적었으면 전부 맞아야 한다.
  getCurrentEntry(config) {
    for (const entry of Object.values(config.special ?? {})) {
      if (!entry || typeof entry !== "object") continue;
      if (!this.inRange(this.today(), parseRange(entry.date))) continue;
      if (!this.inRange(this.todayLunar(), parseRange(entry.lunar))) continue;
      if (!this.inRange(this.now(), parseRange(entry.time))) continue;

      const picked = this.pick(entry.messages);
      if (picked) return picked;
    }
    return this.pick(config.messages);
  }

  pick(messages) {
    const list = (Array.isArray(messages) ? messages : []).map(toMessage).filter((m) => m?.text);
    if (!list.length) return null;
    return list[this.rotationIndex % list.length];
  }

  apply() {
    const config = this.load();
    const entry = this.getCurrentEntry(config);
    if (!entry || !this.client.user) return;
    const type = TYPE_MAP[entry.type] ?? ActivityType.Listening;
    this.client.user.setActivity({ name: entry.text, type });
  }

  start() {
    const config = this.load();
    const intervalSec = Math.max(config.interval ?? 30, 10);

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

module.exports = StatusManager;
module.exports.TYPE_MAP = TYPE_MAP;
module.exports.parseRange = parseRange;
module.exports.toMessage = toMessage;

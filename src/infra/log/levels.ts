// 로그 레벨과 대시보드로 보내는 로그 한 줄. 로거 · 로그 저장(sink) · 설정 검사 · 대시보드 로그 화면이 같이 쓴다

/** 레벨 이름. 낮은 것부터(pino 와 같은 체계) */
const LEVEL_NAMES = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
type LevelName = (typeof LEVEL_NAMES)[number];
/** 레벨 이름 → 숫자(pino 와 같은 값) */
const LEVELS: Record<LevelName, number> = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const isLevel = (v: unknown): v is LevelName => typeof v === "string" && Object.hasOwn(LEVELS, v);
/** 숫자 → 레벨 이름. 모르는 숫자면 undefined */
const levelNameOf = (value: number): LevelName | undefined => LEVEL_NAMES.find((name) => LEVELS[name] === value);

/** 대시보드(SSE)로 보내는 한 줄. id 는 이 프로세스 안에서 오르는 줄 번호(다시 붙을 때 이어 받기), level 은 레벨 이름 */
type WireEntry = { id: number; ts: number; level: LevelName; text: string; category?: string; sub?: string; tags?: string[] };
/** 줄 번호를 뺀 한 줄. 실시간 로그와 로그 파일 보기가 같은 칸을 쓴다 */
type WireFields = Omit<WireEntry, "id">;

const ANSI_RE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

/**
 * 로그 레코드(pino JSON 부분집합: level 숫자 · time · msg · 바인딩)를 대시보드의 한 줄로. 가리기는 레코드를 남기기 전에 이미 했다.
 * 파일에서 읽은 레코드도 받으므로 바인딩의 모양을 확인한다
 */
function wireFields(rec: { level: number; time: number; msg?: unknown; category?: unknown; sub?: unknown; tags?: unknown }): WireFields {
  const entry: WireFields = {
    ts: rec.time,
    // 실제 레벨 이름 그대로. 몇 가지로 접으면 debug와 trace가, fatal과 error가 합쳐져 대시보드가 가르지 못한다
    level: levelNameOf(rec.level) || "info",
    text: typeof rec.msg === "string" ? rec.msg.replace(ANSI_RE, "") : String(rec.msg ?? ""),
  };
  if (typeof rec.category === "string" && rec.category) entry.category = rec.category; // 있을 때만
  if (typeof rec.sub === "string" && rec.sub) entry.sub = rec.sub; // 하위 카테고리(pino child 바인딩)
  if (Array.isArray(rec.tags) && rec.tags.length) entry.tags = rec.tags.map(String); // 교차 태그
  return entry;
}

/** 쌓아 두는 줄 수. 대시보드가 붙을 때 이만큼 보낸다 */
const KEPT_LINES = 2000;
/**
 * 화면이 들고 있는 줄 수. 쌓아 두는 줄보다 넉넉하다: 빠진 줄은 쌓아 둔 줄이 꽉 찼을 때만 생기고 다시 붙으면 그만큼이 한꺼번에 오므로,
 * 같은 수면 "받지 못했어요" 줄과 그 앞의 줄이 바로 밀려난다
 */
const SHOWN_LINES = 3000;

/** 다시 붙었을 때 이어 받을 줄이 이미 쌓아 둔 줄 밖으로 밀려났다(SSE event: gap). missed 는 받지 못한 줄 수(번호가 빠짐없이 이어져 정확하다) */
type LogGap = { missed: number };

export { LEVEL_NAMES, LEVELS, isLevel, levelNameOf, wireFields, KEPT_LINES, SHOWN_LINES };
export type { LevelName, WireEntry, WireFields, LogGap };

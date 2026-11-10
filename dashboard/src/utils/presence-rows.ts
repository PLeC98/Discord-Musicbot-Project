// 상태 문구 설정("status" 문서) ↔ 편집 행. 편집 중에는 배열로 다룬다. 맵으로 두면 이름을 고치는 순간 키가 바뀌어 입력이 튄다.
// 문구는 그냥 한 줄로 적은 것(글만)과 풀어 적은 것({ text, type })이 섞여 있을 수 있다

import type { ActivityType } from "../../../src/config/schema/status.ts";
import { text } from "../text/index.ts";
import { keysFrom } from "./row-keys.ts";

/** 문구 한 줄. type 이 "" 이면 파일에 종류를 적지 않는다(기본 = 듣는 중) */
type MessageRow = { key: number; text: string; type: ActivityType | "" };
/** 특별 문구 하나. 양력, 음력, 시간대 중 적은 것이 맞을 때 평소 문구 대신 돈다 */
type SpecialRow = { key: number; name: string; date: string; lunar: string; time: string; messages: MessageRow[] };
/** 특별 문구가 맞는지 보는 조건 */
type ConditionKey = "date" | "lunar" | "time";

/** 파일에 적힌 문구 하나 */
type MessageData = string | { text?: string; type?: ActivityType | "" };
type SpecialData = Partial<Record<ConditionKey, string>> & { messages?: MessageData[] };

const CONDITIONS: Array<{ key: ConditionKey; label: string }> = [
  { key: "date", label: text.presence.conditionDate },
  { key: "lunar", label: text.presence.conditionLunar },
  { key: "time", label: text.presence.conditionTime },
];

let serial = 0;
const nextKey = () => ++serial;

const newMessage = (): MessageRow => ({ key: nextKey(), text: "", type: "" });
const newSpecial = (): SpecialRow => ({ key: nextKey(), name: "", date: "", lunar: "", time: "", messages: [newMessage()] });

/** before: 지금 행. 같은 자리의 문구는 key 를 물려받는다(저장, 되돌리기, utils/row-keys) */
const toMessages = (list: MessageData[] | null | undefined, before: MessageRow[] = []): MessageRow[] =>
  (list || []).map((m, i) => {
    const key = before[i]?.key ?? nextKey();
    return typeof m === "string" ? { key, text: m, type: "" } : { key, text: m?.text || "", type: m?.type || "" };
  });
const fromMessages = (list: MessageRow[]): MessageData[] => list.map((m) => (m.type ? { text: m.text, type: m.type } : m.text));

/** before: 지금 행. 이름이 같은 항목(없으면 같은 자리)은 key 와 문구의 key 를 물려받는다(utils/row-keys) */
const toSpecial = (map: Record<string, SpecialData> | null | undefined, before: SpecialRow[] = []): SpecialRow[] => {
  const entries = Object.entries(map || {});
  const keys = keysFrom(
    entries.map(([name]) => name),
    before,
    nextKey,
  );
  return entries.map(([name, e], i) => ({
    key: keys[i],
    name,
    date: e?.date || "",
    lunar: e?.lunar || "",
    time: e?.time || "",
    messages: toMessages(e?.messages, before.find((one) => one.key === keys[i])?.messages),
  }));
};

const fromSpecial = (list: SpecialRow[]): Record<string, SpecialData> =>
  Object.fromEntries(
    list.map((e) => {
      const entry: SpecialData = {};
      for (const cond of CONDITIONS) if (e[cond.key]?.trim()) entry[cond.key] = e[cond.key].trim();
      entry.messages = fromMessages(e.messages);
      return [e.name.trim(), entry];
    }),
  );

export { CONDITIONS, newMessage, newSpecial, toMessages, fromMessages, toSpecial, fromSpecial };
export type { MessageRow, SpecialRow, ConditionKey, MessageData, SpecialData };

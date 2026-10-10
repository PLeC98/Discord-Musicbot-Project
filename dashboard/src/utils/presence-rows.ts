// 상태 문구 설정("status" 문서) ↔ 편집 줄. 편집 중에는 배열로 다룬다. 맵으로 두면 이름을 고치는 순간 키가 바뀌어 입력이 튄다.
// 문구는 그냥 한 줄로 적은 것(글만)과 풀어 적은 것({ text, type })이 섞여 있을 수 있다

import type { ActivityType } from "../../../src/config/schema/status.ts";
import { text } from "../text/index.ts";

/** 문구 한 줄. type 이 "" 이면 파일에 종류를 적지 않는다(기본 = 듣는 중) */
type MessageRow = { key: number; text: string; type: ActivityType | "" };
/** 특별 문구 하나. 양력 · 음력 · 시간대 중 적은 것이 맞을 때 평소 문구 대신 돈다 */
type SpecialRow = { key: number; name: string; date: string; lunar: string; time: string; messages: MessageRow[] };
/** 특별 문구가 맞는지 보는 조건 */
type ConditionKey = "date" | "lunar" | "time";

/** 파일에 적힌 문구 하나 */
type MessageData = string | { text?: string; type?: ActivityType | "" };
type SpecialData = Partial<Record<ConditionKey, string>> & { messages?: MessageData[] };

const CONDITIONS: Array<{ key: ConditionKey; label: string; placeholder: string }> = [
  { key: "date", label: text.presence.conditionDate, placeholder: "12-24 ~ 12-26" },
  { key: "lunar", label: text.presence.conditionLunar, placeholder: "01-01 ~ 01-15" },
  { key: "time", label: text.presence.conditionTime, placeholder: "22:00 ~ 06:00" },
];

let serial = 0;
const nextKey = () => ++serial;

const newMessage = (): MessageRow => ({ key: nextKey(), text: "", type: "" });
const newSpecial = (): SpecialRow => ({ key: nextKey(), name: "", date: "", lunar: "", time: "", messages: [newMessage()] });

const toMessages = (list: MessageData[] | null | undefined): MessageRow[] => (list || []).map((m) => (typeof m === "string" ? { key: nextKey(), text: m, type: "" } : { key: nextKey(), text: m?.text || "", type: m?.type || "" }));
const fromMessages = (list: MessageRow[]): MessageData[] => list.map((m) => (m.type ? { text: m.text, type: m.type } : m.text));

const toSpecial = (map: Record<string, SpecialData> | null | undefined): SpecialRow[] =>
  Object.entries(map || {}).map(([name, e]) => ({
    key: nextKey(),
    name,
    date: e?.date || "",
    lunar: e?.lunar || "",
    time: e?.time || "",
    messages: toMessages(e?.messages),
  }));

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

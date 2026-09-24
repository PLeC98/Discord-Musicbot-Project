// 설정 파일 스키마가 같이 쓰는 도우미. 스키마는 문제 목록만 낸다. 던질지 경고할지는 부르는 쪽이 정한다.

import { z } from "zod";

// 문구. 그대로 쓰거나 검사한 값을 받아 만든다
type Message = NonNullable<z.core.$ZodCustomParams["error"]>;
// 오류가 난 곳(path) → { 자리 이름: 값 }
type Fill = (path: PropertyKey[]) => Record<string, unknown>;

const ALWAYS = { when: () => true }; // 칸 하나가 틀려도 교차 검사를 돌린다. 문제를 한 번에 다 알린다

// 있으면(null · undefined 가 아니면) 조건을 본다
const present = (ok: (v: unknown) => boolean, message: Message) =>
  z
    .unknown()
    .refine((v) => v == null || ok(v), { error: message })
    .optional();

// 이름을 붙인 목록을 Object.keys 로 읽던 것과 같게: 무엇이 오든 키 → 값 표로
const keyed = (v: unknown): Record<string, unknown> => Object.fromEntries(Object.keys(v || {}).map((k) => [k, (v as Record<string, unknown>)[k]]));

// 표가 아니면 빈 표로(값이 없던 것과 같게 읽는다)
const plain = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** 검사 결과 → 문구 목록. 문구 안의 {자리}는 fill 이 오류가 난 곳으로 채운다 */
function problemsOf(schema: z.ZodType, data: unknown, fill: Fill = () => ({})): string[] {
  const result = schema.safeParse(data);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const slots = fill(issue.path);
    return issue.message.replace(/\{(\w+)\}/g, (m, name: string) => (name in slots ? String(slots[name]) : m));
  });
}

const exported = { z, ALWAYS, present, keyed, plain, problemsOf };
export default exported;
export { exported as "module.exports" };
export type { Fill };

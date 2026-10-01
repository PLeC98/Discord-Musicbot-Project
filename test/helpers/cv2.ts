// Components V2 응답에서 글자 · 썸네일 · 메뉴를 꺼낸다. 컨테이너 안의 섹션 · 글자 칸 · 줄을 차례로 본다

type Node = { type?: number; content?: string; components?: Node[]; accessory?: { media?: { url?: string } }; custom_id?: string; options?: Array<{ value: string; label: string; emoji?: { name?: string } }> };
type Payload = { components?: Array<{ toJSON(): unknown }> };

const TEXT = 10;
const STRING_SELECT = 3;

function walk(node: Node, out: Node[]) {
  out.push(node);
  for (const child of node.components ?? []) walk(child, out);
}

const nodesOf = (payload: Payload) => {
  const out: Node[] = [];
  for (const c of payload.components ?? []) walk(c.toJSON() as Node, out);
  return out;
};

/** 글자 칸들 */
const textsOf = (payload: Payload) => nodesOf(payload).flatMap((n) => (n.type === TEXT && n.content !== undefined ? [n.content] : []));
/** 글자 칸들을 줄을 바꿔 이은 것. 보낸 것을 그대로 받는다 */
const textOf = (payload: unknown) => textsOf(payload as Payload).join("\n");
/** 첫 글자 칸의 첫 줄. 글자 칸이 없으면 undefined */
const headOf = (payload: Payload) => textsOf(payload)[0]?.split("\n")[0];
/** 섹션의 썸네일 주소 */
const thumbnailOf = (payload: Payload) => nodesOf(payload).find((n) => n.accessory?.media?.url)?.accessory?.media?.url ?? null;

/** 첫 글자 고르기 메뉴. 없으면 undefined */
const selectOf = (payload: Payload) => nodesOf(payload).find((n) => n.type === STRING_SELECT);

export { textsOf, textOf, headOf, thumbnailOf, selectOf };

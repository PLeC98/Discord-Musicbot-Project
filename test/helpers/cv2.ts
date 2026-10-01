// Components V2 응답에서 글자 · 썸네일을 꺼낸다. 컨테이너 안의 섹션 · 글자 칸을 차례로 본다

type Node = { type?: number; content?: string; components?: Node[]; accessory?: { media?: { url?: string } } };
type Payload = { components?: Array<{ toJSON(): unknown }> };

const TEXT = 10;

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
/** 첫 글자 칸의 첫 줄. 글자 칸이 없으면 undefined */
const headOf = (payload: Payload) => textsOf(payload)[0]?.split("\n")[0];
/** 섹션의 썸네일 주소 */
const thumbnailOf = (payload: Payload) => nodesOf(payload).find((n) => n.accessory?.media?.url)?.accessory?.media?.url ?? null;

export { textsOf, headOf, thumbnailOf };

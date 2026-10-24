// Components V2 응답에서 글자 · 썸네일 · 메뉴를 꺼낸다. 컨테이너 안의 섹션 · 텍스트 디스플레이 · 줄을 순서대로 본다

type Node = { type?: number; content?: string; components?: Node[]; accessory?: { media?: { url?: string } }; custom_id?: string; options?: Array<{ value: string; label: string; emoji?: { name?: string } }>; default_values?: Array<{ id: string }> };
type Payload = { components?: Array<{ toJSON(): unknown }> };

const TEXT = 10;
const SEPARATOR = 14;
const STRING_SELECT = 3;
const ACTION_ROW = 1;
const BUTTON = 2;
const ROLE_SELECT = 6;
const DONE = 0x57f287; // ui/colors 의 완료 색

function walk(node: Node, out: Node[]) {
  out.push(node);
  for (const child of node.components ?? []) walk(child, out);
}

const nodesOf = (payload: Payload) => {
  const out: Node[] = [];
  for (const c of payload.components ?? []) walk(c.toJSON() as Node, out);
  return out;
};

/** 텍스트 디스플레이들 */
const textsOf = (payload: Payload) => nodesOf(payload).flatMap((n) => (n.type === TEXT && n.content !== undefined ? [n.content] : []));
/** 텍스트 디스플레이들을 줄을 바꿔 이은 것. 보낸 것을 그대로 받는다 */
const textOf = (payload: unknown) => textsOf(payload as Payload).join("\n");
/** 첫 텍스트 디스플레이의 첫 줄. 텍스트 디스플레이가 없으면 undefined */
const headOf = (payload: Payload) => textsOf(payload)[0]?.split("\n")[0];
/** 섹션의 썸네일 주소 */
const thumbnailOf = (payload: Payload) => nodesOf(payload).find((n) => n.accessory?.media?.url)?.accessory?.media?.url ?? null;

/** 구분선 수 */
const separatorsOf = (payload: Payload) => nodesOf(payload).filter((n) => n.type === SEPARATOR).length;

/** 첫 문자열 선택 메뉴. 없으면 undefined */
const selectOf = (payload: Payload) => nodesOf(payload).find((n) => n.type === STRING_SELECT);

/**
 * 화면 하나: 헤더 줄(### 를 뗀 것) · 그 아래 본문 · 줄(메뉴 · 버튼 줄) 수 · 버튼 custom_id · 역할 메뉴의 기본값 · 완료 색인지.
 * 헤더 줄이 없으면 title 은 빈 글자이고 첫 텍스트 디스플레이 전체가 본문이다
 */
function screenOf(payload: unknown) {
  const nodes = nodesOf(payload as Payload);
  const [first = ""] = textsOf(payload as Payload);
  const [head, ...rest] = first.split("\n");
  const titled = head.startsWith("### ");
  return {
    title: titled ? head.slice(4) : "",
    body: titled ? rest.join("\n") : first,
    rows: nodes.filter((n) => n.type === ACTION_ROW).length,
    buttons: nodes.filter((n) => n.type === BUTTON).map((n) => n.custom_id),
    roles: nodes.find((n) => n.type === ROLE_SELECT)?.default_values?.map((v) => v.id),
    // 템플릿의 색. 저장한 결과(완료)인지 구분할 때
    done: (nodes[0] as { accent_color?: number } | undefined)?.accent_color === DONE,
  };
}

export { textsOf, textOf, headOf, thumbnailOf, separatorsOf, selectOf, screenOf };

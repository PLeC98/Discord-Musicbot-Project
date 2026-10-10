// 설정 문서(장르 · 상태 문구 · AI 설정 · 프롬프트). 사람이 고치는 파일이 아니라 settings.db 의 documents 에 둔다.
//
// 설정 계층은 DB(store)를 부를 수 없다. 그래서 여기는 메모리에 문서를 들고 있고, 기동 때 앱 조립이 저장소를 붙인다(attach).
// 붙이면 그때 한 번 읽어 올리고, 저장(put)하면 저장소에 쓰고 메모리를 바꾼다. 쓰는 곳은 읽을 때마다 DB 를 보지 않는다.
// 붙이지 않으면(시험 · 스크립트) 기본값(config/defaults)으로 돌고 저장은 메모리에만 남는다.
//
// 문서마다 저장 번호가 있다. 읽은 번호와 지금 번호가 다르면 저장을 거절한다(두 탭 · 두 사람이 서로 덮지 않게).

import { codedError } from "../rules/error-kind.ts";
import genresDefault from "./defaults/genres.ts";
import statusDefault from "./defaults/status.ts";
import aiDefault from "./defaults/ai.ts";

const DOC_NAMES = ["genres", "status", "ai", "ai-prompt"] as const;
type DocName = (typeof DOC_NAMES)[number];

/** 문서 하나. revision 0 은 아직 저장한 적 없음(기본값) */
type Doc = { data: unknown; revision: number };
/** 붙일 저장소(store/settings-docs). 없는 문서는 data 가 null. writeAll 은 한 트랜잭션(하나라도 실패하면 아무것도 쓰지 않는다) */
type DocStore = { read(name: string): Doc; writeAll(writes: { name: string; data: unknown; revision: number }[]): number[] };
/** 저장할 문서 하나. revision 은 읽었을 때의 번호, 없으면 보지 않는다 */
type DocPut = { name: DocName; data: unknown; revision?: number };

// 프롬프트가 비어 있으면 보조가 코드에 든 기본 구성을 쓴다(autoplay/assist 의 DEFAULT_SECTIONS)
const DEFAULTS: Record<DocName, () => unknown> = {
  genres: () => structuredClone(genresDefault),
  status: () => structuredClone(statusDefault),
  ai: () => structuredClone(aiDefault),
  "ai-prompt": () => [],
};

const held = new Map<DocName, Doc>();
let store: DocStore | null = null;

const isDocName = (name: string): name is DocName => (DOC_NAMES as readonly string[]).includes(name);

/** 저장소를 붙이고 문서를 모두 읽어 올린다. 기동 때 한 번(settings.db 를 연 뒤) */
function attach(next: DocStore) {
  store = next;
  held.clear();
  for (const name of DOC_NAMES) {
    const got = next.read(name);
    held.set(name, got.data == null ? { data: DEFAULTS[name](), revision: got.revision } : got);
  }
}

/** 붙인 저장소에서 다시 읽는다(가져오기가 DB 를 직접 바꾼 뒤). 붙이지 않았으면 아무것도 안 한다 */
function reload() {
  if (store) attach(store);
}

function docOf(name: DocName): Doc {
  let doc = held.get(name);
  if (!doc) {
    doc = { data: DEFAULTS[name](), revision: 0 };
    held.set(name, doc);
  }
  return doc;
}

/** 지금 문서. 받은 쪽은 고치지 않는다(고치려면 put) */
const get = (name: DocName): unknown => docOf(name).data;
const revisionOf = (name: DocName) => docOf(name).revision;

/** 저장. revision 은 읽었을 때의 번호. 다르면 REVISION_CONFLICT. 새 번호를 돌려준다 */
const put = (name: DocName, data: unknown, revision: number): number => putAll([{ name, data, revision }])[0];

/** 여러 문서를 함께 저장한다. 하나라도 번호가 다르거나 쓰기가 실패하면 아무것도 바꾸지 않는다. 새 번호들을 같은 차례로 */
function putAll(puts: DocPut[]): number[] {
  const nows = puts.map(({ name }) => revisionOf(name));
  puts.forEach(({ name, revision }, i) => {
    if (revision !== undefined && revision !== nows[i]) throw codedError("REVISION_CONFLICT", `${name} 문서가 그사이 바뀌었습니다(읽은 번호 ${revision}, 지금 ${nows[i]})`);
  });
  const next = store ? store.writeAll(puts.map(({ name, data }, i) => ({ name, data, revision: nows[i] }))) : nows.map((now) => now + 1);
  puts.forEach(({ name, data }, i) => held.set(name, { data: structuredClone(data), revision: next[i] }));
  return next;
}

/** 기본값(새로 설치했을 때의 문서) */
const defaultOf = (name: DocName) => DEFAULTS[name]();

// 시험 시임. 문서를 바로 넣는다(번호 · 저장소를 거치지 않는다). 인자 없이 부르면 모두 기본값으로
function _use(name?: DocName, data?: unknown) {
  if (!name) {
    store = null;
    held.clear();
    return;
  }
  held.set(name, { data: structuredClone(data), revision: revisionOf(name) + 1 });
}

export { DOC_NAMES, isDocName, attach, reload, get, revisionOf, put, putAll, defaultOf, _use };
export type { DocName, Doc, DocStore, DocPut };

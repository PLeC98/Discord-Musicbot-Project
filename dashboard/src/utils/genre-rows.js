// 장르 설정 ↔ 편집 행. 편집 중에는 배열로 다룬다. 맵으로 두면 이름을 고치는 순간 키가 바뀌어 입력이 튄다.
// 이름이 곧 키다. 따로 id를 두지 않는다.
// 행은 원래 장르를 통째로 들고 있다가(kept) 화면이 고친 칸만 덮어 돌려보낸다. 화면에 칸이 없는 것(장르별 길이 · 차단할 말)을
// 빠뜨리면 저장이 지운다. 저장은 보낸 칸의 차례대로 파일을 고쳐 쓰므로 원래 차례도 지킨다.

let serial = 0;
const nextKey = () => ++serial;

const toRows = (genres) => Object.entries(genres || {}).map(([name, g]) => ({ key: nextKey(), name, emoji: g.emoji || "", sources: (g.sources || []).map((one) => ({ ...one })), kept: g }));

// 새 행. 들고 있을 원래 장르가 없다
const newRow = () => ({ key: nextKey(), name: "", emoji: "", sources: [], kept: {} });

// _key 는 편집 중 행을 붙잡아 두려고 붙인 것이라 저장할 때는 뺀다
const clean = (one) => Object.fromEntries(Object.entries(one).filter(([k]) => k !== "_key"));
const toMap = (list) => Object.fromEntries(list.map((r) => [r.name.trim(), { ...r.kept, emoji: r.emoji, sources: r.sources.map(clean) }]));

export { toRows, toMap, newRow };

// 곡 검색(/search · /play · 전용 채널 입력)의 글자

/** /search 결과 화면. count 는 보여 준 결과 수 */
const results = (query: string, count: number) => ({ title: `🔍 "${query}" 검색 결과`, description: "번호 버튼을 눌러 곡을 선택해 주세요.", footer: `결과 ${count}개`, cancel: "취소" });
/** 결과 한 칸. 제목 · 채널이 없으면 모른다고 적는다. length 는 곡 길이를 적은 것 */
const result = (rank: number, { title, uploader, length }: { title?: string | null; uploader?: string | null; length: string }) => ({ name: `${rank}. ${title || "알 수 없는 제목"}`, value: `👤 ${uploader || "알 수 없는 채널"} • ⏱️ ${length}` });
/** 길이를 모르는 결과 */
const unknownLength = () => "알 수 없음";
/** 고른 곡을 넣는 동안 */
const adding = () => ({ title: "🔄 넣는 중...", description: "선택한 곡을 추가하고 있어요..." });

/** /play · 전용 채널 입력이 찾는 동안의 자리표시자. input 은 넣은 것(전용 채널은 앞부분만 자른 것) */
const searching = (input: string) => `🔍 **${input}** 검색 중...`;

export { results, result, unknownLength, adding, searching };

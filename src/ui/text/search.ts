// 곡 검색(/search · /play · 전용 채널 입력)의 글자

/** /search 결과 화면. count 는 보여 준 결과 수 */
const results = (query: string, count: number) => ({ title: `🔍 "${query}" 검색 결과`, description: "번호 버튼을 눌러 노래를 선택하세요.", footer: `${count}개의 결과`, cancel: "취소" });
/** 결과 한 칸. 제목 · 채널이 없으면 모른다고 적는다. length 는 곡 길이를 적은 것 */
const result = (rank: number, { title, uploader, length }: { title?: string | null; uploader?: string | null; length: string }) => ({ name: `${rank}. ${title || "알 수 없는 제목"}`, value: `👤 ${uploader || "알 수 없는 채널"} • ⏱️ ${length}` });
/** 길이를 모르는 결과 */
const unknownLength = () => "알 수 없음";
/** 고르기를 취소했다 */
const cancelled = () => ({ title: "❌ 검색 취소됨", description: "검색이 취소되었습니다." });
/** 고른 곡을 넣는 동안 */
const adding = () => ({ title: "🔄 처리 중...", description: "고른 곡을 추가하는 중..." });

/** /play 가 찾는 동안의 자리표시자 */
const searching = (query: string) => `**${query}** 검색 중...`;
/** 전용 채널 입력을 찾는 동안의 자리표시자. preview 는 앞부분만 자른 입력 */
const searchingChannel = (preview: string) => `🔍 **${preview}** 검색 중...`;

export { results, result, unknownLength, cancelled, adding, searching, searchingChannel };

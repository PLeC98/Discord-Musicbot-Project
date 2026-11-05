// 유튜브가 검색어에 연령 인증을 걸었을 때 스포티파이 1위 곡을 그 검색어의 곡으로 볼지.
// 스포티파이는 아무 글자에도 곡을 주므로, 그 곡의 제목(과 가수)이 검색어 안에 들어 있고 검색어의 절반 이상을 차지할 때만 본다.
// 긴 쓰레기 글자 안에 짧은 제목이나 가수가 우연히 든 경우를 필터링한다. 대소문자, 띄어쓰기, 문장 부호, 기호는 보지 않는다

const normalized = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]/gu, "");
const lengthOf = (text: string) => [...text].length;

/** 검색어가 그 곡을 찾는 것으로 보이나. artist 는 스포티파이가 붙인 "가수1, 가수2" 그대로 */
function queryNamesTrack(query: string, { title, artist }: { title: string | null; artist?: string | null }): boolean {
  const q = normalized(query);
  const t = normalized(title ?? "");
  if (!t || !q.includes(t)) return false;
  const artists = [...new Set((artist ?? "").split(", ").map(normalized))].filter((a) => a && q.includes(a));
  const covered = lengthOf(t) + artists.reduce((sum, a) => sum + lengthOf(a), 0);
  return covered * 2 >= lengthOf(q);
}

export { queryNamesTrack };

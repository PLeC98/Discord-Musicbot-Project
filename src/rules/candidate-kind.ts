// 판정: 자동재생 후보를 어느 경로로. 어느 필드가 찼는지가 정한다. 답: youtube · search · audio, 경로가 없으면 null.
//   youtube  유튜브 주소를 직접 받았다
//   search   가수와 제목으로 유튜브에서 찾는다
//   audio    음원을 직접 받았다
// 이것은 첫 경로다. 찾기에 실패했을 때 음원으로 넘어가는 것은 부르는 쪽의 흐름이다.

function candidateKind(cand: { youtubeUrl?: string | null; artist?: string | null; title?: string | null; audioUrl?: string | null }): "youtube" | "search" | "audio" | null {
  if (cand.youtubeUrl) return "youtube";
  if (cand.artist && cand.title) return "search";
  if (cand.audioUrl) return "audio";
  return null;
}

export { candidateKind };

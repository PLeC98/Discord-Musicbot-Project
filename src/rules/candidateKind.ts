// @ts-nocheck 타입은 다음 커밋에서 단다(10단계: 이름 바꾸기와 타입 달기를 나눈다)
// 판정: 자동재생 후보를 어느 길로. 어느 칸이 찼는지가 정한다. 답: youtube · search · audio, 길이 없으면 null.
//   youtube  유튜브 주소를 직접 받았다
//   search   가수와 제목으로 유튜브에서 찾는다
//   audio    음원을 직접 받았다
// 이것은 첫 길이다. 찾기에 실패했을 때 음원으로 넘어가는 것은 부르는 쪽의 흐름이다.

function candidateKind(cand) {
  if (cand.youtubeUrl) return "youtube";
  if (cand.artist && cand.title) return "search";
  if (cand.audioUrl) return "audio";
  return null;
}

const exported = { candidateKind };
export default exported;
export { exported as "module.exports" };

// 검색 결과 섞기(자동완성 후보, 결과 화면). 유튜브 다음 스포티파이 차례로 두고, 스포티파이 몫을 둔 뒤 한쪽이 모자라면 다른 쪽으로 채운다

/** total 자리 중 유튜브와 스포티파이에 줄 수. spotifyShare 는 둘 다 넉넉할 때 스포티파이 몫 */
function mixCounts(youtube: number, spotify: number, { total, spotifyShare }: { total: number; spotifyShare: number }): { youtube: number; spotify: number } {
  const youtubeTake = Math.min(youtube, total - Math.min(spotify, spotifyShare));
  return { youtube: youtubeTake, spotify: Math.min(spotify, total - youtubeTake) };
}

/** key 가 같은 것은 처음 하나만(같은 녹음이 여러 앨범에 실린 것, 다시 올린 영상) */
function uniqueBy<T>(list: readonly T[], key: (one: T) => string): T[] {
  const seen = new Set<string>();
  return list.filter((one) => {
    const k = key(one);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export { mixCounts, uniqueBy };

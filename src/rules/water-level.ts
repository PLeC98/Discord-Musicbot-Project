// 수위 맞추기: 여러 길이를 같은 수위까지 줄여 정한 양을 덜어 낸다. 수위보다 긴 것만 수위까지 줄이고 짧은 것은 그대로라,
// 가장 긴 하나만 줄지도, 모두가 같은 비율로 줄지도 않는다. 메시지 크기 상한에 맞춰 메뉴 설명을 줄일 때 쓴다(ui/menu-fit). Node를 부르지 않는다

/** 수위 level까지 줄였을 때 덜어 내는 양 */
const cutAt = (lengths: readonly number[], level: number) => lengths.reduce((sum, length) => sum + Math.max(0, length - level), 0);

/** need만큼 줄이는 가장 높은 수위(0 이상의 정수). 다 줄여도 need에 못 미치면 0 */
function waterLevel(lengths: readonly number[], need: number): number {
  if (need <= 0) return Math.max(0, ...lengths);
  let low = 0;
  let high = Math.max(0, ...lengths);
  // cutAt은 수위가 높을수록 줄어든다. need를 채우는 가장 높은 수위를 찾는다
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (cutAt(lengths, mid) >= need) low = mid;
    else high = mid - 1;
  }
  return low;
}

export { waterLevel };

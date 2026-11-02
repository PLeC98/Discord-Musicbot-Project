// 디스코드 자동완성은 상호작용이 만들어진 뒤 3초 안에 답해야 한다(미뤄 둘 수 없다). 그 안에서 검색을 기다릴 수 있는 시간.

const DEADLINE_MS = 3000;
/** 답을 보내는 데 남겨 둘 시간 */
const MARGIN_MS = 600;
// 만들어진 시각은 디스코드 시계, 지금은 봇 시계라 둘이 어긋난 PC 에서는 늘 0 이거나 늘 넉넉하게 나온다. 이 범위에 가둔다
const MIN_MS = 300;
const MAX_MS = 2400;

/** 검색을 기다릴 시간(ms). createdAt 은 상호작용이 만들어진 시각, now 는 받은 시각 */
function autocompleteBudget(createdAt: number, now: number): number {
  return Math.min(MAX_MS, Math.max(MIN_MS, DEADLINE_MS - (now - createdAt) - MARGIN_MS));
}

export { autocompleteBudget };

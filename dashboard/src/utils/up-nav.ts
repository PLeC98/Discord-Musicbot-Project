// 화면 안 ← 는 늘 상위로 간다(상위 폴더처럼). 기기 · 브라우저 뒤로와 어긋나지 않게:
// 아래로 들어갈 때(탭 · 상세 열기) 기록을 한 칸 쌓으며 그 기록에 상위 주소를 적어 두고(UP_KEY),
// ← 를 누를 때 지금 기록에 적힌 상위가 가려는 상위와 같으면 기록을 무른다(기기 뒤로와 같은 결과, 같은 화면이 두 번 남지 않는다).
// 다르면(주소로 바로 들어옴 · 화면 크기가 바뀌어 한 단 ↔ 두 단이 뒤집힘 등) 상위로 바꿔치기한다

import type { RouteLocationNormalizedLoaded, RouteLocationRaw, Router } from "vue-router";

const UP_KEY = "upTo";

/** 아래로 들어간다: 기록을 한 칸 쌓고 지금 주소를 상위로 적어 둔다 */
export function pushDown(router: Router, route: RouteLocationNormalizedLoaded, to: { query: Record<string, unknown> }) {
  return router.push({ ...to, state: { [UP_KEY]: route.fullPath } } as RouteLocationRaw);
}

/** 상위로 간다: 지금 기록의 상위가 그곳이면 기록을 무르고, 아니면 바꿔치기 */
export function goUp(router: Router, to: RouteLocationRaw) {
  const target = router.resolve(to).fullPath;
  if (window.history.state?.[UP_KEY] === target) return router.back();
  return router.replace(to);
}

/** 바꿔치기하되 지금 기록의 상위 표시는 그대로 둔다(상세 이름이 바뀌어 주소만 고칠 때) */
export function replaceKeepingUp(router: Router, to: { query: Record<string, unknown> }) {
  return router.replace({ ...to, state: { [UP_KEY]: window.history.state?.[UP_KEY] } } as RouteLocationRaw);
}

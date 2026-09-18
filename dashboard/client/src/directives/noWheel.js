// v-no-wheel — 숫자 칸 위에서 휠을 굴려 값이 바뀌는 것을 막는다.
//
// 포커스가 없을 때는 그냥 둔다. 그때는 어차피 값이 안 바뀌고, 막으면 칸 위에서 페이지가
// 안 굴러가 답답해진다.
function onWheel(event) {
  if (document.activeElement === event.currentTarget) event.preventDefault();
}

export default {
  // passive: false 로 붙여야 preventDefault 가 먹는다
  mounted: (el) => el.addEventListener("wheel", onWheel, { passive: false }),
  unmounted: (el) => el.removeEventListener("wheel", onWheel),
};

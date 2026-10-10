// 이어 붙은 버튼 묶음의 한 칸(높이 40, 하나 고르기). 바깥 모서리는 높이의 절반, 안쪽 8 · 누르는 동안 4, 고른 칸은 완전히 둥글게.
// 모서리는 높이의 절반을 직접 적는다(rounded-full 을 섞으면 반대쪽 작은 모서리가 0 이 된다)
export function segment(active: boolean, index: number, count: number): string {
  const base = "tap state-layer flex-auto h-10 px-4 flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium cursor-pointer transition-[border-radius,background-color,color] spring-fast disabled:opacity-40 disabled:cursor-not-allowed";
  if (active) return `${base} bg-secondary-container text-on-secondary-container rounded-[1.25rem]`;
  const corners = index === 0 ? "rounded-l-[1.25rem] rounded-r-sm active:rounded-r-xs" : index === count - 1 ? "rounded-r-[1.25rem] rounded-l-sm active:rounded-l-xs" : "rounded-sm active:rounded-xs";
  return `${base} bg-surface-container-highest text-on-surface-variant ${corners}`;
}

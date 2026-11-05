// 이어 붙은 버튼 그룹(M3E connected button group). 바깥 모서리는 높이의 절반, 안쪽 8px, 누르는 동안 4px, 선택한 버튼은 완전히 둥글게.
// 모서리는 높이의 절반을 직접 적는다(rounded-full 을 섞으면 반대쪽 작은 모서리가 0 이 되고, 절반보다 큰 단계는 바뀌는 앞부분이 보이지 않는다)

const SHAPES = {
  40: { on: "rounded-xl", first: "rounded-l-xl rounded-r-sm active:rounded-r-xs", last: "rounded-r-xl rounded-l-sm active:rounded-l-xs" },
  32: { on: "rounded-[1rem]", first: "rounded-l-[1rem] rounded-r-sm active:rounded-r-xs", last: "rounded-r-[1rem] rounded-l-sm active:rounded-l-xs" },
};
const MIDDLE = "rounded-sm active:rounded-xs";

/** 그룹 안 버튼 하나의 모서리와 넘김(motion-toggle). 색, 크기, 글자는 쓰는 곳이 정한다. height: 버튼 높이(px) */
export function segmentShape(active: boolean, index: number, count: number, height: 32 | 40 = 40): string {
  const shape = SHAPES[height];
  const corners = active ? shape.on : index === 0 ? shape.first : index === count - 1 ? shape.last : MIDDLE;
  return `motion-toggle ${corners}`;
}

/** 기본 그룹의 버튼 하나(높이 40px, 하나 선택, 색조 바탕) */
export function segment(active: boolean, index: number, count: number): string {
  const base = "tap state-layer flex-auto h-10 px-4 flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium cursor-pointer disabled:opacity-38 disabled:cursor-not-allowed";
  const color = active ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-highest text-on-surface-variant";
  return `${base} ${color} ${segmentShape(active, index, count)}`;
}

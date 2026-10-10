// 위 막대의 단추(메뉴 · 뒤로 · 알림 · 화면이 넣는 도구). 막대 높이에 맞춰 휴대폰(막대 48)은 40 · 아이콘 24, 태블릿 · PC(막대 36)는 28 · 아이콘 20.
// 아이콘 크기는 BaseIcon 이 글자 크기를 직접 적으므로 여기서 덮는다(!)

const ICON = "[&_.symbol]:text-[1.5rem]! md:[&_.symbol]:text-[1.25rem]!";

/** 아이콘 단추 */
export const TOPBAR_BTN = `tap state-layer size-10 md:size-7 shrink-0 rounded-full flex items-center justify-center cursor-pointer text-on-surface no-underline ${ICON}`;

/** 글이 붙은 단추(서버 설정의 ← 돌아가기 등). 휴대폰은 아이콘만(글은 hidden md:inline 으로) */
export const TOPBAR_TEXT_BTN = `tap state-layer h-10 w-10 md:h-7 md:w-auto md:pl-1.5 md:pr-3 shrink-0 rounded-full flex items-center justify-center gap-1 cursor-pointer text-on-surface no-underline ${ICON}`;

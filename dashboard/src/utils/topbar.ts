// 위 막대의 버튼(메뉴, 뒤로, 알림, 화면이 넣는 도구). 막대 높이에 맞춰 휴대폰(막대 48px)은 40px, 아이콘 24px, 태블릿, PC(막대 36px)는 28px, 아이콘 20px.
// 아이콘 크기는 BaseIcon 이 글자 크기를 직접 적으므로 여기서 덮는다(!). 줄 높이는 기호 글꼴대로 1(/none)

const ICON = "[&_.symbol]:text-2xl/none! md:[&_.symbol]:text-xl/none!";

/** 아이콘 버튼 */
export const TOPBAR_BTN = `tap state-layer size-10 md:size-7 shrink-0 rounded-full flex items-center justify-center cursor-pointer text-on-surface no-underline ${ICON}`;

/** 글이 붙은 버튼(서버 설정의 ← 돌아가기 등). 휴대폰은 아이콘만(글은 hidden md:inline 으로) */
export const TOPBAR_TEXT_BTN = `tap state-layer h-10 w-10 md:h-7 md:w-auto md:pl-1.5 md:pr-3 shrink-0 rounded-full flex items-center justify-center gap-1 cursor-pointer text-on-surface no-underline ${ICON}`;

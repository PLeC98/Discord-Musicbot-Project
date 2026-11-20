// 응답 머리의 기동 표시. 서버(dashboard/middleware/boot-mark)가 싣고 화면(composables/bot-boot)이 읽는다. Node를 부르지 않는다

/** 봇이 기동할 때마다 새로 정하는 무작위 값을 싣는 머리 이름(소문자: axios가 머리 이름을 소문자로 준다) */
const BOOT_HEADER = "x-bot-boot";

export { BOOT_HEADER };

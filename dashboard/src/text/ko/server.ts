// 서버 화면(재생 · 대기열 · 곡 넣기)

/** 봇은 음성에 있는데 서버에 플레이어가 없다(디스코드 음성 상태와 봇 내부 상태가 어긋남). 곡 넣기 칸 자리에 */
const noPlayerState = "봇이 음성 채널에 있지만 재생 상태를 읽을 수 없어요. 잠시 후 다시 시도해 주세요.";
/** 정지 버튼의 확인 */
const stopConfirm = { title: "재생을 중지할까요?", body: "재생을 멈추고 대기열을 비워요." };

export { noPlayerState, stopConfirm };

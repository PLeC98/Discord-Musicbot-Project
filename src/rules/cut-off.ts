// 끊겨서 음성 채널에서 나온 원인 가운데 채널에 따로 알리는 것(Player.dispose의 end). 그리는 쪽(ui/now-playing-panel)과 언어별 문구표가 같은 목록을 본다.
// 사람이 멈추거나 내보낸 것(stop, leave)은 명령 응답으로 이미 알렸으므로 넣지 않는다

const CUT_OFF_CAUSES = ["alone-timeout", "kicked", "stage-ended", "stage-disconnect", "operator-leave", "dashboard-leave", "voice-lost", "channel-gone", "fault"] as const;
type CutOffCause = (typeof CUT_OFF_CAUSES)[number];

const isCutOffCause = (cause: string): cause is CutOffCause => (CUT_OFF_CAUSES as readonly string[]).includes(cause);

export { CUT_OFF_CAUSES, isCutOffCause };
export type { CutOffCause };

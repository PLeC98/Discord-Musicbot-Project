// 로그 문구: 재생 조작(control 분류). 일시정지, 볼륨, 건너뛰기 같은 조작의 결과

const control = {
  seekRejectedLive: ({ track, reason }: { track: string; reason: string }) => `위치 이동 거부: ${track} | 라이브 | 원인=${reason}`,
  seeked: ({ track, fromSeconds, toSeconds, reason }: { track: string; fromSeconds: number; toSeconds: number; reason: string }) => `위치 이동: ${track} | ${fromSeconds}초 → ${toSeconds}초 | 원인=${reason}`,
  trackSkipped: ({ track, reason, queued }: { track: string; reason: string; queued: number }) => `스킵: ${track} | 원인=${reason} | 대기열 ${queued}곡`,
  previousTrackPlayed: ({ track, history, loop }: { track: string; history: number; loop: string }) => `이전곡: ${track} | 이전 기록 ${history}곡 | 반복=${loop}`,
  queueShuffled: ({ count }: { count: number }) => `대기열 섞음: ${count}곡`,
  loopReleasedForLive: ({ mode }: { mode: string }) => `반복 해제: 라이브가 들어와 반복(${mode}) 해제`,
  loopRejectedLive: ({ mode }: { mode: string }) => `반복 거부: 라이브가 있어 반복(${mode})을 켜지 않음`,
  loopChanged: ({ from, to }: { from: string; to: string }) => `반복: ${from} → ${to}`,
  autoplayChanged: ({ from, to }: { from: string; to: string }) => `자동재생: ${from} → ${to}`,
  autoplayPrefetchDropped: ({ count }: { count: number }) => `미리 선택해 둔 자동재생 곡 ${count}곡을 대기열에서 뺌`,
  queueCleared: ({ count }: { count: number }) => `대기열 비움: ${count}곡`,
  queueTrackRemoved: ({ position, title, remaining }: { position: number; title: string; remaining: number }) => `대기열 제거: ${position}번 "${title}" | 남은 ${remaining}곡`,
  queueTracksRemoved: ({ count, position, remaining }: { count: number; position: number; remaining: number }) => `대기열 제거: ${count}곡(${position}번부터) | 남은 ${remaining}곡`,
  queueMoved: ({ title, from, to }: { title: string; from: number; to: number }) => `대기열 이동: "${title}" ${from}번 → ${to}번`,
  autoplayPicked: ({ title, artist, genre, source, how }: { title: string; artist: string; genre: string; source: string; how: string }) => `자동재생 선택: "${title}" / ${artist} (장르 ${genre}, 소스 ${source} → ${how})`,
};

export { control };

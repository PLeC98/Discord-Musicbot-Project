// 재생 바와 서버 화면이 같이 쓰는 재생 규칙(순수 함수). 상태는 두 곳이 따로 든다(재생 바는 듣고 있는 서버, 서버 화면은 주소의 서버)

/** 대기열 곡 수(받은 창 밖까지) */
export const queueSize = (s) => s?.queueTotal ?? s?.queue?.length ?? 0;

/**
 * 받은 재생 상태로 바꿀지. 서버는 상태를 만들 때마다 차례(seq)를 올리고 봇을 켤 때마다 기동 표(boot, 켠 시각)가 커진다.
 * 기동 표가 크면 받고 작으면(옛 실행의 늦은 응답) 버린다. 같으면 차례가 지금 이상일 때만. 표가 없는 쪽이 있으면 받는다
 */
export function accepts(current, next) {
  if (typeof current?.boot !== "number" || typeof next?.boot !== "number") return true;
  if (next.boot !== current.boot) return next.boot > current.boot;
  return next.seq >= current.seq;
}

/** 진행 시계의 기준: 받은 위치 · 받은 때 · 흐르는 중인지 · 길이 */
export function clockOf(s, now) {
  const track = s?.currentTrack;
  return { at: track?.currentTime ?? 0, since: now, running: Boolean(track && s.playing && !s.paused), duration: track?.duration ?? 0 };
}

/** 지금 진행 위치(초) = 받은 위치 + 받은 뒤 지난 시간(흐르는 중일 때만). 길이를 알면 넘지 않는다(라이브는 길이 0) */
export function positionAt(clock, now) {
  const t = clock.at + (clock.running ? Math.max(0, now - clock.since) / 1000 : 0);
  return clock.duration > 0 ? Math.min(t, clock.duration) : t;
}

/** 시계를 지금 자리에서 다시 잰다. 옮긴 자리(at) · 흐르는지(running)를 바꿀 수 있다(응답을 기다리는 동안 얹어 보인다) */
export function retime(clock, now, { at = positionAt(clock, now), running = clock.running } = {}) {
  return { ...clock, at, since: now, running };
}

/** 건너뛰기 권한: 조작 권한이 있거나 지금 곡을 넣은 사람(서버 checkSkip 과 같은 규칙) */
export const canSkip = (s) => Boolean(s?.canControl) || (Boolean(s?.currentTrack?.requestedBy?.id) && s.currentTrack.requestedBy.id === s.userId);

/** 다음 곡 버튼: 대기열이 비어도 한곡 반복이면 지금 곡을 다시, 자동재생이 켜져 있으면 뽑아 온다 */
export const skipEnabled = (s) => Boolean(s?.currentTrack) && canSkip(s) && (queueSize(s) > 0 || s.loop === "track" || Boolean(s.autoplay));

/** 이전 곡 버튼: 한곡 반복 중에는 기록이 없어도 지금 곡을 다시 튼다 */
export const previousEnabled = (s) => Boolean(s?.currentTrack) && Boolean(s.canControl) && (Boolean(s.hasPrevious) || s.loop === "track");

/** 대기열 빼기 권한: 조작 권한이 있거나 그 곡을 넣은 사람(서버 checkRemoveTrack 과 같은 규칙) */
export const canRemove = (s, track) => Boolean(s?.canControl) || (Boolean(track?.requestedBy?.id) && track.requestedBy.id === s.userId);

/** 탐색 · 넘기기 · 이전 · 하이라이트를 "지금 곡이 이것일 때만" 하라는 표. 줄 번호가 있을 때만 싣는다 */
export const onTrackOf = (s) => (Number.isInteger(s?.currentTrack?.entry) ? { onTrack: s.currentTrack.entry } : {});

/** 진행 막대 위의 가로 위치 → 초 */
export function seekPosition(clientX, rect, duration) {
  if (!rect?.width || !(duration > 0)) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return Math.round(ratio * duration);
}

/**
 * 끌어 놓은 자리 → 옮기기 요청. insertAt 은 받은 목록의 틈(0 ~ 길이, from 앞뒤는 제자리).
 * { entry, before }: before 줄 앞으로, null 이면 대기열 맨 끝. "same": 제자리. "partial": 받은 창의 끝인데 그 뒤에 곡이 더 있다(맨 끝이 아니다).
 * "unknown": 줄 번호가 없다(봇이 다시 켜지기 전의 목록 등)
 */
export function moveTarget(queue, from, insertAt, total) {
  if (insertAt === from || insertAt === from + 1) return "same";
  const entry = queue[from]?.entry;
  if (!Number.isInteger(entry)) return "unknown";
  if (insertAt >= queue.length) return queue.length < total ? "partial" : { entry, before: null };
  const before = queue[insertAt]?.entry;
  return Number.isInteger(before) ? { entry, before } : "unknown";
}

/** 끌어 놓은 차례대로 바꾼 목록(응답을 기다리는 동안 얹어 보인다) */
export function reordered(queue, from, insertAt) {
  const next = [...queue];
  const [one] = next.splice(from, 1);
  next.splice(insertAt > from ? insertAt - 1 : insertAt, 0, one);
  return next;
}

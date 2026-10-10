import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import axios from "axios";
import { useGuildsStore, onGuildNudge } from "./guilds.ts";
import { notifyProblem } from "../composables/toasts.ts";
import { useBusy } from "../composables/busy.ts";
import { accepts, canSkip as skipAllowed, clockOf, onTrackOf, positionAt, retime, withReadFields, type PlayerSeen } from "../utils/playback.ts";
import { modeOf, type PlayerRead, type PlayerState } from "../../../src/dashboard/contract/player.ts";
import { nextLoopMode } from "../../../src/rules/loop-cycle.ts";
import { text } from "../text/index.ts";

// 전역 재생 바. "내가 들어가 있는 음성 채널에 봇이 있고, 뭔가 재생 중일 때"만 의미를 갖는다.
//
// 서버 화면과 상태를 공유하지 않는다. 재생 중인 서버의 화면에서는 바가 숨으므로
// 같은 서버를 둘이 동시에 읽는 상황이 생기지 않는다. 규칙은 utils/playback 을 같이 쓴다.
//
// 실시간 연결은 새로 열지 않는다. 탭의 목록 연결 하나의 신호를 나눠 쓴다(stores/guilds 의 onGuildNudge).
// 대기열은 보지 않으므로 모든 요청에 ?queue=0 을 싣는다
export const useNowPlayingStore = defineStore("nowPlaying", () => {
  const guilds = useGuildsStore();

  const data = ref<PlayerSeen | null>(null); // GET /player 응답(조작 응답이 덮는다)
  const clock = ref(clockOf(null, 0)); // 진행 시계의 기준
  const now = ref(Date.now());
  // 지금 보고 있는 서버 화면의 서버. 그 화면에서는 바가 숨는다. 라우터는 바 컴포넌트가 읽어 넣는다
  const page = ref<string | null>(null);

  // 대상 서버. 동시 음성 참여가 불가능하므로 항상 하나 이하다
  const guildId = computed(() => guilds.guilds.find((g) => g.listening)?.id ?? null);
  const guild = computed(() => guilds.guilds.find((g) => g.id === guildId.value) ?? null);

  const track = computed(() => data.value?.currentTrack ?? null);
  const onTargetPage = computed(() => !!guildId.value && page.value === guildId.value);
  // 곡이 없어도 봇과 같은 채널이면 빈 셸로 남긴다. 볼륨은 조작할 수 있고, 재생이 시작될 때
  // 레이아웃이 튀지 않는다. 채널이 다르거나 봇이 없으면(guildId null) 통째로 사라진다.
  const visible = computed(() => !!guildId.value && !onTargetPage.value && !!data.value?.hasPlayer);

  const canControl = computed(() => data.value?.canControl ?? false);
  // 곡이 있고 멈추지 않았다(재생 · 일시정지 버튼이 어느 쪽인지)
  const running = computed(() => Boolean(track.value && !data.value?.paused));
  const canSkip = computed(() => skipAllowed(data.value));
  const duration = computed(() => track.value?.duration ?? 0);
  const position = computed(() => positionAt(clock.value, now.value));

  const url = (path = "") => `/api/guilds/${guildId.value}/player${path}?queue=0`;

  // 받은 상태를 넣는다. 늦게 온 옛 상태는 버린다. 조작 응답에는 GET 의 권한 · 음성 칸이 없어 그것만 남긴다
  function apply(next: PlayerState) {
    if (!accepts(data.value, next)) return;
    data.value = withReadFields(data.value, next);
    clock.value = clockOf(next, Date.now());
  }

  async function refresh() {
    const id = guildId.value;
    if (!id) {
      data.value = null;
      return;
    }
    try {
      const res = await axios.get<PlayerRead>(url());
      // 응답이 오는 사이에 대상이 바뀌었으면 버린다
      if (guildId.value !== id) return;
      if (accepts(data.value, res.data)) {
        data.value = res.data;
        clock.value = clockOf(res.data, Date.now());
      }
    } catch (e) {
      // 권한을 잃었거나 봇이 나갔다(답이 왔다). 바를 접는다. 응답이 없거나 늦으면 지금 바를 둔다
      if (axios.isAxiosError(e) && e.response) data.value = null;
    }
  }

  // 응답을 기다리는 조작. 같은 조작을 겹쳐 보내지 않는다
  const { isBusy, whileBusy } = useBusy();
  async function send(type: string, body: object | undefined, fallback: string) {
    if (!guildId.value) return;
    await whileBusy(type, async () => {
      try {
        apply((await axios.post<PlayerState>(url(`/${type}`), body)).data);
      } catch (e) {
        notifyProblem(e, fallback);
        void refresh(); // 거절되면 서버 상태로 되돌린다
      }
    });
  }

  // 일시정지는 먼저 바꿔 보이고, 거절되면 다시 읽어 되돌린다
  function togglePause() {
    if (!data.value || isBusy("pause")) return;
    const paused = !data.value.paused;
    clock.value = retime(clock.value, Date.now(), { running: Boolean(track.value && data.value.playing && !paused) });
    data.value = { ...data.value, paused };
    return send("pause", undefined, text.player.failed.pause);
  }
  // 넘기기 · 이전은 응답을 기다린다. 누른 때의 곡일 때만 하게 줄 번호를 싣는다
  const skip = () => send("skip", onTrackOf(data.value), text.player.failed.skip);
  const previous = () => send("previous", onTrackOf(data.value), text.player.failed.previous);
  const shuffle = () => send("shuffle", undefined, text.player.failed.shuffle);
  // 반복도 먼저 바꿔 보인다(디스코드 반복 버튼과 같은 순환)
  function cycleLoop() {
    if (!data.value || isBusy("loop")) return;
    const mode = nextLoopMode(data.value.loop ?? false);
    data.value = { ...data.value, loop: mode };
    return send("loop", { mode: modeOf(mode) }, text.player.failed.loop);
  }

  async function setVolume(volume: number) {
    if (!guildId.value) return;
    try {
      apply((await axios.post<PlayerState>(url("/volume"), { volume: Number(volume) })).data);
    } catch (e) {
      notifyProblem(e, text.player.volumeFailed);
      void refresh();
    }
  }

  // 놓은 자리를 먼저 보이고 보낸다. entry 는 잡을 때의 곡(그 사이 바뀌었으면 서버가 거절한다)
  function seek(seconds: number, entry: number | null | undefined) {
    clock.value = retime(clock.value, Date.now(), { at: seconds });
    return send("seek", { position: seconds, ...(Number.isInteger(entry) ? { onTrack: entry } : {}) }, text.player.failed.seek);
  }

  // ── 수명 관리 ───────────────────────────────────────────────────────────────
  let ticker: ReturnType<typeof setInterval> | undefined;
  let offNudge: (() => boolean) | null = null;
  let stopWatch: (() => void) | null = null;
  let stopPageWatch: (() => void) | null = null;
  let started = 0;

  function start() {
    if (++started > 1) return;

    // 대상 서버가 바뀌면(참가·이동·퇴장) 즉시 다시 읽는다
    stopWatch = watch(guildId, () => void refresh(), { immediate: true });

    // 목록 연결의 신호. 내 대상 서버의 변화만 골라 받는다.
    // guildId 가 null 이면(어느 서버인지 모르는 신호) 안전하게 다시 읽는다.
    offNudge = onGuildNudge((changedGuildId) => {
      if (!guildId.value) return;
      if (onTargetPage.value) return; // 그 화면이 같은 상태를 이미 받고 있다. 둘이 각각 읽으면 요청이 배로 든다
      if (!changedGuildId || changedGuildId === guildId.value) void refresh();
    });

    // 그 화면을 벗어나는 순간 한 번 따라잡는다. 머무는 동안 건너뛴 변화가 있다.
    stopPageWatch = watch(onTargetPage, (on) => {
      if (!on) void refresh();
    });

    // 진행 시계. 위치는 받은 위치 + 지난 시간으로 센다(utils/playback)
    ticker = setInterval(() => (now.value = Date.now()), 1000);
  }

  function stop() {
    if (--started > 0) return;
    stopWatch?.();
    stopPageWatch?.();
    offNudge?.();
    clearInterval(ticker);
    stopWatch = stopPageWatch = offNudge = null;
    ticker = undefined;
    data.value = null;
  }

  return { data, page, guildId, guild, track, visible, canControl, running, canSkip, duration, position, isBusy, refresh, togglePause, skip, previous, shuffle, cycleLoop, setVolume, seek, start, stop };
});

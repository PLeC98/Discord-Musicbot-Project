import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import axios from "axios";
import router from "../router/index.js";
import { useGuildsStore, onGuildNudge } from "./guilds.js";

// 전역 재생 바 — "내가 들어가 있는 음성 채널에 봇이 있고, 뭔가 재생 중일 때"만 의미를 갖는다.
//
// ServerView와 상태를 공유하지 않는다. 재생 중인 서버의 화면에서는 바가 숨으므로(D-4)
// 같은 서버를 둘이 동시에 조회하는 상황이 생기지 않는다.
//
// SSE 연결은 새로 열지 않는다 — 세션당 캡(기본 5)이 있어서, 사이드바가 이미 유지 중인
// 목록 연결의 넛지를 나눠 쓴다(guilds.js onGuildNudge).
export const useNowPlayingStore = defineStore("nowPlaying", () => {
  const guilds = useGuildsStore();

  const data = ref(null); // GET /player 응답
  const localTime = ref(0); // 갱신 사이를 메우는 진행 위치(초)
  const scrubbing = ref(false); // 스크럽 중에는 서버 값으로 덮지 않는다

  // 대상 서버 — 동시 음성 참여가 불가능하므로 항상 하나 이하다(§1).
  const guildId = computed(() => guilds.guilds.find((g) => g.listening)?.id ?? null);
  const guild = computed(() => guilds.guilds.find((g) => g.id === guildId.value) ?? null);

  const track = computed(() => data.value?.currentTrack ?? null);
  // 그 서버의 화면은 전체화면 역할을 하므로 거기서는 숨긴다(D-4). 다른 서버 화면에서는 뜬다.
  const onTargetPage = computed(() => !!guildId.value && router.currentRoute.value.params.guildId === guildId.value);
  // 곡이 없어도 봇과 같은 채널이면 빈 셸로 남긴다 — 볼륨은 조작할 수 있고, 재생이 시작될 때
  // 레이아웃이 튀지 않는다. 채널이 다르거나 봇이 없으면(guildId null) 통째로 사라진다.
  const visible = computed(() => !!guildId.value && !onTargetPage.value && !!data.value?.hasPlayer);

  const canControl = computed(() => data.value?.canControl ?? false);
  const canSkip = computed(() => canControl.value || (!!track.value?.requestedBy?.id && track.value.requestedBy.id === data.value?.userId));
  const duration = computed(() => track.value?.duration ?? 0);
  const progressPct = computed(() => (duration.value > 0 ? Math.min(100, (localTime.value / duration.value) * 100) : 0));

  async function refresh() {
    const id = guildId.value;
    if (!id) {
      data.value = null;
      return;
    }
    try {
      const res = await axios.get(`/api/guilds/${id}/player`);
      // 응답이 오는 사이에 대상이 바뀌었으면 버린다
      if (guildId.value !== id) return;
      data.value = res.data;
      if (!scrubbing.value) localTime.value = res.data.currentTrack?.currentTime ?? 0;
    } catch {
      data.value = null; // 권한을 잃었거나 봇이 나갔다 — 바를 접는다
    }
  }

  async function action(type) {
    if (!guildId.value) return;
    try {
      await axios.post(`/api/guilds/${guildId.value}/player/${type}`);
    } catch (e) {
      console.error(type, e.response?.data || e.message);
    }
    refresh(); // 성공이든 거부든 서버 상태로 되돌린다
  }

  async function setVolume(volume) {
    if (!guildId.value) return;
    try {
      const res = await axios.post(`/api/guilds/${guildId.value}/player/volume`, { volume: Number(volume) });
      if (data.value) data.value = { ...data.value, volume: res.data.volume };
    } catch (e) {
      console.error("volume", e.response?.data || e.message);
      refresh();
    }
  }

  async function seek(seconds) {
    if (!guildId.value) return;
    localTime.value = seconds; // 응답을 기다리는 동안 손잡이가 튀지 않게
    try {
      await axios.post(`/api/guilds/${guildId.value}/player/seek`, { position: seconds });
    } catch (e) {
      console.error("seek", e.response?.data || e.message);
    }
    refresh();
  }

  // ── 수명 관리 ───────────────────────────────────────────────────────────────
  let ticker = null;
  let offNudge = null;
  let stopWatch = null;
  let started = 0;

  function start() {
    if (++started > 1) return;

    // 대상 서버가 바뀌면(참가·이동·퇴장) 즉시 다시 읽는다
    stopWatch = watch(guildId, () => refresh(), { immediate: true });

    // 목록 SSE 넛지 — 내 대상 서버의 변화만 골라 받는다.
    // guildId가 null이면(어느 서버인지 모르는 페이로드) 안전하게 갱신한다.
    offNudge = onGuildNudge((changedGuildId) => {
      if (!guildId.value) return;
      if (!changedGuildId || changedGuildId === guildId.value) refresh();
    });

    // 갱신 사이 진행 위치 보간 — 재생 중이고 스크럽하지 않을 때만
    ticker = setInterval(() => {
      if (!track.value || data.value?.paused || !data.value?.playing || scrubbing.value) return;
      if (duration.value > 0 && localTime.value >= duration.value) return;
      localTime.value += 1;
    }, 1000);
  }

  function stop() {
    if (--started > 0) return;
    stopWatch?.();
    offNudge?.();
    clearInterval(ticker);
    stopWatch = offNudge = ticker = null;
    data.value = null;
  }

  return { data, localTime, scrubbing, guildId, guild, track, visible, canControl, canSkip, duration, progressPct, refresh, action, setVolume, seek, start, stop };
});

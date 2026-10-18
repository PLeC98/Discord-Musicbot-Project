// 정보 화면(/system · /cachestatus · /ping · /license · /nowplaying)의 글자. 값은 부르는 쪽이 말로 적어 넘긴다

/** 새로고침 버튼 */
const refresh = () => "새로고침";

type SystemValues = {
  botUptime: string;
  osUptime: string;
  guilds: number;
  playing: number;
  memoryBar: string;
  memoryUsed: string;
  memoryTotal: string;
  heapUsed: string;
  heapTotal: string;
  rss: string;
  cpuModel: string | undefined;
  cores: number;
  load: string[];
  node: string;
  discordJs: string;
  platform: string;
  pid: number;
};
/** /system. 칸마다 { name, value } */
const system = (v: SystemValues) => ({
  title: "🖥️ 시스템 상태",
  uptime: { name: "⏱️ 업타임", value: [`**봇:** ${v.botUptime}`, `**OS:** ${v.osUptime}`].join("\n") },
  bot: { name: "🎵 봇 현황", value: [`**서버:** ${v.guilds}개`, `**재생 중:** ${v.playing}개`].join("\n") },
  memory: { name: "💾 메모리", value: [`**시스템:** ${v.memoryBar} (${v.memoryUsed} / ${v.memoryTotal})`, `**Heap 사용:** ${v.heapUsed} / ${v.heapTotal}`, `**RSS:** ${v.rss}`].join("\n") },
  cpu: { name: "⚙️ CPU", value: [`**모델:** ${v.cpuModel ?? "알 수 없음"} (${v.cores}코어)`, `**부하 (1m/5m/15m):** \`${v.load[0]}\` / \`${v.load[1]}\` / \`${v.load[2]}\``].join("\n") },
  runtime: { name: "🔧 런타임", value: [`**Node.js:** ${v.node}`, `**discord.js:** v${v.discordJs}`, `**플랫폼:** ${v.platform}`, `**PID:** ${v.pid}`].join("\n") },
});

type CacheValues = {
  sizeBar: string;
  size: string;
  maxSize: string;
  countBar: string;
  files: number;
  maxFiles: number;
  diskFree: string | null;
  minFreeDisk: string;
  plays: number;
  played: string;
  averageLength: string;
  neverPlayed: number;
  platforms: { youtube: number; soundcloud: number; direct: number };
  lookups: number;
  downloading: number;
  protectedCount: number;
};
/** /cachestatus. diskFree 는 잴 수 없으면 null */
const cache = (v: CacheValues) => ({
  title: "📦 오디오 캐시 현황",
  overview: {
    name: "💿 캐시 현황",
    value: [`**용량:** ${v.sizeBar}`, `\`${v.size}\` / \`${v.maxSize}\``, `**파일 수:** ${v.countBar}`, `\`${v.files}개\` / \`${v.maxFiles}개\``, `**디스크 여유:** ${v.diskFree === null ? "측정 불가" : `${v.diskFree} 여유`} (최소 ${v.minFreeDisk})`].join("\n"),
  },
  plays: { name: "▶️ 재생 통계", value: [`**총 재생 횟수:** ${v.plays.toLocaleString()}회`, `**총 재생 시간:** ${v.played}`, `**평균 곡 길이:** ${v.averageLength}`, `**한 번도 안 튼 곡:** ${v.neverPlayed}개`].join("\n") },
  platforms: { name: "🌐 플랫폼 분포", value: [`🔴 YouTube: **${v.platforms.youtube}**개`, `🟠 SoundCloud: **${v.platforms.soundcloud}**개`, `🔗 직접 링크: **${v.platforms.direct}**개`].join("\n") },
  misc: { name: "🔧 기타", value: [`**링크 데이터:** ${v.lookups}개`, `**다운로드 중:** ${v.downloading}개`, `**재생 보호 중:** ${v.protectedCount}개`].join("\n") },
  top: "🏆 재생 TOP 5",
  recent: "🆕 최근 추가",
  footer: `캐시 경로: audio_cache/`,
});
/** 캐시 화면의 빈 값 */
const cacheBlank = () => ({ noData: "데이터 없음", untitled: "제목 없음", unknownDate: "알 수 없음" });
/** 100시간이 넘는 총 재생 시간 */
const hours = (n: number) => `${n}시간`;
/** 재생 순위 한 줄. length 는 곡 길이를 적은 것 */
const topLine = (rank: number, title: string, plays: number, length: string) => `\`${rank}.\` **${title}**: ${plays}회 (${length})`;
/** 최근 받은 곡 한 줄 */
const recentLine = (title: string, date: string) => `**${title}** (${date})`;

/** /ping. mark 는 빠르기를 색으로 적은 것, apiMs 는 아직 잴 수 없으면 null */
const ping = ({ botMark, botMs, apiMark, apiMs }: { botMark: string; botMs: number; apiMark: string; apiMs: number | null }) => ({
  title: "🏓 퐁!",
  bot: { name: `${botMark} 봇 응답`, value: `\`${botMs}ms\`` },
  api: { name: `${apiMark} Discord API`, value: apiMs === null ? "`측정 중...`" : `\`${apiMs}ms\`` },
});
/** 첫 응답. 그 응답이 닿은 시각으로 잰다 */
const pinging = () => "핑 측정 중...";

/** /license. repos 는 저작권 줄들(마크다운 링크) */
const license = (lines: string[]) => ({
  title: "📜 라이선스 정보",
  description: "이 봇은 오픈 소스 소프트웨어입니다.\n" + "네트워크를 통해 이 봇과 상호작용하는 모든 사용자는 " + "GNU AGPL-3.0에 따라 소스 코드를 받을 권리가 있습니다.",
  license: { name: "⚖️ 라이선스", value: lines.join("\n") },
  summary: {
    name: "📑 라이선스 요약",
    value: "• 라이선스가 부여된 저작물 및 수정본(라이선스가 부여된 저작물을 활용한 더 큰 규모의 저작물 포함)의 전체 소스 코드를 동일한 AGPL-3.0 라이선스 하에 공개하는 것을 조건으로 합니다.\n• 저작권 및 라이선스 고지는 반드시 유지되어야 합니다.\n• 기여자는 특허 사용권을 명시적으로 허락합니다.\n• 수정된 버전을 사용하여 네트워크를 통해 서비스를 제공하는 경우, 해당 수정된 버전의 전체 소스 코드를 공개해야만 합니다.",
  },
  fullText: { name: "📚 라이선스 전문", value: "저장소의 `LICENSE`(AGPL-3.0) / `LICENSE-MIT`(MIT) / `NOTICE.md`(구조 설명) 파일을 참조하세요." },
  footer: "GNU AGPL-3.0-or-later • MIT",
});

/** /nowplaying. 칸 이름표 */
const nowPlaying = () => ({ title: "🎵 현재 재생 중", artist: "🎤 아티스트", album: "💿 앨범", platform: "🌐 출처", progress: "⏱️ 진행", requester: "👤 요청자", status: "📊 상태" });
/** /nowplaying 의 상태 줄 */
function nowPlayingStatus({ playing, paused, volume, loop }: { playing: boolean; paused: boolean; volume: number; loop: string | false }) {
  let text = playing ? "▶️ 재생 중" : paused ? "⏸️ 일시정지" : "⏳ 준비 중";
  text += ` • 🔊 ${volume}%`;
  if (loop === "track") text += " • 🔂 한 곡 반복";
  else if (loop === "queue") text += " • 🔁 대기열 반복";
  return text;
}

export { refresh, system, cache, cacheBlank, hours, topLine, recentLine, ping, pinging, license, nowPlaying, nowPlayingStatus };

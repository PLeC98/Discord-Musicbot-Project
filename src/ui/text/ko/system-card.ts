// /system 이미지의 문구. 용어는 대시보드 봇 상태 탭과 같다. 이미지는 등록한 글꼴(ui/card-render/fonts)로만 글자를 그리므로,
// 그 글꼴에 없는 글자가 들어오면 test/ui/system-card-text.test.ts 가 잡는다

/** 상태 카드 */
const allOk = "모두 정상";
const needsAttention = (count: number) => `확인이 필요한 항목이 ${count}개 있어요`;
const recent = (warn: number, error: number) => `지난 1시간 경고 ${warn} · 오류 ${error}`;

/** CPU 카드: 큰 숫자는 봇 사용률, 아래 줄에 시스템 전체와 코어 수 */
const cpu = "CPU";
const cpuSub = (systemPct: number, cores: number) => `시스템 ${systemPct}% · ${cores}코어`;

/** heap 메모리 카드: 사용량 / V8 상한, RSS */
const heap = "heap 메모리";
const heapSub = (used: string, limit: string, rss: string) => `${used} / 상한 ${limit} · RSS ${rss}`;

/** 저장공간 카드 */
const cache = "캐시";
const usedOf = (used: string, max: string) => `${used} / ${max}`;
const disk = (drive: string) => `디스크 ${drive}`;
const diskFree = (free: string) => `여유 ${free}`;

/** 업타임 카드 */
const uptime = "업타임";
const uptimeBot = "봇";
const uptimeOs = "OS";

/** 현황 카드 */
const overview = "현황";
const guilds = "서버";
const playing = "재생 중";
const users = "사용자";

/** 최근 기록 그래프 */
const loop = "이벤트 루프 지연";
const encoding = "인코딩 응답 시간";
const p99 = "p99";
const legendBot = "봇";
const legendSystem = "시스템";
const minutesAgo = (minutes: number) => `${minutes}분 전`;
const now = "지금";
/** 기동 직후 첫 기록(15초)이 아직 없을 때 */
const collecting = "기록을 모으는 중";

/** 이미지 밖(디스코드 메시지) */
const title = "시스템 상태";
/** 제목 아래 버전 줄. bgutil 은 POToken 서버를 켰을 때만 */
const versions = (bot: string, ytdlp: string | null, bgutil: string | null) => [`봇 v${bot}`, ytdlp ? `yt-dlp ${ytdlp}` : null, bgutil ? `bgutil ${bgutil}` : null].filter(Boolean).join(" · ");
const updated = (at: string) => `갱신: ${at}`;
/** 운영자 패널의 봇 상태 탭으로 가는 링크 버튼 */
const panelLink = "운영자 패널";
/** 이미지를 그리는 동안 */
const drawing = "상태 이미지를 그리는 중이에요";
/** 이미지를 그리지 못했을 때(캔버스를 불러오지 못하는 플랫폼 등) */
const drawFailed = "상태 이미지를 그리지 못했어요. 같은 내용은 대시보드의 봇 상태 탭에서 볼 수 있어요";
/** 이미지를 볼 수 없을 때 읽히는 설명 */
const cardAlt = "상태, CPU, heap 메모리, 저장공간, 업타임, 현황";
const historyAlt = "최근 CPU, 이벤트 루프 지연, 인코딩 응답 시간";

export { allOk, needsAttention, recent, cpu, cpuSub, heap, heapSub, cache, usedOf, disk, diskFree, uptime, uptimeBot, uptimeOs, overview, guilds, playing, users, loop, encoding, p99, legendBot, legendSystem, minutesAgo, now, collecting, title, versions, updated, panelLink, drawing, drawFailed, cardAlt, historyAlt };

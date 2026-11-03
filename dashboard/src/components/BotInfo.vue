<template>
  <!-- 봇 정보 탭: 리싱한 Arch(Hyprland) 데스크톱의 터미널에서 fastfetch 를 실행한 모습(이 탭만 M3E 가 아니라 터미널 스타일).
       간격은 글자 셀 격자(가로 1ch, 세로 한 줄 --term-line, 터미널처럼 글자 크기의 약 1.2배)에 맞춘다.
       창은 내용이 짧아도 바탕화면 아래 끝까지 채운다(재생 바는 그 위에 겹친다. 페이지 아래 여백의 재생 바 몫은 음수 여백으로 돌려준다).
       내용이 길어 스크롤되면 끝까지 스크롤했을 때 마지막 줄이 재생 바 위 끝에서 창 여백만큼 떨어지도록 안쪽 아래 여백에 (재생 바 - 바깥 틈)을 더한다.
       잘 안 바뀌는 신원, 버전, 환경만 둔다(지금 상태는 봇 상태 탭). 키는 fastfetch 처럼 영어. 한글은 고정폭 글꼴에서 두 칸이라 터미널처럼 같은 글꼴로 쓴다 -->
  <section class="term-border pane relative rounded-(--r-window) p-(--pad-window) pb-[calc(var(--pad-window)+max(0px,var(--player)-var(--gap-out)))] font-mono text-sm leading-(--term-line) [--term-line:1.0625rem] text-on-surface min-h-[calc(var(--desk-h)-var(--gap-out)*2)] -mb-(--player)">
    <Prompt command="fastfetch" />
    <div class="flex gap-[3ch] items-start">
      <BotInfoLogo class="hidden @4xl/content:block shrink-0" :src="shell.botAvatar" aria-hidden="true" />
      <!-- flex: 상자 아래 반 줄과 색 띠 위 한 줄이 겹치지 않게(여백 겹침이면 격자에서 반 줄 어긋난다) -->
      <div class="flex-1 min-w-0 flex flex-col">
        <!-- 바깥 상자: 윗선 가운데에 봇 이름, 버전 -->
        <Frame :title="`${status.bot.tag} · ${status.bot.version}`" tone="text-outline" title-tone="text-on-surface-variant" class="w-[round(down,100%,1ch)]">
          <div class="grid grid-cols-1 @3xl/content:grid-cols-[repeat(2,round(down,calc((100%-2ch)/2),1ch))] gap-x-[2ch]">
            <Frame v-for="g in infoGroups" :key="g.title" :title="g.title" :tone="g.tone">
              <div class="grid grid-cols-[auto_1fr]">
                <template v-for="r in g.rows" :key="r.key">
                  <span class="flex items-center gap-[1ch] pr-[1.5ch] whitespace-nowrap" :class="g.tone"><Icon :name="r.icon" :size="14" />{{ r.key }}</span>
                  <span class="pl-[calc(1.5ch-1px)] border-l border-current/30 truncate" :class="g.tone"
                    ><span class="text-on-surface">{{ r.value }}</span
                    ><span v-if="r.note" class="ml-[1ch] text-on-surface-variant">{{ r.note }}</span></span
                  >
                </template>
              </div>
            </Frame>
          </div>
        </Frame>
        <!-- 터미널 16색 띠(fastfetch 의 colors 모듈, ███ 세 셀씩): 윗줄 보통 8색, 아랫줄 밝은 8색. 색은 지금 테마의 역할에서. 글자 █ 는 글꼴마다 셀 사이가 비어 줄무늬가 지므로 셀만 한 면으로 -->
        <div class="w-max">
          <div v-for="(row, i) in ANSI" :key="i" class="flex">
            <span v-for="c in row" :key="c" class="inline-block w-[3ch] h-(--term-line)" :style="{ background: c }"></span>
          </div>
        </div>
      </div>
    </div>
    <!-- 다음 프롬프트와 깜박이는 커서 -->
    <Prompt class="mt-(--term-line)" cursor />
  </section>
</template>

<script setup lang="ts">
import { computed, defineComponent, h } from "vue";
import Icon from "./BaseIcon.vue";
import type { AdminStatus } from "../../../src/dashboard/contract/admin.ts";
import { byteUnit, scaledText } from "../../../src/ui/format.ts";
import type { IconName } from "../icons.ts";
import { shell } from "../shell/shell-state.ts";
import BotInfoLogo from "./BotInfoLogo.vue";

const props = defineProps<{ status: AdminStatus }>();

/**
 * 제목이 윗선 가운데에 걸친 상자(터미널의 ╭─ 제목 ─╮). 상자 글자처럼 선은 칸 가운데를 지난다: 세로선은 첫 칸, 끝 칸의 가운데, 모서리는 반 칸 반지름, 내용은 "│ " 다음 칸부터.
 * 아랫선 줄도 한 줄을 다 쓴다(선은 그 줄 가운데, 1px 테두리 몫을 여백에서 뺀다). 폭은 쓰는 쪽이 칸 단위로 맞춘다.
 * 바탕이 반투명이어도 선이 글자 밑을 지나지 않게 윗선을 조각으로 긋는다.
 * tone: 선, 제목 색(text-* 클래스, 선은 currentColor). titleTone: 제목만 다른 색(선이 outline 처럼 글자로는 대비가 모자란 색일 때)
 */
const Frame = defineComponent({
  props: { title: { type: String, required: true }, tone: { type: String, required: true }, titleTone: { type: String, default: "" } },
  setup(p, { slots }) {
    const line = "self-end h-[calc(var(--term-line)/2)] border-t border-current";
    return () =>
      h("div", { class: ["flex flex-col mb-[calc(var(--term-line)/2)]", p.tone] }, [
        h("div", { class: "flex items-center h-(--term-line)" }, [h("span", { class: `${line} ml-[0.5ch] w-[0.5ch] border-l rounded-tl-[0.5ch]` }), h("span", { class: `${line} flex-1` }), h("span", { class: ["px-[1ch] font-semibold truncate", p.titleTone] }, p.title), h("span", { class: `${line} flex-1` }), h("span", { class: `${line} mr-[0.5ch] w-[0.5ch] border-r rounded-tr-[0.5ch]` })]),
        h("div", { class: "flex-1 mx-[0.5ch] border-x border-b border-current rounded-b-[0.5ch] px-[calc(1.5ch-1px)] pb-[calc(var(--term-line)/2-1px)]" }, slots.default?.()),
      ]);
  },
});

/**
 * starship 식 프롬프트(기본 설정처럼 두 줄): 색 블록(사용자@호스트, 폴더, 브랜치)이 꺾쇠로 이어지고 다음 줄에 ❯ 와 명령. cursor 면 명령 대신 깜박이는 커서
 */
const PROMPT: Array<{ icon: IconName; text: string; tone: string; ink: string }> = [
  { icon: "person", text: "operator@musicbot", tone: "bg-primary text-on-primary", ink: "var(--md-primary)" },
  { icon: "folder", text: "~/musicbot", tone: "bg-secondary text-on-secondary", ink: "var(--md-secondary)" },
  { icon: "commit", text: "main", tone: "bg-tertiary text-on-tertiary", ink: "var(--md-tertiary)" },
];
const Prompt = defineComponent({
  props: { command: { type: String, default: "" }, cursor: { type: Boolean, default: false } },
  setup(p) {
    return () =>
      h("div", { class: "flex flex-wrap items-center min-h-(--term-line) w-max max-w-full" }, [
        ...PROMPT.flatMap((seg, i) => [
          // 좁은 내용 영역(576px 미만, 휴대폰)은 첫 블록(사용자@호스트) 말고는 글을 빼고 아이콘만(블록이 줄바꿈 없이 이어져 창 밖으로 넘친다)
          h("span", { class: ["flex items-center gap-[1ch] h-(--term-line) pl-[1ch] pr-[0.5ch] whitespace-nowrap font-semibold", i > 0 && "@max-xl/content:gap-0", seg.tone, i === 0 && "rounded-l-full"] }, [h(Icon, { name: seg.icon, size: 14 }), h("span", { class: i > 0 ? "@max-xl/content:hidden" : undefined }, seg.text)]),
          // 꺾쇠: 이 블록 색의 세모를 다음 블록 색(마지막은 투명) 위에
          h("span", { class: "h-(--term-line)", style: { background: PROMPT[i + 1]?.ink ?? "transparent" } }, [h("span", { class: "block h-(--term-line) w-[1ch]", style: { background: seg.ink, clipPath: "polygon(0 0, 100% 50%, 0 100%)" } })]),
        ]),
        // starship 기본처럼 ❯ 와 명령은 다음 줄
        h("span", { class: "basis-full h-0" }),
        h("span", { class: "text-(--ok-ink) font-semibold" }, "❯"),
        p.command ? h("span", { class: "ml-[1ch]" }, p.command) : null,
        // 커서는 세 번 깜빡이고 켜진 채 멈춘다(끝없는 움직임을 두지 않는다)
        p.cursor ? h("span", { class: "ml-[1ch] inline-block w-[1ch] h-(--term-line) bg-on-surface animate-[term-blink_1.2s_steps(1)_3]" }) : null,
      ]);
  },
});

// 터미널 16색(검정, 빨강, 초록, 노랑, 파랑, 자주, 청록, 흰색). 보통 8색은 테마의 역할, 밝은 8색은 글자색 쪽으로 30% 섞는다
const NORMAL = ["var(--md-outline)", "var(--md-error)", "var(--ok-ink)", "var(--warn-ink)", "var(--md-primary)", "var(--md-tertiary)", "var(--md-secondary)", "var(--md-on-surface-variant)"];
const ANSI = [NORMAL, NORMAL.map((c) => `color-mix(in oklab, ${c} 70%, var(--md-on-surface))`)];

// fastfetch 의 길이 말("13 hours, 10 mins"). 0 인 단위는 뺀다
function uptimeText(sec: number) {
  const days = Math.floor(sec / 86400);
  const hours = Math.floor((sec % 86400) / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const part = (n: number, unit: string) => (n ? `${n} ${unit}${n === 1 ? "" : "s"}` : "");
  return [part(days, "day"), part(hours, "hour"), part(mins, "min")].filter(Boolean).join(", ") || "0 mins";
}
// 크기: 단위는 크기에 맞게(src/ui/format 의 byteUnit), 이진 단위 이름(GiB, TiB)으로 소수 둘째 자리
const binText = (bytes: number) => {
  const { value, unit } = scaledText(bytes, byteUnit, () => 2);
  return `${value} ${unit.replace("B", "iB")}`;
};
const binFromMb = (mb: number) => binText(mb * 1024 ** 2);
const percentText = (a: number, b: number) => `(${Math.round((a / b) * 100)}%)`;
const osName = (p: string) => (p === "win32" ? "Windows" : p === "darwin" ? "macOS" : "Linux");
// "2026-10-07 01:37"
const dateTimeText = (ms: number) => {
  const date = new Date(ms);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
};

type InfoRow = { icon: IconName; key: string; value: string; note?: string };
const infoGroups = computed<Array<{ title: string; tone: string; rows: InfoRow[] }>>(() => {
  const { status } = props;
  const memUsed = status.system.totalMem - status.system.freeMem;
  const { disk, cache, db } = status.storage;
  const { bgutil } = status.env;
  const bgutilRows: InfoRow[] = bgutil ? [{ icon: "key", key: "bgutil", value: bgutil.installed, note: bgutil.installed !== bgutil.target ? `(→ ${bgutil.target})` : bgutil.newer ? `(${bgutil.newer} available)` : undefined }] : [];
  return [
    {
      title: "Bot",
      tone: "text-primary",
      rows: [
        { icon: "smart_toy", key: "Name", value: status.bot.tag },
        { icon: "sell", key: "Version", value: status.bot.version },
        { icon: "schedule", key: "Uptime", value: uptimeText(status.bot.uptime) },
        { icon: "event", key: "Started", value: dateTimeText(status.bot.startedAt) },
        { icon: "public", key: "Guilds", value: `${status.bot.guilds}` },
        { icon: "graphic_eq", key: "Players", value: `${status.activePlayers}`, note: `(${status.players.counts.playing} playing)` },
        { icon: "terminal", key: "Commands", value: `${status.env.commands.count}`, note: `(${status.env.commands.scope})` },
      ],
    },
    {
      title: "Runtime",
      tone: "text-tertiary",
      rows: [
        { icon: "code", key: "Node.js", value: status.node.version },
        { icon: "forum", key: "discord.js", value: status.env.discordJs },
        { icon: "download", key: "yt-dlp", value: status.env.ytdlp.version ?? "—", note: status.env.ytdlp.autoUpdate ? "(auto-update)" : undefined },
        { icon: "movie", key: "ffmpeg", value: status.env.ffmpeg ?? "—" },
        ...bgutilRows,
        { icon: "tag", key: "PID", value: `${status.env.pid}` },
        { icon: "list", key: "Log Level", value: status.logLevel },
        { icon: "dashboard", key: "Dashboard", value: `${status.env.dashboardClients}`, note: "connected" },
      ],
    },
    {
      title: "Host",
      tone: "text-secondary",
      rows: [
        { icon: "computer", key: "OS", value: `${osName(status.node.platform)} ${status.node.arch}` },
        { icon: "timer", key: "Uptime", value: uptimeText(status.system.uptime) },
        { icon: "memory", key: "CPU", value: status.system.cpuModel, note: `(${status.system.cpus})` },
        { icon: "memory_alt", key: "Memory", value: `${binFromMb(memUsed)} / ${binFromMb(status.system.totalMem)}`, note: percentText(memUsed, status.system.totalMem) },
        { icon: "data_object", key: "Heap", value: `${binFromMb(status.node.memory.heapUsed)} / ${binFromMb(status.node.memory.heapLimit)}`, note: percentText(status.node.memory.heapUsed, status.node.memory.heapLimit) },
      ],
    },
    {
      title: "Storage",
      tone: "text-on-surface-variant",
      rows: [
        { icon: "hard_drive", key: `Disk (${disk.drive})`, value: `${binText(disk.usedBytes)} / ${binText(disk.totalBytes)}`, note: percentText(disk.usedBytes, disk.totalBytes) },
        { icon: "library_music", key: "Cache", value: `${binText(cache.bytes)} / ${binText(cache.maxBytes)}`, note: percentText(cache.bytes, cache.maxBytes) },
        { icon: "folder", key: "Files", value: `${cache.files.toLocaleString("en-US")} / ${cache.maxFiles.toLocaleString("en-US")}` },
        { icon: "database", key: "Database", value: `${(db.bytes / 1024 ** 2).toFixed(1)} MiB` },
      ],
    },
  ];
});
</script>

<template>
  <div class="max-w-275 mx-auto px-3 py-4.5">
    <h1 class="pl-2 text-[1.7rem] font-extrabold mb-4 tracking-tight bg-linear-135 from-[#e8eaf6] via-[#c4b5fd] via-55% to-[#a78bfa] bg-clip-text text-transparent">운영자 패널</h1>

    <div v-if="loading" class="flex items-center justify-center p-20 text-muted">불러오는 중...</div>

    <template v-else>
      <!-- 탭 — 카드가 늘어나 한 화면에 다 두면 찾기 어렵다.
           v-if가 아니라 v-show인 이유: 로그 뷰어의 누적 로그와 스크롤 위치가 탭을 오갈 때 날아가면 안 된다.

           바깥이 스크롤러, 안쪽 줄이 경계선을 갖는다. 경계선을 스크롤러에 두면 가로 스크롤바가
           그 안쪽(선 위)에 그려진다. overflow-y를 명시하지 않으면 visible이 auto로 바뀌어,
           버튼의 -mb-px 1px 때문에 모든 해상도에서 세로 스크롤바가 상시로 생긴다. -->
      <div :class="tabScroller">
        <div class="flex gap-1 min-w-max border-b border-white/8">
          <button v-for="t in TABS" :key="t.id" type="button" :class="[tabBtn, tab === t.id ? tabOn : tabOff]" @click="setTab(t.id)"><Icon :name="t.icon" :size="15" />{{ t.label }}</button>
        </div>
      </div>

      <div v-show="tab === 'status'">
        <p class="pl-2 text-muted mb-3 text-[0.85rem]">3초마다 자동 갱신 · 탭을 벗어나면 멈춤</p>
        <!-- auto-fill은 중간 폭에서 2/1로 갈라져 빈칸이 남는다. 카드가 4개이므로 2열로 못박아 2/2, 좁으면 1열. -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-3 mb-3">
          <!-- Bot -->
          <BaseCard icon="robot" title="봇 상태">
            <div :class="statRow">
              <span>태그</span><span>{{ s.bot.tag }}</span>
            </div>
            <div :class="statRow">
              <span>서버 수</span><strong>{{ s.bot.guilds }}</strong>
            </div>
            <div :class="statRow">
              <span>활성 플레이어</span><strong>{{ s.activePlayers }}</strong>
            </div>
            <div :class="statRow">
              <span>WebSocket 핑</span><span :class="pingClass(s.bot.ping)">{{ s.bot.ping }} ms</span>
            </div>
            <div :class="statRow">
              <span>업타임</span><span>{{ uptimeStr }}</span>
            </div>
          </BaseCard>

          <!-- Node.js -->
          <BaseCard icon="gear" title="Node.js">
            <div :class="statRow">
              <span>버전</span><span>{{ s.node.version }}</span>
            </div>
            <div :class="statRow">
              <span>플랫폼</span><span>{{ s.node.platform }} / {{ s.node.arch }}</span>
            </div>
            <div :class="statRow">
              <span>Heap 사용</span><span>{{ s.node.memory.heapUsed }} MB / {{ s.node.memory.heapTotal }} MB</span>
            </div>
            <div :class="statRow">
              <span>RSS</span><span>{{ s.node.memory.rss }} MB</span>
            </div>
          </BaseCard>

          <!-- System -->
          <BaseCard icon="desktop" title="시스템">
            <div :class="statRow">
              <span>CPU 코어</span><span>{{ s.system.cpus }} 코어</span>
            </div>
            <div :class="statRow">
              <span>여유 메모리</span><span>{{ s.system.freeMem }} MB / {{ s.system.totalMem }} MB</span>
            </div>
            <div :class="statRow" v-if="s.system.loadAvg">
              <span>로드 평균</span>
              <span>{{ s.system.loadAvg.map((n) => n.toFixed(2)).join(" · ") }}</span>
            </div>
          </BaseCard>

          <!-- 자식 프로세스 — 재생 ffmpeg는 곡이 끝나면 사라져야 한다.
               오래 남아 있으면 정리 사슬이 끊긴 것이므로 나이를 강조해서 보여준다. -->
          <BaseCard icon="terminal" title="자식 프로세스">
            <div :class="statRow">
              <span>총 개수</span><strong>{{ s.processes.total }}</strong>
            </div>
            <div v-for="p in s.processes.byLabel" :key="p.label" :class="statRow">
              <span>{{ p.label }}</span
              ><strong>{{ p.count }}</strong>
            </div>
            <div v-if="s.processes.total === 0" :class="statRow">
              <span class="text-muted">떠 있는 프로세스 없음</span>
            </div>
            <div v-if="s.processes.oldest.length" class="mt-2">
              <div v-for="p in s.processes.oldest" :key="p.pid" :class="statRow">
                <span class="font-mono text-[0.78rem]"
                  >{{ p.label }}<span class="text-muted"> #{{ p.pid }}</span></span
                >
                <span :class="procAgeClass(p.ageMs)">{{ fmtAge(p.ageMs) }}</span>
              </div>
            </div>
          </BaseCard>

          <!-- 유튜브 접속 경로 — 어느 것이 실행 중 제외됐는지는 여기서만 보인다.
               기동 로그는 시작 시점의 설정만 보여주므로 도중에 막힌 경로를 알 수 없다. -->
          <BaseCard icon="globe" title="유튜브 접속 경로">
            <div :class="statRow">
              <span>POToken</span><span :class="s.youtube.pot === 'missing' ? 'text-danger' : ''">{{ potLabel(s.youtube.pot) }}</span>
            </div>
            <div :class="statRow">
              <span>쿠키</span><span>{{ cookieLabel(s.youtube.cookies) }}</span>
            </div>
            <div :class="statRow">
              <span>클라이언트 경로</span><span>{{ s.youtube.configured ? `${s.youtube.clients.length}개 지정` : "미지정 (yt-dlp 기본값)" }}</span>
            </div>
            <div v-if="s.youtube.configured" class="mt-2">
              <div v-for="(c, i) in s.youtube.clients" :key="c.name" :class="statRow">
                <span class="font-mono text-[0.78rem]">
                  <span class="text-muted">{{ i + 1 }}.</span> {{ c.name }}
                  <span v-if="c.needsPot" class="text-muted text-[0.7rem]"> POT</span>
                  <span v-if="!c.known" class="text-warning text-[0.7rem]"> 미확인</span>
                </span>
                <span :class="clientClass(c)">{{ clientLabel(c) }}</span>
              </div>
            </div>
          </BaseCard>
        </div>
      </div>

      <div v-show="tab === 'logs'">
        <!-- Log viewer -->
        <BaseCard class="mb-3">
          <div class="flex justify-between items-start flex-wrap gap-2.5 mb-2.5">
            <span :class="cardTitle" class="mb-0! inline-flex items-center gap-1.5"><Icon name="list" :size="15" /><span>실시간 로그</span></span>
            <div class="flex gap-1.5 flex-wrap">
              <button v-for="lvl in logLevels" :key="lvl.value" :class="typeBtn(levelsOn.has(lvl.value))" @click="toggleLevel(lvl.value)">{{ lvl.label }}</button>
              <button :class="typeBtn(autoScroll)" @click="autoScroll = !autoScroll">
                <span class="inline-flex items-center gap-1"><Icon :name="autoScroll ? 'scroll-down' : 'pause'" :size="15" />{{ autoScroll ? "자동" : "정지" }}</span>
              </button>
              <button :class="typeBtn(false)" @click="logs = []">지우기</button>
            </div>
          </div>
          <div v-if="logCategories.length" class="flex gap-1.5 flex-wrap mb-2">
            <button v-for="cat in logCategories" :key="cat" class="px-2.5 py-1 rounded-[20px] border cursor-pointer text-[0.76rem] font-medium transition-[background-color,border-color] duration-200" :style="catFilter === cat ? { color: catColor(cat), borderColor: catColor(cat) + '88', backgroundColor: catColor(cat) + '22' } : { color: 'rgba(255,255,255,0.5)', borderColor: 'rgba(255,255,255,0.09)', backgroundColor: 'rgba(255,255,255,0.03)' }" @click="catFilter = catFilter === cat ? null : cat">
              {{ cat }}
            </button>
          </div>
          <!-- 태그: 카테고리와 같은 규칙(흘러온 것에서 파생). 태그를 단 로그가 없으면 줄 자체가 없다. -->
          <div v-if="logTags.length" class="flex gap-1.5 flex-wrap mb-2">
            <button v-for="t in logTags" :key="t" class="px-2.5 py-1 rounded-[20px] border cursor-pointer text-[0.76rem] font-medium transition-[background-color,border-color] duration-200" :class="tagFilter === t ? 'text-fg border-white/35 bg-white/12' : 'text-[rgba(255,255,255,0.5)] border-white/9 bg-white/3'" @click="tagFilter = tagFilter === t ? null : t">#{{ t }}</button>
          </div>
          <div class="flex items-center gap-1.5 text-[0.8rem] text-muted mb-2">
            <span :class="sseConnected ? 'text-success' : 'text-danger'">●</span>
            <span>{{ sseConnected ? "연결됨" : "연결 끊김" }}</span>
            <span v-if="levelsOn.size < logLevels.length" class="text-[#c4b5fd]">{{ [...levelsOn].map((l) => l.toUpperCase()).join(" · ") || "레벨 전부 꺼짐" }}</span>
            <span class="ml-auto">{{ filteredLogs.length }}줄</span>
          </div>
          <div class="h-95 overflow-y-auto bg-black/35 rounded-[10px] border border-white/7 px-3 py-2 font-mono text-[0.78rem]" ref="logPane" @scroll="onLogScroll">
            <div v-if="filteredLogs.length === 0" class="text-muted text-center py-10">로그 없음</div>
            <div v-for="(entry, i) in filteredLogs" :key="i" class="flex gap-2 leading-relaxed border-b border-white/3">
              <span class="text-[#6b7280] shrink-0">{{ fmtTime(entry.ts) }}</span>
              <span class="shrink-0 w-10 font-bold" :class="lvColor(entry.level)">{{ entry.level.toUpperCase() }}</span>
              <span v-if="entry.category || entry.sub" class="shrink-0 self-center px-1.5 rounded text-[0.66rem] font-semibold leading-tight" :style="{ color: catColor(entry.category || entry.sub), backgroundColor: catColor(entry.category || entry.sub) + '22' }">{{ entry.category }}{{ entry.sub ? "/" + entry.sub : "" }}</span>
              <span v-for="t in entry.tags" :key="t" class="shrink-0 self-center px-1.5 rounded text-[0.64rem] font-medium leading-tight text-[#9ca3af] bg-white/6">#{{ t }}</span>
              <span class="break-all whitespace-pre-wrap" :class="txtColor(entry.level)">{{ entry.text }}</span>
            </div>
          </div>
        </BaseCard>
      </div>

      <div v-show="tab === 'guilds'">
        <!-- Broadcast -->
        <BaseCard icon="campaign" title="전체 공지 발송" class="mb-3">
          <p class="text-muted text-sm mb-4">봇이 들어간 모든 서버에 공지 메시지를 보냅니다.</p>

          <div class="flex gap-2 mb-3.5 flex-wrap">
            <button v-for="type in types" :key="type.value" :class="typeBtn(bType === type.value)" @click="bType = type.value">{{ type.label }}</button>
          </div>

          <textarea v-model="bMsg" placeholder="공지 내용을 입력하세요..." rows="4" class="w-full bg-white/5 border border-white/9 rounded-xl text-fg px-3.5 py-3 text-[0.9rem] resize-y outline-none mb-3.5 font-[inherit] transition-[border-color,background-color] duration-200 focus:border-accent/55 focus:bg-white/7"></textarea>

          <BaseButton variant="primary" @click="broadcast" :disabled="sending || !bMsg.trim()">
            {{ sending ? "발송 중..." : "전체 발송" }}
          </BaseButton>

          <div v-if="result" :class="resultMsg(result.success)" class="flex items-center gap-1.5">
            <Icon :name="result.success ? 'check' : 'error'" :size="16" />
            <span>{{ result.success ? `${result.sent}개 서버 발송 완료 (실패: ${result.failed})` : "발송 실패" }}</span>
          </div>
        </BaseCard>

        <!-- Guild management -->
        <BaseCard icon="globe" title="참가 서버 관리" class="mb-3">
          <p class="text-muted text-sm mb-4">봇이 참가 중인 서버 목록입니다. 나가기는 되돌릴 수 없으며, 다시 사용하려면 재초대해야 합니다.</p>

          <div v-if="guilds.length === 0" class="text-muted text-sm">참가 중인 서버가 없습니다.</div>
          <div v-else class="flex flex-col max-h-80 overflow-y-auto [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-track]:bg-(--sb-track-color) [&::-webkit-scrollbar-track]:rounded-[5px] [&::-webkit-scrollbar-thumb]:bg-(--sb-thumb-color) [&::-webkit-scrollbar-thumb]:rounded-[5px]">
            <div v-for="g in guilds" :key="g.id" class="flex items-center gap-3 py-2.5 pr-2 border-b border-white/7 last:border-b-0 last:pb-0">
              <img v-if="g.icon" :src="g.icon" :alt="g.name" class="size-9 rounded-full border border-white/10 shrink-0" />
              <div v-else class="size-9 rounded-full border border-white/10 bg-linear-135 from-accent to-accent-2 text-sm font-bold flex items-center justify-center shrink-0">{{ g.name[0] }}</div>
              <div class="flex-1 overflow-hidden">
                <div class="text-sm font-semibold overflow-hidden whitespace-nowrap text-ellipsis">{{ g.name }}</div>
                <div class="text-[0.78rem] text-muted">
                  멤버 {{ g.memberCount }}명<span v-if="g.hasPlayer" class="text-success"> · <Icon name="music" :size="12" class="inline" /> 재생 중</span>
                </div>
              </div>
              <BaseButton variant="ghost" size="sm" @click="leaveTarget = g">나가기</BaseButton>
            </div>
          </div>

          <div v-if="leaveResult" :class="resultMsg(leaveResult.success)" class="flex items-center gap-1.5">
            <Icon :name="leaveResult.success ? 'check' : 'error'" :size="16" />
            <span>{{ leaveResult.success ? `"${leaveResult.name}" 서버에서 나갔습니다` : `나가기 실패: ${leaveResult.error}` }}</span>
          </div>
        </BaseCard>
      </div>

      <div v-show="tab === 'dev'">
        <!-- 권한 수준 오버라이드 — 디스코드의 "역할 적용해서 서버 보기"에 해당. 서버측 판정까지 함께 낮아진다. -->
        <BaseCard icon="wrench" title="권한 수준으로 보기" class="mb-3">
          <p class="text-muted text-[0.82rem] mt-1 mb-3">선택한 계층으로 대시보드를 사용합니다. 화면 표시뿐 아니라 서버가 실제로 허용하는 동작까지 그 계층을 따릅니다. 이 패널은 오버라이드와 무관하게 계속 열 수 있습니다.</p>
          <div class="flex flex-col gap-1.5">
            <button type="button" :class="[tierRow, user.viewAs === null ? tierOn : tierOff]" :disabled="switchingTier" @click="pickTier(null)">
              <span class="mt-0.5 size-4 shrink-0 rounded-full border-2 flex items-center justify-center" :class="user.viewAs === null ? 'border-[#c4b5fd]' : 'border-white/25'">
                <span v-if="user.viewAs === null" class="size-2 rounded-full bg-[#c4b5fd]"></span>
              </span>
              <span class="min-w-0">
                <span class="block text-[0.85rem] font-semibold">오버라이드 하지 않음</span>
                <span class="block text-[0.78rem] text-muted">평소 상태로 되돌립니다.</span>
              </span>
            </button>

            <button v-for="t in VIEW_AS_TIERS" :key="t.id" type="button" :class="[tierRow, user.viewAs === t.id ? tierOn : tierOff]" :disabled="switchingTier" @click="pickTier(t.id)">
              <span class="mt-0.5 size-4 shrink-0 rounded-full border-2 flex items-center justify-center" :class="user.viewAs === t.id ? 'border-[#c4b5fd]' : 'border-white/25'">
                <span v-if="user.viewAs === t.id" class="size-2 rounded-full bg-[#c4b5fd]"></span>
              </span>
              <span class="min-w-0">
                <span class="block text-[0.85rem] font-semibold">{{ t.label }}</span>
                <span class="block text-[0.78rem] text-muted">{{ t.desc }}</span>
              </span>
            </button>
          </div>

          <p v-if="tierError" class="text-[#f87171] text-[0.8rem] mt-2.5">{{ tierError }}</p>
        </BaseCard>

        <!-- Command redeploy -->
        <BaseCard icon="repeat" title="슬래시 커맨드 재배포" class="mb-3">
          <p class="text-muted text-sm mb-4">현재 로드된 슬래시 커맨드를 Discord에 다시 등록합니다. 봇 재시작 없이 실행됩니다.</p>

          <BaseButton variant="primary" @click="redeploy" :disabled="redeploying">
            {{ redeploying ? "재배포 중..." : "커맨드 재배포" }}
          </BaseButton>

          <div v-if="redeployResult" :class="resultMsg(redeployResult.success)" class="flex items-center gap-1.5">
            <Icon :name="redeployResult.success ? 'check' : 'error'" :size="16" />
            <span>{{ redeployResult.success ? `${redeployResult.count}개 커맨드 ${redeployResult.scope === "guild" ? "서버" : "전역"} 배포 완료` : `재배포 실패: ${redeployResult.error || ""}` }}</span>
          </div>
        </BaseCard>

        <!-- Cache reset -->
        <BaseCard icon="trash" title="캐시 초기화">
          <p class="text-muted text-sm mb-4">받아둔 오디오 파일과 조회 기록을 전부 지웁니다. 전용 채널·DJ 역할·SponsorBlock 설정은 남습니다.</p>

          <BaseButton variant="danger" @click="confirmReset = true" :disabled="resetting">
            {{ resetting ? "초기화 중..." : "캐시 초기화" }}
          </BaseButton>

          <div v-if="resetResult" :class="resultMsg(resetResult.success)" class="flex items-center gap-1.5">
            <Icon :name="resetResult.success ? 'check' : 'error'" :size="16" />
            <span>{{ resetResult.success ? resetSummary : `초기화 실패: ${resetResult.error || ""}` }}</span>
          </div>
        </BaseCard>
      </div>
    </template>

    <!-- Cache reset confirm dialog -->
    <div v-if="confirmReset" class="fixed inset-0 bg-black/65 backdrop-blur-[6px] flex items-center justify-center z-200" @click.self="confirmReset = false">
      <div class="bg-[rgba(12,16,36,0.88)] backdrop-blur-2xl backdrop-saturate-[1.8] border border-white/12 rounded-[20px] p-8 max-w-95 w-[90%] text-center shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <p class="mb-2 text-[0.95rem] text-fg-soft">캐시를 전부 지울까요?</p>
        <p class="mb-5.5 text-[0.82rem] text-muted">
          되돌릴 수 없습니다. 오디오 파일·조회 기록·SponsorBlock 구간 캐시가 사라지고, 다음 재생부터 다시 받습니다.<br />
          서버 설정(전용 채널·DJ 역할·SponsorBlock)은 그대로 남습니다.
        </p>
        <div class="flex gap-2.5 justify-center">
          <BaseButton variant="ghost" :disabled="resetting" @click="confirmReset = false">취소</BaseButton>
          <BaseButton variant="danger" :disabled="resetting" @click="resetCache">
            {{ resetting ? "지우는 중..." : "전부 지우기" }}
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Leave confirm dialog -->
    <div v-if="leaveTarget" class="fixed inset-0 bg-black/65 backdrop-blur-[6px] flex items-center justify-center z-200" @click.self="leaveTarget = null">
      <div class="bg-[rgba(12,16,36,0.88)] backdrop-blur-2xl backdrop-saturate-[1.8] border border-white/12 rounded-[20px] p-8 max-w-95 w-[90%] text-center shadow-[0_20px_60px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.08)]">
        <p class="mb-2 text-[0.95rem] text-fg-soft">
          <strong class="text-fg">{{ leaveTarget.name }}</strong> 서버에서 나갈까요?
        </p>
        <p class="mb-5.5 text-[0.82rem] text-muted">
          되돌릴 수 없으며, 다시 사용하려면 재초대해야 합니다.<span v-if="leaveTarget.hasPlayer"><br /><Icon name="music" :size="13" class="inline" /> 이 서버는 현재 재생 중이며, 재생이 중단됩니다.</span>
        </p>
        <div class="flex gap-2.5 justify-center">
          <BaseButton variant="ghost" :disabled="leaving" @click="leaveTarget = null">취소</BaseButton>
          <BaseButton variant="danger" :disabled="leaving" @click="leaveGuild">
            {{ leaving ? "나가는 중..." : "나가기" }}
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from "vue";
import axios from "axios";
import BaseCard from "../components/BaseCard.vue";
import BaseButton from "../components/BaseButton.vue";
import Icon from "../components/BaseIcon.vue";
import { useUserStore, VIEW_AS_TIERS } from "../stores/user.js";

// ── 탭 ────────────────────────────────────────────────────────────────────────
// 선택은 새로고침을 넘겨 유지한다 — 권한 수준을 바꾸면 페이지가 다시 로드되는데 그때마다
// 첫 탭으로 튕기면 쓰기 나쁘다.
const TABS = [
  { id: "status", label: "봇 상태", icon: "robot" },
  { id: "logs", label: "실시간 로그", icon: "list" },
  { id: "guilds", label: "서버 관리", icon: "globe" },
  { id: "dev", label: "개발자", icon: "wrench" },
];
const TAB_KEY = "admin:tab";
const savedTab = localStorage.getItem(TAB_KEY);
const tab = ref(TABS.some((t) => t.id === savedTab) ? savedTab : "status");

function setTab(id) {
  tab.value = id;
  localStorage.setItem(TAB_KEY, id);
}

// 스크롤바는 사이드바(ServerSidebar navClass)와 같은 토큰을 쓴다 — 가로라 w 대신 h.
const tabScroller = "mb-4 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-(--sb-thumb-color) [&::-webkit-scrollbar-thumb]:rounded-[3px]";
const tabBtn = "flex items-center gap-1.5 shrink-0 px-3.5 py-2 -mb-px border-b-2 cursor-pointer text-[0.85rem] font-semibold transition-[color,border-color] duration-200";
const tabOn = "text-[#c4b5fd] border-[#c4b5fd]";
const tabOff = "text-muted border-transparent hover:text-fg";

// ── 권한 수준 오버라이드 ──────────────────────────────────────────────────────
// 계층을 바꾸면 스토어가 페이지를 다시 읽는다 — 서버 목록·플레이어 권한이 통째로 달라지기 때문.
const user = useUserStore();
const switchingTier = ref(false);
const tierError = ref("");

const tierRow = "flex items-start gap-2.5 text-left rounded-xl px-3 py-2.5 cursor-pointer border transition-[background-color,border-color] duration-200 disabled:opacity-50 disabled:cursor-not-allowed";
const tierOn = "bg-accent/14 border-accent/45 text-fg";
const tierOff = "bg-white/4 border-white/8 text-fg-soft hover:not-disabled:bg-white/8";

async function pickTier(tier) {
  if (switchingTier.value || user.viewAs === tier) return;
  switchingTier.value = true;
  tierError.value = "";
  try {
    await user.setViewAs(tier); // 성공하면 새로고침되므로 아래로 돌아오지 않는다
  } catch (e) {
    tierError.value = e.response?.data?.error || "권한 수준을 바꾸지 못했습니다";
    switchingTier.value = false;
  }
}

// ── 반복 유틸리티 클래스 ─────────────────────────────────────
const statRow = "flex justify-between items-center py-2.5 border-b border-white/7 text-sm last:border-b-0 last:pb-0 [&>span:first-child]:text-muted [&>strong]:font-semibold [&>span:last-child]:font-semibold";
const cardTitle = "text-[0.7rem] font-bold uppercase tracking-[0.09em] text-[rgba(196,181,253,0.65)] mb-3.5";

// 필터/타입 알약 버튼 — active 여부에 따라 색상군을 통째로 교체(같은 속성 유틸리티 중복 회피)
function typeBtn(active) {
  const base = "px-4 py-1.5 rounded-[20px] border cursor-pointer text-[0.83rem] font-medium transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-spring hover:-translate-y-px";
  return active ? `${base} border-accent/55 text-[#c4b5fd] bg-accent/16 shadow-[0_0_10px_rgba(124,111,246,0.2)]` : `${base} border-white/9 bg-white/5 text-muted hover:bg-white/9 hover:text-fg`;
}

function resultMsg(ok) {
  const base = "mt-3 px-4 py-2.5 rounded-[10px] text-sm border";
  return ok ? `${base} bg-success/10 text-success border-success/22` : `${base} bg-danger/10 text-danger border-danger/22`;
}

const loading = ref(true);
const s = ref({
  bot: { tag: "", guilds: 0, ping: 0, status: 0, uptime: { days: 0, hours: 0, minutes: 0, seconds: 0 } },
  node: { version: "", platform: "", arch: "", memory: { heapUsed: 0, heapTotal: 0, rss: 0 } },
  system: { cpus: 0, totalMem: 0, freeMem: 0, loadAvg: [] },
  activePlayers: 0,
  processes: { total: 0, byLabel: [], oldest: [] },
  youtube: { pot: "off", cookies: "none", configured: false, clients: [] },
});

const potLabels = { on: "사용 중", off: "사용 안 함", missing: "켜져 있으나 설치 없음" };
const cookieLabels = { browser: "브라우저 (연령 제한 전용)", file: "파일 (연령 제한 전용)", none: "없음" };
const potLabel = (v) => potLabels[v] ?? v;
const cookieLabel = (v) => cookieLabels[v] ?? v;

// 경로 상태: 제외된 것 > 실패가 섞인 것 > 아직 안 써 본 것 > 정상
function clientLabel(c) {
  if (c.excluded) return `제외됨 (${c.tried}회 중 ${c.failed}회 실패)`;
  if (!c.tried) return "미사용";
  return c.failed ? `${c.tried}회 중 ${c.failed}회 실패` : `정상 (${c.tried}회)`;
}
function clientClass(c) {
  if (c.excluded) return "text-danger";
  if (c.failed) return "text-warning";
  return c.tried ? "text-success" : "text-muted";
}

const bType = ref("maintenance");
const bMsg = ref("");
const sending = ref(false);
const result = ref(null);

const types = [
  { value: "maintenance", label: "점검" },
  { value: "update", label: "업데이트" },
  { value: "alert", label: "긴급" },
  { value: "info", label: "공지" },
];

// 재생 ffmpeg는 곡 길이를 넘기지 않아야 한다. 그보다 오래 살아 있으면 정리가 안 된 것.
function procAgeClass(ms) {
  if (ms > 30 * 60 * 1000) return "text-danger";
  if (ms > 10 * 60 * 1000) return "text-warning";
  return "text-muted";
}

function fmtAge(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}초`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 ${sec % 60}초`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

function pingClass(p) {
  if (p < 100) return "text-success";
  if (p < 300) return "text-warning";
  return "text-danger";
}

const uptimeStr = computed(() => {
  const u = s.value.bot.uptime;
  const parts = [];
  if (u.days) parts.push(`${u.days}일`);
  if (u.hours) parts.push(`${u.hours}시간`);
  if (u.minutes) parts.push(`${u.minutes}분`);
  parts.push(`${u.seconds}초`);
  return parts.join(" ");
});

async function fetchStatus() {
  try {
    const res = await axios.get("/api/admin/status");
    s.value = res.data;
    syncLevelsWithServer(res.data?.logLevel);
    loading.value = false;
  } catch {
    loading.value = false;
  }
}

async function broadcast() {
  if (!bMsg.value.trim() || sending.value) return;
  sending.value = true;
  result.value = null;
  try {
    const res = await axios.post("/api/admin/broadcast", { message: bMsg.value, type: bType.value });
    result.value = res.data;
    if (res.data.success) bMsg.value = "";
  } catch {
    result.value = { success: false };
  } finally {
    sending.value = false;
  }
}

// ── Guild management ─────────────────────────────────────────
const guilds = ref([]);
const leaveTarget = ref(null); // 확인 모달에 표시 중인 서버 (null이면 닫힘)
const leaving = ref(false);
const leaveResult = ref(null);

async function fetchGuilds() {
  try {
    const res = await axios.get("/api/admin/guilds");
    guilds.value = res.data.guilds;
  } catch {
    // 일시 오류는 무시 — 다음 폴링에서 회복
  }
}

async function leaveGuild() {
  const g = leaveTarget.value;
  if (!g || leaving.value) return;
  leaving.value = true;
  leaveResult.value = null;
  try {
    await axios.post(`/api/admin/guilds/${g.id}/leave`);
    leaveResult.value = { success: true, name: g.name };
    await Promise.all([fetchGuilds(), fetchStatus()]);
  } catch (e) {
    leaveResult.value = { success: false, error: e.response?.data?.error || "요청 실패" };
  } finally {
    leaving.value = false;
    leaveTarget.value = null;
  }
}

// ── 캐시 초기화 ───────────────────────────────────────────────
const confirmReset = ref(false);
const resetting = ref(false);
const resetResult = ref(null);

const resetSummary = computed(() => {
  const r = resetResult.value;
  if (!r) return "";
  const mb = Math.round((r.freedBytes || 0) / 1024 / 1024);
  const kept = r.kept > 0 ? `, ${r.kept}개는 재생 중이라 남음` : "";
  return `파일 ${r.removed}개 삭제 (${mb}MB)${kept}`;
});

async function resetCache() {
  if (resetting.value) return;
  resetting.value = true;
  resetResult.value = null;
  try {
    const res = await axios.post("/api/admin/reset-cache");
    resetResult.value = res.data;
  } catch (e) {
    resetResult.value = { success: false, error: e.response?.data?.error || "요청 실패" };
  } finally {
    resetting.value = false;
    confirmReset.value = false;
  }
}

// ── Command redeploy ─────────────────────────────────────────
const redeploying = ref(false);
const redeployResult = ref(null);

async function redeploy() {
  if (redeploying.value) return;
  redeploying.value = true;
  redeployResult.value = null;
  try {
    const res = await axios.post("/api/admin/redeploy-commands");
    redeployResult.value = res.data;
  } catch (e) {
    redeployResult.value = { success: false, error: e.response?.data?.error || "요청 실패" };
  } finally {
    redeploying.value = false;
  }
}

// ── Log viewer ──────────────────────────────────────────────
const logs = ref([]);
const catFilter = ref(null);
const tagFilter = ref(null);
const autoScroll = ref(true);
const sseConnected = ref(false);
const logPane = ref(null);
let sse = null;

// 레벨 필터는 **다중 토글**이다 — "이 중 하나만 보기"가 아니라 "보려는 건 켜고 안 보려는 건 끈다".
// 선택은 저장하지 않는다(새로고침하면 초기 상태로 돌아간다).
const LEVEL_ORDER = { trace: 10, log: 20, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 };
const logLevels = [
  { value: "debug", label: "DEBUG" },
  { value: "info", label: "INFO" },
  { value: "warn", label: "WARN" },
  { value: "error", label: "ERROR" },
  { value: "fatal", label: "FATAL" },
];

// 초기 상태는 서버의 LOG_LEVEL을 따른다. 서버가 debug를 아예 안 보내고 있으면 그 알약이
// 켜져 있어도 보여줄 것이 없으므로, 꺼진 채로 시작해 "지금 흐르고 있는 것"과 맞춘다.
// 꺼진 알약도 눌러서 켤 수 있다 — 서버 레벨을 낮추면 그때부터 오는 것이 보인다.
const levelsOn = ref(new Set(["info", "warn", "error", "fatal"]));
let levelsInitialized = false;
function syncLevelsWithServer(serverLevel) {
  if (levelsInitialized || !serverLevel) return;
  levelsInitialized = true;
  const min = LEVEL_ORDER[serverLevel] ?? 30;
  levelsOn.value = new Set(logLevels.filter((l) => LEVEL_ORDER[l.value] >= min).map((l) => l.value));
}
function toggleLevel(v) {
  const next = new Set(levelsOn.value); // Set은 제자리 변경으로 반응하지 않는다
  if (next.has(v)) next.delete(v);
  else next.add(v);
  levelsOn.value = next;
}
// 와이어의 "log"·"trace"는 DEBUG 알약이 담당한다(같은 심각도 칸).
const levelBucket = (lv) => (LEVEL_ORDER[lv] <= 20 ? "debug" : lv);

function lvColor(level) {
  return (
    {
      trace: "text-[#6b7280]",
      log: "text-[#9ca3af]",
      debug: "text-[#9ca3af]",
      info: "text-[#60a5fa]",
      warn: "text-[#fbbf24]",
      error: "text-[#f87171]",
      fatal: "text-[#fca5a5]",
    }[level] || "text-[#9ca3af]"
  );
}
function txtColor(level) {
  return { debug: "text-[#9ca3af]", warn: "text-[#fef3c7]", error: "text-[#fecaca]", fatal: "text-[#fecaca] font-bold" }[level] || "text-[#d1d5db]";
}

// 카테고리: 지금까지 흘러온 로그에서 실제로 본 것만 필터 알약으로 노출(고정 목록 아님)
const logCategories = computed(() => [...new Set(logs.value.map((e) => e.category).filter(Boolean))].sort());
const CAT_PALETTE = ["#f472b6", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#22d3ee", "#fb923c", "#4ade80", "#e879f9", "#38bdf8"];
function catColor(cat) {
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0;
  return CAT_PALETTE[h % CAT_PALETTE.length];
}

// 태그: 카테고리와 같은 방식으로, 흘러온 로그에서 실제로 본 것만 노출한다(고정 목록 아님)
const logTags = computed(() => [...new Set(logs.value.flatMap((e) => e.tags || []))].sort());

const filteredLogs = computed(() => logs.value.filter((e) => levelsOn.value.has(levelBucket(e.level)) && (!catFilter.value || e.category === catFilter.value) && (!tagFilter.value || (e.tags || []).includes(tagFilter.value))));

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function onLogScroll() {
  if (!logPane.value) return;
  const { scrollTop, scrollHeight, clientHeight } = logPane.value;
  autoScroll.value = scrollHeight - scrollTop - clientHeight < 50;
}

function scrollLogsToEnd() {
  nextTick(() => {
    if (logPane.value) logPane.value.scrollTop = logPane.value.scrollHeight;
  });
}

watch(
  () => logs.value.length,
  () => {
    if (autoScroll.value) scrollLogsToEnd();
  },
);

// 다른 탭에 있는 동안 로그 뷰어는 display:none이라 scrollTop 지정이 먹지 않는다(scrollHeight가 0).
// 그동안 쌓인 만큼은 돌아왔을 때 다시 맞춰준다.
watch(tab, (t) => {
  if (t === "logs" && autoScroll.value) scrollLogsToEnd();
  poll(); // 새 탭이 최대 한 주기 동안 옛 값을 보여주지 않도록
});

function connectSSE() {
  sse = new EventSource("/api/admin/logs/stream", { withCredentials: true });
  sse.onopen = () => {
    sseConnected.value = true;
  };
  sse.onmessage = (e) => {
    const entry = JSON.parse(e.data);
    logs.value.push(entry);
    if (logs.value.length > 500) logs.value.splice(0, logs.value.length - 500);
  };
  sse.onerror = () => {
    sseConnected.value = false;
  };
}

// ── Lifecycle ────────────────────────────────────────────────
// status는 실시간 값(uptime·메모리·자식 프로세스)이라 대응 SSE가 없어 폴링이 유일한 갱신 수단.
// 디스코드 rate limit과 무관하고(우리 Express만 친다) 보는 사람이 운영자 한 명이라 주기를
// 좁혀도 부담이 없다 — 자식 프로세스가 뜨고 지는 걸 보려면 10초는 너무 성기다.
//
// 대신 낭비를 두 곳에서 막는다: 탭이 숨으면(아무도 안 보면) 멈추고, 보이는 탭이 쓰지 않는
// 데이터는 아예 받지 않는다. 로그 탭은 SSE가 밀어주므로 폴링할 것이 없다.
const POLL_MS = 3000;
let timer = null;
let visHandler = null;
function poll() {
  if (tab.value === "status") fetchStatus();
  else if (tab.value === "guilds") fetchGuilds();
}
function startPoll() {
  if (!timer) timer = setInterval(poll, POLL_MS);
}
function stopPoll() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
onMounted(() => {
  // 첫 진입만은 탭과 무관하게 둘 다 받는다 — 화면 전체의 loading 해제가 fetchStatus에 달려 있다.
  fetchStatus();
  fetchGuilds();
  visHandler = () => {
    if (document.hidden) stopPoll();
    else {
      poll();
      startPoll();
    }
  };
  document.addEventListener("visibilitychange", visHandler);
  if (!document.hidden) startPoll();
  connectSSE(); // 로그 스트림은 백그라운드에서도 유지 — 폴링이 아니라 이벤트 발생 시에만 전송
});
onUnmounted(() => {
  if (visHandler) {
    document.removeEventListener("visibilitychange", visHandler);
    visHandler = null;
  }
  stopPoll();
  if (sse) sse.close();
});
</script>

<template>
  <!-- 봇 상태 탭. 괜찮은가(요약) → 무엇에 기대는가(연결, 높이가 거의 고정이라 위에) → 지금 어떤가(흐름) → 무엇을 하는가(플레이어 · 프로세스, 흐름과 자주 같이 보고 서버 수만큼 길어져 아래에) → 어디에 쌓이는가(저장공간). 잘 안 바뀌는 환경 · 버전은 봇 정보 탭(BotInfo).
       상태는 색 + 모양(✓ 동그라미 · ! 세모 · ✕ 동그라미) + 낱말로 알린다. 화면 글은 짧게, 까닭은 점선 밑줄 글에 올리면 뜨는 툴팁으로 -->
  <!-- 저장공간 카드는 폭에 따라 두 자리 중 하나에 놓인다. 한 번 정의해 두고 부른다(VueUse createReusableTemplate) -->
  <DefineStorage>
    <BaseCard icon="hard_drive" title="저장공간" data-at="저장공간">
      <!-- 카드 높이를 늘리지 않게 머리 오른쪽에. 작은 색조 버튼(높이 32, 머리 줄 40 안) -->
      <template #actions
        ><BaseButton variant="secondary" size="sm" class="gap-0!" @click="emit('openDb')">DB 브라우저<Icon name="chevron_right" :size="18" class="-mr-1.5" /></BaseButton
      ></template>
      <div class="flex flex-col gap-3">
        <!-- 막대는 늘 쓴 만큼. 캐시는 한도까지 채우고 오래 안 들은 곡부터 지우므로 차 있는 것이 정상(경고하지 않는다).
             차례는 오디오 캐시 · 캐시 파일 수 · 구분선 · 드라이브(오디오 캐시 · 기타 · 여유 공간 · 최소 여유로 나눈다) -->
        <!-- 드라이브 막대 위에 구분선 -->
        <div v-for="bar in storageBars" :key="bar.key" :class="bar.key === 'drive' && 'pt-3 border-t border-outline-variant/40'">
          <div class="flex items-baseline gap-2 text-sm">
            <span>{{ bar.label }}</span>
            <span class="ml-auto text-xs nums" :class="LEVEL_TEXT[bar.level]">{{ bar.text }}</span>
          </div>
          <!-- 나눈 막대: 오디오 캐시 · 기타 · 여유 공간 · 최소 여유(CACHE_MIN_FREE_DISK_MB, 반투명 빨강, 맨 뒤). 조각 사이 2 를 띄우고, 아래에 같은 색 점으로 이름 · 크기 -->
          <template v-if="bar.key === 'drive'">
            <div class="flex gap-0.5 h-2 mt-1">
              <div v-for="part in driveParts" :key="part.label" class="h-full rounded-full" :class="part.tone" :style="{ flexGrow: toGB(part.bytes), flexBasis: '0%', minWidth: '0.25rem' }" v-tooltip="part.tip"></div>
            </div>
            <div class="flex flex-wrap gap-x-3 gap-y-0.5 mt-2 text-xs text-on-surface-variant">
              <span v-for="part in driveParts" :key="part.label" class="flex items-center gap-1"
                ><span class="size-2 rounded-full" :class="part.tone"></span>{{ part.label }} <span class="nums text-on-surface">{{ part.text }}</span></span
              >
            </div>
          </template>
          <div v-else class="h-2 mt-1 rounded-full bg-(--store-free) overflow-hidden">
            <div class="h-full rounded-full" :class="bar.level === 'ok' ? 'bg-(--store-cache)' : LEVEL_BAR[bar.level]" :style="{ width: `${Math.max(2, bar.ratio * 100)}%` }"></div>
          </div>
          <!-- 캐시 수: 오디오 캐시 · 캐시 파일 수 아래, 드라이브 구분선 위에 -->
          <!-- 이름 · 수 줄은 카드 아래 DB 표와 같은 모양. 표는 줄마다 따로 폭을 잡는다(긴 값 하나가 모든 줄의 이름 칸을 좁혀 이름이 접히지 않게, 이름은 접지 않고 값이 넘치면 자른다) -->
          <div v-if="bar.key === 'files'" class="mt-3">
            <dl class="flex flex-col gap-1 text-sm">
              <div v-for="[k, v] in cacheCounts" :key="k" class="flex items-baseline justify-between gap-3">
                <dt class="shrink-0 text-on-surface-variant">{{ k }}</dt>
                <dd class="min-w-0 nums text-right">{{ v }}</dd>
              </div>
            </dl>
          </div>
        </div>
        <dl class="flex flex-col gap-1 text-sm pt-3 border-t border-outline-variant/40">
          <div v-for="[k, v] in dbRows" :key="k" class="flex items-baseline justify-between gap-3">
            <dt class="shrink-0 text-on-surface-variant">{{ k }}</dt>
            <dd class="min-w-0 nums text-right">{{ v }}</dd>
          </div>
        </dl>
      </div>
    </BaseCard>
  </DefineStorage>
  <div ref="root" class="flex flex-col gap-(--gap-in)">
    <!-- ① 요약 -->
    <section class="pane rounded-(--r-window) p-(--pad-window) flex flex-col gap-3">
      <div class="flex items-center gap-4">
        <span class="size-12 shrink-0 rounded-[30%] flex items-center justify-center" :class="LEVEL_BADGE[overallLevel]"><Icon :name="LEVEL_ICON[overallLevel]" :size="24" fill /></span>
        <div class="min-w-0 flex-1">
          <div class="font-round text-xl font-semibold">{{ overallLevel === "ok" ? "모두 정상" : `주목이 필요한 ${attention.length}개의 상태가 있어요.` }}</div>
          <div class="text-sm text-on-surface-variant truncate">{{ status.bot.tag }} · <template v-if="status.bot.status !== 0">연결 중 · </template>{{ formatSpan(status.bot.uptime) }}째 작동 중 · 서버 {{ status.bot.guilds }}개</div>
        </div>
        <span class="shrink-0 flex items-center gap-1 text-xs text-on-surface-variant" v-tooltip="stale ? '상태를 받지 못하고 있다.\n아래 값은 이 시각에 받은 것' : '3초마다 갱신'"
          ><span class="size-2 rounded-full" :class="stale ? 'bg-outline' : 'bg-(--ok-ink)'"></span>{{ stale ? "끊김" : "마지막 갱신" }} <span class="nums text-on-surface">{{ updatedAt ? clock(updatedAt, true) : "" }}</span></span
        >
      </div>
      <!-- 살펴볼 것: 누르면 그 칸으로 가서 잠깐 테두리가 빛난다 -->
      <div v-if="attention.length" class="flex flex-wrap gap-2">
        <button v-for="a in attention" :key="a.name" type="button" class="tap state-layer h-8 px-2 rounded-sm flex items-center gap-2 text-xs font-medium cursor-pointer" :class="LEVEL_CHIP[a.level]" @click="jumpTo(a.at)"><Icon :name="LEVEL_ICON[a.level]" :size="18" fill />{{ a.name }} · {{ a.word }}</button>
      </div>
      <div class="rounded-(--r-inner) bg-surface-container-high px-4 py-3">
        <div class="flex items-center gap-3 text-xs text-on-surface-variant" :class="status.recent.lines.length ? 'mb-2' : ''">
          <span>지난 1시간 요약</span>
          <span :class="status.recent.error ? LEVEL_TEXT.bad : ''">오류 {{ status.recent.error }}</span>
          <span :class="status.recent.warn ? LEVEL_TEXT.warn : ''">경고 {{ status.recent.warn }}</span>
          <button type="button" class="ml-auto text-primary font-semibold cursor-pointer hover:underline" @click="emit('openLogs')">실시간 로그 열기</button>
        </div>
        <ul class="flex flex-col gap-1 text-sm">
          <li v-for="r in status.recent.lines" :key="r.ts + r.text" class="flex items-center gap-2 min-w-0">
            <span class="text-xs nums text-on-surface-variant">{{ clock(r.ts) }}</span>
            <Icon :name="LEVEL_ICON[r.level === 'error' ? 'bad' : 'warn']" :size="16" fill :class="r.level === 'error' ? LEVEL_TEXT.bad : LEVEL_TEXT.warn" />
            <span class="min-w-0 truncate">{{ r.text }}</span>
            <span v-if="r.count > 1" class="shrink-0 h-4 px-1 rounded-full bg-surface-container-highest text-2xs leading-4 nums text-on-surface-variant" v-tooltip="`지난 1시간 ${r.count}번 · 마지막 ${clock(r.ts)}`">×{{ r.count }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- ② 연결: 봇이 실제로 부른 결과(따로 찔러 보지 않는다). 최근에 안 쓴 곳은 "대기 중", 쓰는 설정이 없는 곳은 "비활성" -->
    <!-- 내용 칸이 넓으면(STORAGE_BESIDE_REM 이상) 연결 카드 옆에 저장공간 카드를 붙인다(높이는 연결 카드에 맞춘다). 좁으면 저장공간은 아래쪽 왼쪽 단에.
         붙은 뒤로 더 넓어지면 둘이 문턱에서의 폭 비율대로 같이 늘어난다(flex 늘림 = 기준 폭) -->
    <div class="flex gap-(--gap-in) items-stretch">
      <BaseCard icon="hub" title="연결" data-at="연결" class="flex-1 min-w-0" :style="storageBeside ? flexFromBase(LINK_CARD_REM) : undefined">
        <!-- 왼쪽 열에 재생 · 유튜브(소리를 내는 데 쓰는 것), 오른쪽 열에 자동재생 -->
        <div class="grid grid-cols-1 @3xl/card:grid-cols-2 gap-x-10 gap-y-4">
          <div v-for="(col, ci) in linkColumns" :key="ci" class="flex flex-col gap-4">
            <div v-for="group in col" :key="group.title">
              <!-- 칸: 이름 · 무엇(설명 · 모델 · 방식) · 마지막 성공 · 응답(실패면 오류). 쓰지 않는 곳도 같은 칸(설명에 그 사실, 숫자 칸은 -).
                   좁은 카드(448 미만, 휴대폰)는 설명 칸이 남지 않아 줄마다 두 줄: 위에 이름 · 마지막 성공 · 응답, 아래에 설명(이름 글자 자리부터). 머리 · 줄이 저마다 같은 세 칸 격자 -->
              <div :class="LINK_GRID" class="items-center text-sm">
                <span class="contents text-xs text-on-surface-variant" :class="LINK_NARROW"
                  ><span class="@md/card:col-span-2 pb-1">{{ group.title }}</span
                  ><span class="pb-1 text-right">마지막 성공</span><span class="pb-1 text-right">응답</span></span
                >
                <div v-for="line in group.items" :key="line.name" :class="LINK_NARROW">
                  <span class="flex items-center gap-2 h-8 min-w-0"
                    ><Icon :name="LINK_ICON[line.state]" :size="20" :fill="LINK_ICON_FILLED[line.state]" :class="LINK_TEXT[line.state]" /><span class="truncate" :class="[line.state === 'off' && 'text-on-surface-variant', line.hint && 'underline decoration-dotted underline-offset-2 cursor-help']" v-tooltip="line.hint">{{ line.name }}</span></span
                  >
                  <!-- 설명이 칸보다 길면 잘라 두지 않고 좌우로 흘려 보이고, 그때만 툴팁으로 전체를 -->
                  <MarqueeText class="min-w-0 text-xs text-on-surface-variant order-last col-span-full pl-7 -mt-1.5 pb-1 @md/card:order-none @md/card:col-auto @md/card:p-0 @md/card:mt-0" :class="!line.detail && '@max-md/card:hidden'" :text="line.detail" tip />
                  <span class="text-xs nums text-right text-on-surface-variant whitespace-nowrap" :class="line.whenFull && 'underline decoration-dotted underline-offset-2 cursor-help'" v-tooltip="line.whenFull">{{ line.when || "-" }}</span>
                  <span class="text-xs nums text-right whitespace-nowrap" :class="LINK_TEXT[line.state]">{{ line.value || "-" }}</span>
                </div>
              </div>
              <!-- 유튜브 클라이언트(설정한 차례대로 시도): 유튜브의 하위라 테두리 상자로 묶는다. 제목 · 칸 머리는 윗선 위에 걸치고(윗선을 조각으로 그어 반투명 바탕에서도 글자 밑으로 선이 지나지 않게),
                   이름 칸은 바깥 이름 칸에서 상자 여백 · 테두리만큼 줄여 막대가 바깥 설명 칸과 같은 자리에서 시작한다 -->
              <div v-if="group.youtube" class="mt-3">
                <div class="flex items-center h-5 text-xs text-on-surface-variant"><span :class="[CLIENT_BOX_EDGE, 'w-3 border-l rounded-tl-sm']"></span><span class="px-1">클라이언트 (설정순)</span><span :class="[CLIENT_BOX_EDGE, 'flex-1']"></span><span class="px-1">성공/시도</span><span :class="[CLIENT_BOX_EDGE, 'w-3 border-r rounded-tr-sm']"></span></div>
                <div class="grid grid-cols-[calc(8.5rem-1rem-1px)_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-x border-b border-outline-variant/60 rounded-b-sm px-4 pt-1 pb-3">
                  <template v-for="client in youtubeClients" :key="client.name">
                    <span class="font-mono text-xs">{{ client.name }}</span>
                    <span class="h-2 rounded-full bg-surface-container-highest overflow-hidden"><span class="block h-full rounded-full" :class="LEVEL_BAR[client.level]" :style="{ width: `${Math.max(3, client.rate * 100)}%` }"></span></span>
                    <span class="flex items-center justify-end gap-1 text-xs nums" :class="LEVEL_TEXT[client.level] || 'text-on-surface-variant'"><Icon v-if="client.level !== 'ok'" :name="LEVEL_ICON[client.level]" :size="14" fill />{{ client.value }}</span>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 pt-3 border-t border-outline-variant/40 text-xs text-on-surface-variant">
          <span v-for="(word, state) in LINK_WORD" :key="state" class="flex items-center gap-1"><Icon :name="LINK_ICON[state]" :size="14" :fill="LINK_ICON_FILLED[state]" :class="LINK_TEXT[state]" />{{ word }}</span>
        </div>
      </BaseCard>
      <ReuseStorage v-if="storageBeside" class="min-w-0" :style="flexFromBase(STORAGE_CARD_REM)" />
    </div>

    <!-- ③ 지금: 값 + 최근 15분 흐름 -->
    <div class="grid grid-cols-2 @3xl/content:grid-cols-3 @6xl/content:grid-cols-6 gap-(--gap-in)">
      <section v-for="m in metrics" :key="m.title" :data-at="m.title" class="pane rounded-(--r-window) px-4 py-3 flex flex-col gap-1">
        <div class="flex items-center gap-1 text-xs text-on-surface-variant">
          <span class="truncate" :class="m.why && 'underline decoration-dotted underline-offset-2 cursor-help'" v-tooltip="m.why || null">{{ m.title }}</span>
          <span v-if="m.level !== 'ok'" class="ml-auto shrink-0 flex items-center gap-1 font-semibold" :class="LEVEL_TEXT[m.level]"><Icon :name="LEVEL_ICON[m.level]" :size="14" fill />{{ m.word }}</span>
        </div>
        <div class="flex items-baseline-last gap-0.5" :class="LEVEL_TEXT[m.level]">
          <span class="font-round text-3xl font-semibold tracking-tighter nums">{{ m.value }}</span
          ><span class="text-xs" :class="m.level === 'ok' && 'text-on-surface-variant'">{{ m.unit }}</span>
          <!-- 보조 글. subTop 이 있으면 그 위에 한 줄 더. 줄은 마지막 글줄의 바닥선(last baseline)으로 맞춰, 큰 숫자 · 단위 · 보조 글 아래 줄이 같은 선에 선다 -->
          <span class="ml-auto min-w-0 flex flex-col items-end text-xs text-on-surface-variant nums"
            ><span v-if="m.subTop" class="truncate">{{ m.subTop }}</span
            ><span class="flex items-center gap-1 truncate"><span v-if="m.second" class="w-3 h-0.5 rounded-full bg-current opacity-50"></span>{{ m.sub }}</span></span
          >
        </div>
        <SparkChart :values="m.series" :second="m.second" :max="m.max" :warn="m.warn" :unit="m.chartUnit" :minutes="historyMinutes" :now="new Date(status.history.endAt)" :tone="LEVEL_GRAPH[m.level]" />
      </section>
    </div>

    <!-- ④ 하는 일 · ⑤ 쌓이는 곳: 두 단 격자. 첫 행에 활성 플레이어 · 자식 프로세스(같은 행이라 높이가 같다), 둘째 행 왼쪽에 저장공간(넓을 때는 연결 카드 옆으로 간다).
         한 단이 되면 DOM 차례 그대로 1 2 3 -->
    <div class="grid grid-cols-1 @4xl/content:grid-cols-2 gap-(--gap-in)">
      <BaseCard ref="playerCardEl" icon="graphic_eq" :title="`연결된 서버 · 활성 플레이어 (${status.players.voiceConnections})`">
        <!-- 상태 거르기: M3 필터 칩(여럿 켜기). 오른쪽 끝에 찾기. 연결된 서버 수는 카드 제목에, 청취자 · 대기열 합계는 카드 맨 아래(자식 프로세스 합계와 같은 모양) -->
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <button v-for="f in playerFilters" :key="f.key" type="button" :aria-pressed="f.on" :class="[FILTER_CHIP, f.on ? FILTER_CHIP_ON : FILTER_CHIP_OFF]" @click="f.toggle()">
            {{ f.label }}<span class="nums font-semibold">{{ f.count }}</span>
          </button>
          <input :value="playerTerm" placeholder="검색" :class="SEARCH_FIELD" class="ml-auto flex-1 min-w-28 max-w-48" @input="playerTerm = valueOf($event)" />
        </div>
        <!-- 목록 칸은 서버 10.5줄(한 단일 때는 6.5줄) 높이로 고정(마지막 줄이 반쯤 걸려 구른다는 것이 보인다). 넘치면 칸 오른쪽을 카드 끝까지 넓혀 스크롤바가 가장자리에서 3 떨어지게 -->
        <div ref="playerListEl" class="h-78 @4xl/content:h-126 overflow-y-auto -ml-2" :class="playerListOverflowing ? '-mr-4' : '-mr-2'" :style="playerFade">
          <ul v-if="shownPlayers.length" class="flex flex-col">
            <li v-for="player in shownPlayers" :key="player.guildId">
              <!-- 참가한 서버만 그 서버 화면으로 잇는다(참가하지 않은 서버는 운영자도 열지 않는다) -->
              <component :is="player.member ? RouterLink : 'div'" :to="player.member ? `/servers/${player.guildId}` : undefined" class="flex items-center gap-3 h-12 px-2 rounded-(--r-row) no-underline text-on-surface" :class="player.member && 'state-layer'" v-tooltip="player.member ? null : NOT_MEMBER_TIP">
                <GuildAvatar :guild="{ name: player.name, icon: player.icon, hasPlayer: true }" :status="false" size-class="size-8" class="shrink-0" />
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-semibold truncate">{{ player.name }}</div>
                  <div class="text-xs text-on-surface-variant truncate">
                    <template v-if="player.title"
                      >{{ player.title }}<template v-if="player.artist"> · {{ player.artist }}</template></template
                    >
                    <template v-else>곡 없음</template>
                  </div>
                </div>
                <div class="shrink-0 text-right text-xs nums whitespace-nowrap">
                  <div class="flex items-center justify-end gap-1 text-on-surface-variant"><Icon name="headphones" :size="14" />{{ player.listeners }}명 · 대기열 {{ player.queued.toLocaleString("ko-KR") }}곡</div>
                  <div :class="player.state !== 'playing' && 'text-on-surface-variant'">{{ player.state === "playing" ? `${formatDuration(player.position)} / ${formatDuration(player.duration)}` : PLAYER_STATE_WORD[player.state] }}</div>
                </div>
              </component>
            </li>
          </ul>
          <div v-else class="px-2 py-3 text-sm text-on-surface-variant">{{ shownPlayerStates.size ? "해당하는 서버가 없어요" : "고른 상태가 없어요" }}</div>
        </div>
        <div class="mt-3 flex items-baseline gap-3 pt-3 border-t border-outline-variant/40 text-xs text-on-surface-variant">
          <span>합계</span>
          <span class="ml-auto shrink-0 nums">청취자 {{ listenerTotal.toLocaleString("ko-KR") }}명 · 대기열 {{ status.players.queued.toLocaleString("ko-KR") }}곡</span>
        </div>
      </BaseCard>
      <!-- 넓을 때(두 단)는 옆 카드(활성 플레이어)의 높이를 따르고 제 높이로 행을 늘리지 않는다(h-0 · min-h-full). 넘치는 줄은 목록 칸 안에서 구른다.
           한 단일 때는 카드 높이를 활성 플레이어 카드와 같게(잰 높이 --player-card-h). 칸 머리는 구르지 않게 따로 두고, 줄과 같은 고정 열 폭으로 맞춘다 -->
      <BaseCard icon="terminal" title="자식 프로세스" data-at="자식 프로세스" class="flex flex-col h-(--player-card-h) @4xl/content:h-0 @4xl/content:min-h-full" :style="{ '--player-card-h': `${playerCardHeight}px` }">
        <template v-if="status.processes.oldest.length">
          <!-- 칸 머리를 누르면 그 칸으로 줄을 세운다(다시 누르면 거꾸로). 세운 칸은 글자를 진하게 하고 화살표를 붙인다(오른쪽 맞춤 칸은 화살표가 앞) -->
          <!-- 좁은 카드(448 미만)는 PID · 작동 시간 칸을 머리에서 빼고 줄 아래에 작게 둔다(하는 일 칸이 남지 않았다) -->
          <div :class="PROCESS_GRID" class="pb-1 text-xs text-on-surface-variant">
            <button v-for="c in PROCESS_COLUMNS" :key="c.key" type="button" class="flex items-center gap-1 min-w-0 cursor-pointer hover:text-on-surface" :class="[c.right && 'justify-end', processSort.key === c.key && 'text-on-surface font-semibold', (c.key === 'pid' || c.key === 'age') && '@max-md/card:hidden']" :aria-label="`${c.label}로 정렬`" @click="sortProcessesBy(c.key)">
              <Icon v-if="c.right && processSort.key === c.key" :name="processSort.desc ? 'arrow_downward' : 'arrow_upward'" :size="14" /><span class="truncate">{{ c.label }}</span
              ><Icon v-if="!c.right && processSort.key === c.key" :name="processSort.desc ? 'arrow_downward' : 'arrow_upward'" :size="14" />
            </button>
          </div>
          <!-- 넘치면 칸 오른쪽을 카드 끝까지 넓혀 스크롤바가 가장자리에서 3 떨어지게(플레이어 목록과 같다). 늘린 만큼 안쪽 여백으로 줄을 칸 머리 열에 맞춘다 -->
          <div ref="processListEl" class="flex-1 min-h-0 overflow-y-auto mb-3" :class="processListOverflowing && '-mr-4 pr-1.5'" :style="processFade">
            <div v-for="p in sortedProcesses" :key="p.pid" :class="PROCESS_GRID" class="py-1.5 @md/card:h-8 @md/card:py-0 text-sm">
              <span class="hidden @md/card:block font-mono text-xs nums">{{ p.pid }}</span>
              <span class="font-mono text-xs" :class="p.label === 'yt-dlp' && 'text-tertiary'">{{ p.label }}</span>
              <!-- 길면 흐르고 툴팁으로 전체를(잔류 프로세스는 까닭 툴팁) -->
              <span class="min-w-0 flex items-center gap-1" :class="p.stray && LEVEL_TEXT.warn" v-tooltip="p.stray ? ORPHAN_TIP : null"><Icon v-if="p.stray" :name="LEVEL_ICON.warn" :size="14" fill class="shrink-0" /><MarqueeText class="min-w-0 flex-1" :text="processJob(p)" :tip="!p.stray" /></span>
              <span class="hidden @md/card:block text-xs nums text-right" :class="p.stray && LEVEL_TEXT.warn">{{ formatDuration(p.ageMs / 1000) }}</span>
              <!-- 메모리는 서버가 15초마다 잰다. 막 뜬 프로세스는 아직 없다 -->
              <span class="text-xs nums text-right">{{ p.memMb === null ? "—" : `${p.memMb} MB` }}</span>
              <!-- 좁은 카드: PID · 작동 시간을 아래 줄에 -->
              <span class="@md/card:hidden col-span-full -mt-0.5 font-mono text-xs nums text-on-surface-variant" :class="p.stray && LEVEL_TEXT.warn">PID {{ p.pid }} · {{ formatDuration(p.ageMs / 1000) }}</span>
            </div>
          </div>
        </template>
        <div v-else class="py-3 text-sm text-on-surface-variant">작동 중인 자식 프로세스가 없어요</div>
        <!-- 합계는 카드 맨 아래에 붙인다(옆 카드에 맞춰 늘어난 높이의 바닥). 구분선은 한 줄로 -->
        <div v-if="status.processes.oldest.length" class="mt-auto flex items-baseline gap-3 pt-3 border-t border-outline-variant/40 text-xs text-on-surface-variant">
          <span class="min-w-0 truncate">합계 {{ status.processes.total }}개 ({{ status.processes.byLabel.map((b) => `${b.label} ${b.count}`).join(" · ") }})</span>
          <span class="ml-auto shrink-0 nums">{{ processMemMb }} MB</span>
        </div>
      </BaseCard>
      <ReuseStorage v-if="!storageBeside" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { createReusableTemplate, useElementSize } from "@vueuse/core";
import { RouterLink } from "vue-router";
import BaseButton from "./BaseButton.vue";
import BaseCard from "./BaseCard.vue";
import Icon from "./BaseIcon.vue";
import GuildAvatar from "./GuildAvatar.vue";
import MarqueeText from "./MarqueeText.vue";
import SparkChart from "./SparkChart.vue";
import { rem } from "../utils/rem.ts";
import { useOverflowing } from "../composables/overflowing.ts";
import { useScrollFade } from "../composables/scroll-fade.ts";
import { FILTER_CHIP, FILTER_CHIP_OFF, FILTER_CHIP_ON } from "../utils/filter-chip.ts";
import { SEARCH_FIELD } from "../utils/field.ts";
import { koMatch } from "../utils/ko-search.ts";
import { valueOf } from "../utils/dom.ts";
import { formatBytes, formatDuration, formatSpan } from "../../../src/ui/format.ts";
import type { AdminStatus, LinkRow, LinkState, ProcessRow } from "../../../src/dashboard/contract/admin.ts";

const props = defineProps<{ status: AdminStatus; updatedAt: number | null; stale: boolean }>();
const emit = defineEmits<{ openLogs: []; openDb: [] }>();

// ── 판정 · 모양 ──
type Level = "ok" | "warn" | "bad";
const levelOf = (v: number, warn: number, bad: number): Level => (v >= bad ? "bad" : v >= warn ? "warn" : "ok");
const LEVEL_ICON: Record<Level, string> = { ok: "check_circle", warn: "warning", bad: "cancel" };
const LEVEL_TEXT: Record<Level, string> = { ok: "", warn: "text-(--warn-ink)", bad: "text-error" };
const LEVEL_GRAPH: Record<Level, string> = { ok: "text-primary", warn: "text-(--warn-ink)", bad: "text-error" };
const LEVEL_BAR: Record<Level, string> = { ok: "bg-primary", warn: "bg-(--warn-ink)", bad: "bg-error" };
// 주의는 어디서나 노랑 계열(--warn-ink: 밝기마다 바탕 대비 4.5:1 이상인 노랑). M3 에 경고 색 역할이 없어 칩 바탕은 그 색을 옅게 섞는다
const WARN_FILL = "bg-(--warn-ink)/15 text-(--warn-ink)";
const LEVEL_BADGE: Record<Level, string> = { ok: "bg-primary-container text-on-primary-container", warn: WARN_FILL, bad: "bg-error-container text-on-error-container" };
const LEVEL_CHIP: Record<Level, string> = { ok: "", warn: WARN_FILL, bad: "bg-error-container text-on-error-container" };

/** 기준(주의 · 문제). 핑 ms, 루프 지연 ms, heap · CPU · 디스크 % */
const LIMITS = { ping: [150, 300], loop: [50, 100], heap: [80, 95], cpu: [70, 90], disk: [90, 98] } as const;

// ── 글 ──
const clock = (ms: number, seconds = false) => new Date(ms).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false });
// 응답 시간(ms). 1초 넘으면 초로
const latencyText = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`);
const toGB = (bytes: number) => bytes / 1024 ** 3;
// GB 표기: 100 GB 이상은 정수, 아래는 소수 한 자리(소수가 0 이면 뗀다: 10.0 → 10)
// 1 GB 아래는 MB 로 같은 규칙(DB 처럼 작은 것)
const sizeText = (bytes: number) => {
  if (bytes >= 1024 ** 3) return gbText(bytes);
  const mb = bytes / 1024 ** 2;
  return `${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1).replace(/\.0$/, "")} MB`;
};
const gbText = (bytes: number) => {
  const gb = toGB(bytes);
  return `${gb >= 100 ? gb.toFixed(0) : gb.toFixed(1).replace(/\.0$/, "")} GB`;
};
const toMBps = (bps: number) => bps / 1024 ** 2;

// 살펴볼 것을 누르면 그 칸으로 가서 M3 포커스 표시기(Material Web md-focus-ring)를 띄운다: 두께 3 · 바깥 간격 2 · secondary,
// 나타날 때 600ms(long4) 중 1/4 은 0 → 8 로 두꺼워지고 3/4 은 3 으로 줄어든다(emphasized). 스크롤이 멎은 뒤 시작해 잠깐 두고 지운다
// (포커스 링은 포커스를 잃으면 바로 사라진다. 사라지는 움직임은 규격에 없어 RING.exitMs · exitEasing 으로 정했다)
const root = ref<HTMLElement | null>(null);
// 사라질 때(규격에 없어 정했다): 두께는 그대로 흐려지기만 한다(300ms, emphasized accelerate). 두께를 줄이면 outline 이 px 단위로 끊겨 버벅여 보인다
const RING = { width: 3, active: 8, offset: 2, durationMs: 600, holdMs: 1200, exitMs: 300, easing: "cubic-bezier(0.2, 0, 0, 1)", exitEasing: "cubic-bezier(0.3, 0, 0.8, 0.15)" };
let ringAnimation: Animation | null = null;
let cancelPendingRing: (() => void) | null = null;
function jumpTo(at: string) {
  const el = root.value?.querySelector<HTMLElement>(`[data-at="${at}"]`);
  if (!el) return;
  ringAnimation?.cancel();
  cancelPendingRing?.();
  const scroller = el.closest<HTMLElement>(".overflow-y-auto");
  const before = scroller?.scrollTop ?? 0;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  // 굴러가면 멎을 때까지 기다린다(이미 보이는 자리라 안 구르면 바로)
  let timer = 0;
  const start = () => {
    cancelPendingRing?.();
    playRing(el);
  };
  const onEnd = () => start();
  scroller?.addEventListener("scrollend", onEnd, { once: true });
  timer = window.setTimeout(() => (scroller && scroller.scrollTop !== before ? (timer = window.setTimeout(start, 900)) : start()), 60);
  cancelPendingRing = () => {
    scroller?.removeEventListener("scrollend", onEnd);
    clearTimeout(timer);
    cancelPendingRing = null;
  };
}
function playRing(el: HTMLElement) {
  const color = getComputedStyle(el).getPropertyValue("--md-secondary").trim();
  const ringFrame = (width: number, c = color) => ({ outline: `${width}px solid ${c}`, outlineOffset: `${RING.offset}px` });
  const total = RING.durationMs + RING.holdMs + RING.exitMs;
  const thickenMs = RING.durationMs * 0.25;
  // 움직임 줄이기를 켰으면 두꺼워졌다 줄어드는 움직임 없이 링만(Material Web 도 같다)
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    ringAnimation = el.animate([ringFrame(RING.width), { ...ringFrame(RING.width), offset: 1 - RING.exitMs / total }, ringFrame(RING.width, "transparent")], { duration: total });
    return;
  }
  ringAnimation = el.animate(
    [
      { ...ringFrame(0), offset: 0, easing: RING.easing },
      { ...ringFrame(RING.active), offset: thickenMs / total, easing: RING.easing },
      { ...ringFrame(RING.width), offset: RING.durationMs / total },
      { ...ringFrame(RING.width), offset: (RING.durationMs + RING.holdMs) / total, easing: RING.exitEasing },
      { ...ringFrame(RING.width, "transparent"), offset: 1 },
    ],
    { duration: total },
  );
}

// 저장공간 카드 자리: 내용 칸이 STORAGE_BESIDE_REM 이상이면 연결 카드 옆(연결 카드 두 단이 설명을 덜 자르고 남는 폭).
// rem 이라 브라우저 기본 글자 크기를 키우면 기준도 같이 커진다(다른 배치 기준인 컨테이너 쿼리와 같다)
const STORAGE_BESIDE_REM = 84;
const [DefineStorage, ReuseStorage] = createReusableTemplate();
const { width: rootWidth } = useElementSize(root);
const storageBeside = computed(() => rootWidth.value >= rem(STORAGE_BESIDE_REM));
// 문턱에서의 폭: 저장공간 22rem, 연결은 나머지(사이 틈 --gap-in 0.75rem). 늘림을 기준 폭과 같게 두면 넓어질수록 그 비율대로 함께 커진다
const STORAGE_CARD_REM = 22;
const LINK_CARD_REM = STORAGE_BESIDE_REM - STORAGE_CARD_REM - 0.75;
const flexFromBase = (base: number) => ({ flex: `${base} 1 ${base}rem` });

// ── ③ 지금 ──
const historyMinutes = computed(() => Math.round((props.status.history.stepMs * props.status.history.ping.length) / 60_000));
type Metric = { title: string; value: string; unit: string; sub: string; subTop?: string; series: number[]; second?: number[]; max: number; warn?: number; chartUnit: string; level: Level; word: string; why: string };
const metrics = computed<Metric[]>(() => {
  const { status } = props;
  const h = status.history;
  const heapPct = (status.node.memory.heapUsed / status.node.memory.heapLimit) * 100;
  const playing = status.players.list.filter((p) => p.state === "playing").length;
  const pingAvg = Math.round(h.ping.reduce((a, b) => a + b, 0) / Math.max(1, h.ping.length));
  return [
    { title: "재생 중", value: `${playing}`, unit: "개", sub: `연결된 서버 ${status.players.list.length}`, series: h.playing, max: Math.max(1, status.players.list.length), chartUnit: "개", level: "ok", word: "", why: "" },
    { title: "디스코드 API 핑", value: `${status.bot.ping}`, unit: "ms", sub: `${historyMinutes.value}분 평균 ${pingAvg}`, series: h.ping, max: 300, warn: LIMITS.ping[0], chartUnit: "ms", level: levelOf(status.bot.ping, ...LIMITS.ping), word: "높음", why: "" },
    { title: "이벤트 루프 지연", value: `${status.loop.p99}`, unit: "ms", sub: `p99 · 최대 ${status.loop.max}`, series: h.loopP99, max: 100, warn: LIMITS.loop[0], chartUnit: "ms", level: levelOf(status.loop.p99, ...LIMITS.loop), word: "밀림", why: "" },
    { title: "heap 메모리", value: heapPct.toFixed(0), unit: "%", subTop: `RSS ${(status.node.memory.rss / 1024).toFixed(2)} GB`, sub: `${(status.node.memory.heapUsed / 1024).toFixed(2)} / ${(status.node.memory.heapLimit / 1024).toFixed(2)} GB`, series: h.heapPct, max: 100, warn: LIMITS.heap[0], chartUnit: "%", level: levelOf(heapPct, ...LIMITS.heap), word: "한도 가까움", why: "" },
    { title: "CPU", value: `${status.cpu.bot}`, unit: "%", sub: `시스템 ${status.cpu.system}%`, series: h.cpuBot, second: h.cpuSystem, max: 100, warn: LIMITS.cpu[0], chartUnit: "%", level: levelOf(status.cpu.bot, ...LIMITS.cpu), word: "높음", why: "" },
    { title: "다운로드 (yt-dlp)", value: toMBps(status.download.bytesPerSec).toFixed(1), unit: "MB/s", subTop: `활성 ${status.download.active}개`, sub: `오늘 ${formatBytes(status.download.todayBytes)}`, series: h.downloadBps.map(toMBps), max: 5, chartUnit: "MB/s", level: "ok", word: "", why: "" },
  ];
});

// ── ② 연결 ──
const LINK_WORD: Record<LinkState, string> = { ok: "정상", slow: "느림", fail: "실패", idle: "대기 중", off: "비활성" };
const LINK_ICON: Record<LinkState, string> = { ok: "check_circle", slow: "warning", fail: "cancel", idle: "schedule", off: "block" };
const LINK_ICON_FILLED: Record<LinkState, boolean> = { ok: true, slow: true, fail: true, idle: false, off: false };
const LINK_TEXT: Record<LinkState, string> = { ok: "text-(--ok-ink)", slow: "text-(--warn-ink)", fail: "text-error", idle: "text-on-surface-variant", off: "text-on-surface-variant" };
// 칸 너비를 묶음 · 열과 상관없이 고정해 이름 · 마지막 성공 · 응답이 위아래로 줄을 맞춘다(이름은 가장 긴 "SponsorBlock" 이 들어가게)
/** 클라이언트 상자의 윗선 조각: 줄 가운데 높이에서 시작해 아래로 이어진다 */
const CLIENT_BOX_EDGE = "self-end h-2.5 border-t border-outline-variant/60";
const LINK_GRID = "grid grid-cols-1 @md/card:grid-cols-[8.5rem_minmax(0,1fr)_6.5rem_3.5rem] gap-x-3";
// 좁은 카드: 머리 · 줄마다 제 격자(이름 | 마지막 성공 | 응답, 설명은 아래 줄). 넓으면 contents 로 바깥 네 칸 격자에 그대로 든다
const LINK_NARROW = "grid grid-cols-[minmax(0,1fr)_6.5rem_3.5rem] items-center gap-x-3 @md/card:contents";
const COOKIE_WORD = { file: "파일", browser: "브라우저", none: "" } as const;
/** whenFull: "마지막 성공"을 줄여 보였을 때(약 …)만 전체 길이 */
type LinkLine = { name: string; state: LinkState; detail: string; when: string; whenFull?: string | null; value: string; hint?: string | null };
/**
 * 지난 때를 큰 단위 둘까지만 "2시간 8분 전" 꼴로(0인 단위는 뺀다). 그 아래 단위가 남으면 앞에 "약"을 붙이고 전체("2시간 8분 13초 전")는 full 로.
 * 칸 너비가 "약 23시간 59분 전"까지만 받으면 되게 하려는 것
 */
function sinceText(at: number): { short: string; full: string | null } {
  const elapsedSec = Math.floor((Date.now() - at) / 1000);
  if (elapsedSec < 5) return { short: "방금 전", full: null };
  const units: Array<[number, string]> = [
    [Math.floor(elapsedSec / 86400), "일"],
    [Math.floor((elapsedSec % 86400) / 3600), "시간"],
    [Math.floor((elapsedSec % 3600) / 60), "분"],
    [elapsedSec % 60, "초"],
  ];
  const top = units.findIndex(([n]) => n > 0);
  const say = (list: Array<[number, string]>) =>
    list
      .filter(([n]) => n > 0)
      .map(([n, u]) => `${n}${u}`)
      .join(" ");
  const cut = units.slice(top + 2).some(([n]) => n > 0);
  const short = `${say(units.slice(top, top + 2))} 전`;
  return cut ? { short: `약 ${short}`, full: `${say(units)} 전` } : { short, full: null };
}
// 마지막 성공 · 응답 칸이 비면 화면이 "-" 를 넣는다(설명 칸은 비워 둔다)
function toLinkLine(c: LinkRow): LinkLine {
  if (c.state === "off") return { name: c.name, state: c.state, detail: "현재 사용되지 않는 출처", when: "", value: "" };
  if (c.id === "discord") return { ...measuredLinkLine(c), detail: discordDetail() };
  return measuredLinkLine(c);
}
/** 디스코드 API 줄의 설명: 끊겨 있으면 몇 번째 시도인지, 붙어 있으면 켜진 뒤 재수립 횟수(0 이면 비운다) */
function discordDetail() {
  const { reconnects, retryAttempt } = props.status.bot;
  if (retryAttempt !== null) return `연결 재시도 중 (${retryAttempt}회차)`;
  return reconnects > 0 ? `연결 재수립 ${reconnects}회` : "";
}
function measuredLinkLine(c: LinkRow): LinkLine {
  const value = c.state === "fail" ? (c.error ?? "실패") : c.latencyMs === null ? "" : latencyText(c.latencyMs);
  const when = c.lastOkAt ? sinceText(c.lastOkAt) : null;
  return { name: c.name, state: c.state, detail: c.note ?? "", when: when?.short ?? "", whenFull: when?.full, value, hint: c.hint };
}
const linkGroups = computed(() => {
  const { links, youtube } = props.status;
  const of = (group: LinkRow["group"]) => links.filter((c) => c.group === group).map(toLinkLine);
  // 쿠키는 부르는 곳이 아니라 파일 · 브라우저라 응답이 없다. 유효한지는 쓸 때만 알 수 있다
  const cookie: LinkLine = youtube.cookies === "none" ? { name: "쿠키", state: "off", detail: "쿠키를 쓰지 않음", when: "", value: "" } : { name: "쿠키", state: "ok", detail: COOKIE_WORD[youtube.cookies], when: "", value: "" };
  return [
    { title: "재생", critical: true, items: of("play") },
    { title: "유튜브", critical: true, youtube: true, items: [...of("youtube"), cookie] },
    { title: "자동재생", critical: false, items: of("autoplay") },
  ];
});
const linkColumns = computed(() => [linkGroups.value.slice(0, 2), linkGroups.value.slice(2)]);
const youtubeClients = computed(() =>
  props.status.youtube.clients.map((c, i) => {
    const ok = c.tried - c.failed;
    const rate = c.tried ? ok / c.tried : 0;
    const level: Level = c.excluded ? "warn" : levelOf(c.tried ? c.failed / c.tried : 0, 0.1, 0.5);
    return { name: c.name, rate, level, value: c.excluded ? "건너뜀" : `${ok}/${c.tried}`, detail: `${i + 1}번째로 시도\n${c.tried}번 중 ${ok}번 성공${c.excluded ? "\n연속으로 실패해 한동안 건너뛴다" : ""}` };
  }),
);

// ── ④ 하는 일 ──
type PlayerState = AdminStatus["players"]["list"][number]["state"];
const PLAYER_STATE_WORD: Record<PlayerState, string> = { playing: "재생 중", paused: "일시정지", idle: "재생 대기" };
const PLAYER_STATES = Object.keys(PLAYER_STATE_WORD) as PlayerState[];
// 처음에는 곡이 걸린 서버만(재생 중 · 일시정지)
const shownPlayerStates = ref(new Set<PlayerState>(["playing", "paused"]));
const playerListEl = ref<HTMLElement | null>(null);
const playerListOverflowing = useOverflowing(playerListEl);
// 더 있는 쪽 끝 반 줄(24)을 흐리게(자식 프로세스 목록과 같다)
const playerFade = useScrollFade(playerListEl, () => true, 24);
// 찾기: 서버 이름 · 곡 · 가수(한국어 조합 중 글자 · 초성도, utils/ko-search)
const playerTerm = ref("");
const shownPlayers = computed(() => props.status.players.list.filter((p) => shownPlayerStates.value.has(p.state) && [p.name, p.title ?? "", p.artist ?? ""].some((t) => koMatch(t, playerTerm.value))));
const listenerTotal = computed(() => props.status.players.list.reduce((n, p) => n + p.listeners, 0));
function togglePlayerState(k: PlayerState) {
  const next = new Set(shownPlayerStates.value);
  if (!next.delete(k)) next.add(k);
  shownPlayerStates.value = next;
}
const playerFilters = computed(() => {
  const l = props.status.players.list;
  return PLAYER_STATES.map((k) => ({ key: k, label: PLAYER_STATE_WORD[k], count: l.filter((p) => p.state === k).length, on: shownPlayerStates.value.has(k), toggle: () => togglePlayerState(k) }));
});
const NOT_MEMBER_TIP = "참가하지 않은 서버라 열 수 없어요";
const ORPHAN_TIP = "플레이어가 없는 서버의 재생 일을 하는 프로세스예요.\n종료에 실패한 잔류 프로세스일 수 있어요.";
// 하는 일: 봇 도우미는 이름, 서버의 일은 서버 이름(다음 곡 · 곡 찾기는 덧붙인다). 서버를 나갔으면 이름이 없다
const HELPER_JOB: Partial<Record<NonNullable<ProcessRow["job"]>, string>> = { "pot-server": "POToken 서버", "ytdlp-update": "yt-dlp 업데이트" };
function processJob(p: ProcessRow) {
  const helper = p.job && HELPER_JOB[p.job];
  if (helper) return helper;
  const guild = p.guildName ?? (p.guildId ? "나간 서버" : null);
  const task = p.job === "prefetch" ? "다음 곡" : p.job === "lookup" ? "곡 찾기" : null;
  return [guild, task].filter(Boolean).join(" · ") || "없음";
}
// 칸 머리와 줄이 따로라 열 폭을 고정한다: PID 5자리 · 프로그램(yt-dlp) · 하는 일 · 작동 시간(2:58:33) · 메모리(52 MB)
const PROCESS_GRID = "grid grid-cols-[4rem_minmax(0,1fr)_3.5rem] @md/card:grid-cols-[3rem_4rem_minmax(0,1fr)_4rem_3.5rem] items-center gap-x-3";
// 정렬: 처음은 작동 시간이 긴 차례(서버가 주는 차례). 다른 칸을 처음 누르면 수는 큰 것부터, 글은 가나다 차례
type ProcessSortKey = "pid" | "label" | "job" | "age" | "mem";
const PROCESS_COLUMNS: Array<{ key: ProcessSortKey; label: string; right?: boolean; numeric?: boolean }> = [
  { key: "pid", label: "PID", numeric: true },
  { key: "label", label: "프로그램" },
  { key: "job", label: "하는 일" },
  { key: "age", label: "작동 시간", right: true, numeric: true },
  { key: "mem", label: "메모리", right: true, numeric: true },
];
const processSort = ref<{ key: ProcessSortKey; desc: boolean }>({ key: "age", desc: true });
function sortProcessesBy(key: ProcessSortKey) {
  const { key: now, desc } = processSort.value;
  processSort.value = key === now ? { key, desc: !desc } : { key, desc: Boolean(PROCESS_COLUMNS.find((c) => c.key === key)?.numeric) };
}
const processSortValue: Record<ProcessSortKey, (p: ProcessRow) => number | string> = { pid: (p) => p.pid, label: (p) => p.label, job: (p) => processJob(p), age: (p) => p.ageMs, mem: (p) => p.memMb ?? -1 };
const sortedProcesses = computed(() => {
  const { key, desc } = processSort.value;
  const value = processSortValue[key];
  const order = (a: ProcessRow, b: ProcessRow) => {
    const x = value(a);
    const y = value(b);
    return typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ko");
  };
  return [...props.status.processes.oldest].sort((a, b) => (desc ? order(b, a) : order(a, b)));
});
const playerCardEl = ref<InstanceType<typeof BaseCard> | null>(null);
const { height: playerCardHeight } = useElementSize(playerCardEl, undefined, { box: "border-box" });
const processListEl = ref<HTMLElement | null>(null);
const processListOverflowing = useOverflowing(processListEl);
// 더 있는 쪽 끝 반 줄(16)을 흐리게
const processFade = useScrollFade(processListEl, () => true, 16);
const processMemMb = computed(() => props.status.processes.oldest.reduce((n, p) => n + (p.memMb ?? 0), 0));

// ── ⑤ 저장공간 ──
const storageBars = computed(() => {
  const { cache, disk } = props.status.storage;
  const diskPct = (disk.usedBytes / disk.totalBytes) * 100;
  return [
    { key: "cache", label: "오디오 캐시", ratio: cache.bytes / cache.maxBytes, text: `${toGB(cache.bytes).toFixed(1)} / ${toGB(cache.maxBytes).toFixed(0)} GB`, level: "ok" as Level },
    { key: "files", label: "캐시 파일 수", ratio: cache.files / cache.maxFiles, text: `${cache.files.toLocaleString("ko-KR")} / ${cache.maxFiles.toLocaleString("ko-KR")}개`, level: "ok" as Level },
    { key: "drive", label: `드라이브 (${disk.drive})`, ratio: diskPct / 100, text: `${gbText(disk.totalBytes)} 중 ${gbText(disk.totalBytes - disk.usedBytes)} 사용 가능`, level: levelOf(diskPct, ...LIMITS.disk) },
  ];
});
// 재생 중 캐시 보호: 지금 트는 곡의 캐시 파일(지우지 않는다). 미재생 캐시 파일: 캐시에 받아 뒀는데 재생 횟수가 0 인 파일(미리 받았다가 건너뛴 곡 등). 받기 실패한 캐시 파일: 받다 실패 · 받다 멈춤 · 파일이 사라진 캐시 줄(다시 받으면 풀린다)
const cacheCounts = computed<Array<[string, string]>>(() => {
  const { cache } = props.status.storage;
  return [
    ["재생 중 캐시 보호", `${cache.protectedFiles}개`],
    ["미재생 캐시 파일", `${cache.neverPlayed.toLocaleString("ko-KR")}개`],
    ["받기 실패한 캐시 파일", `${cache.failed.toLocaleString("ko-KR")}개`],
  ];
});
// 캐시 드라이브 막대의 조각: 오디오 캐시 · DB(같은 드라이브일 때만) · 기타 · 여유 공간 · 최소 여유
const driveParts = computed(() => {
  const { cache, disk, db } = props.status.storage;
  const dbHere = db.drive === disk.drive;
  const other = Math.max(0, disk.usedBytes - cache.bytes - (dbHere ? db.bytes : 0));
  const free = disk.totalBytes - disk.usedBytes;
  const reserve = Math.min(free, disk.minFreeBytes);
  const parts = [{ label: "오디오 캐시", bytes: cache.bytes, tone: "bg-(--store-cache)" }, ...(dbHere ? [{ label: "DB", bytes: db.bytes, tone: "bg-(--store-db)" }] : []), { label: "기타", bytes: other, tone: "bg-(--store-other)" }, { label: "여유 공간", bytes: free - reserve, tone: "bg-(--store-free)" }];
  const rows = parts.map((part) => ({ ...part, text: sizeText(part.bytes), tip: `${part.label} ${sizeText(part.bytes)}` }));
  const minFree = gbText(disk.minFreeBytes);
  return [...rows, { label: "최소 여유", bytes: reserve, tone: "bg-(--store-reserve)", text: minFree, tip: `최소 여유 ${minFree}` }];
});
const dbRows = computed<Array<[string, string]>>(() => {
  const { db, cache, disk } = props.status.storage;
  const n = (v: number) => v.toLocaleString("ko-KR");
  // DB 크기는 늘 표에(드라이브가 다르면 드라이브명을 붙인다). 같은 드라이브면 드라이브 막대에도 조각으로 들어간다
  return [
    ["DB 파일", db.drive === disk.drive ? sizeText(db.bytes) : `${sizeText(db.bytes)} (${db.drive})`],
    ["곡 조회 기록", `${n(db.lookups)}곡`],
    ["SponsorBlock 구간", `${n(db.sponsorSegments)}곡`],
    // 재시작 때 되살릴 세션(player_sessions). 나가며 남긴 것 · 되살리지 않고 남긴 것도 세므로 "활성"을 붙이지 않는다
    ["백업된 플레이어", `${n(db.sessions)}개`],
    // 마지막으로 실제로 지운 정리: 언제 · 지운 수 · 비운 용량(정리는 기동 · 정기 간격 · 받은 뒤마다 돌고, 한도를 넘었을 때만 지운다)
    ["마지막 캐시 정리", cache.lastCleanup ? `${sinceText(cache.lastCleanup.at).short} · ${n(cache.lastCleanup.files)}개 · ${sizeText(cache.lastCleanup.bytes)}` : "-"],
  ];
});

// ── ① 요약: 위 값들 중 주의 · 문제인 것(at: 누르면 갈 칸). 가장 나쁜 것이 전체 상태 ──
const linkLevel = (state: LinkState, critical: boolean): Level => (state === "fail" ? (critical ? "bad" : "warn") : state === "slow" ? "warn" : "ok");
const attention = computed(() => [
  ...metrics.value.filter((m) => m.level !== "ok").map((m) => ({ name: m.title, word: m.word, level: m.level, at: m.title })),
  ...linkGroups.value.flatMap((group) => group.items.map((line) => ({ name: line.name, word: LINK_WORD[line.state], level: linkLevel(line.state, group.critical), at: "연결" }))).filter((item) => item.level !== "ok"),
  ...youtubeClients.value.filter((client) => client.level !== "ok").map((client) => ({ name: `유튜브 ${client.name}`, word: client.value === "건너뜀" ? "건너뜀" : "잦은 실패", level: client.level, at: "연결" })),
  ...storageBars.value.filter((u) => u.level !== "ok").map((u) => ({ name: u.label, word: "거의 참", level: u.level, at: "저장공간" })),
  ...props.status.processes.oldest.filter((p) => p.stray).map((p) => ({ name: `${p.label} ${p.pid}`, word: "잔류 프로세스", level: "warn" as Level, at: "자식 프로세스" })),
]);
const overallLevel = computed<Level>(() => (attention.value.some((a) => a.level === "bad") ? "bad" : attention.value.length ? "warn" : "ok"));
</script>

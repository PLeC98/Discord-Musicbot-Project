<template>
  <!-- 봇 상태 탭. 괜찮은가(요약) → 무엇에 기대는가(연결, 높이가 거의 고정이라 위에) → 지금 어떤가(흐름) → 무엇을 하는가(플레이어, 프로세스, 흐름과 자주 같이 보고 서버 수만큼 길어져 아래에) → 어디에 쌓이는가(저장공간). 잘 안 바뀌는 환경, 버전은 봇 정보 탭(BotInfo).
       상태는 색 + 모양(✓ 동그라미, ! 세모, ✕ 동그라미) + 단어로 알린다. 화면 글은 짧게, 까닭은 점선 밑줄 글에 올리면 뜨는 툴팁으로 -->
  <!-- 저장공간 카드는 폭에 따라 두 위치 중 하나에 놓인다. 한 번 정의해 두고 부른다(VueUse createReusableTemplate) -->
  <DefineStorage>
    <BaseCard icon="hard_drive" :title="T.storage" data-at="storage">
      <!-- 카드 높이를 늘리지 않게 헤더 오른쪽에. 작은 색조 버튼(높이 32px, 헤더 줄 40px 안) -->
      <template #actions
        ><BaseButton variant="secondary" size="sm" class="gap-0!" @click="emit('openDb')">{{ T.dbBrowser }}<Icon name="chevron_right" :size="18" class="-mr-1.5" /></BaseButton
      ></template>
      <div class="flex flex-col gap-3">
        <!-- 막대는 늘 쓴 만큼. 캐시는 한도까지 채우고 오래 안 들은 곡부터 삭제하므로 차 있는 것이 정상(경고하지 않는다).
             순서는 오디오 캐시, 캐시 파일 수, 구분선, 드라이브(오디오 캐시, 기타, 여유 공간, 최소 여유로 나눈다) -->
        <div v-for="bar in storageBars" :key="bar.key" :class="bar.key === 'drive' && 'pt-3 border-t border-outline-variant/40'">
          <div class="flex items-baseline gap-2 text-sm">
            <span>{{ bar.label }}</span>
            <span class="ml-auto text-xs nums" :class="LEVEL_TEXT[bar.level]">{{ bar.text }}</span>
          </div>
          <!-- 나눈 막대: 오디오 캐시, 기타, 여유 공간, 최소 여유(CACHE_MIN_FREE_DISK_MB, 반투명 빨강, 맨 뒤). 조각 사이 2px 을 띄우고, 아래에 같은 색 점으로 이름, 크기 -->
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
          <!-- 캐시 수: 오디오 캐시, 캐시 파일 수 아래, 드라이브 구분선 위에 -->
          <!-- 이름, 수 행은 카드 아래 DB 표와 같은 모양. 표는 행마다 따로 폭을 잡는다(긴 값 하나가 모든 행의 이름 셀을 좁혀 이름이 접히지 않게, 이름은 접지 않고 값이 넘치면 자른다) -->
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
      <!-- 좁으면(휴대폰) 마지막 갱신, 다시 시작이 아래 줄 오른쪽으로 내려간다. 한 줄에 두면 제목 영역이 몇 글자 폭으로 눌려 세로로 접히고 부제는 잘려 사라진다 -->
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span class="size-12 shrink-0 rounded-[30%] flex items-center justify-center" :class="LEVEL_BADGE[overallLevel]"><Icon :name="LEVEL_ICON[overallLevel]" :size="24" fill /></span>
        <div class="min-w-0 grow basis-44">
          <div class="font-round text-xl font-semibold">{{ overallLevel === "ok" ? T.allOk : T.needsAttention(attentionCount) }}</div>
          <!-- 좁으면 자르지 않고 접는다(잘리면 실행 시간, 서버 수가 보이지 않는다) -->
          <div class="text-sm text-on-surface-variant">
            {{ status.bot.tag }} · <template v-if="status.bot.status !== 0">{{ T.connecting }}</template
            >{{ T.runningFor(formatSpan(status.bot.uptime), status.bot.guilds) }}
          </div>
        </div>
        <div class="ml-auto shrink-0 flex items-center gap-4">
          <span class="shrink-0 flex items-center gap-1 text-xs text-on-surface-variant" v-tooltip="stale ? T.staleTip : T.freshTip"
            ><span class="size-2 rounded-full" :class="stale ? 'bg-outline' : 'bg-(--ok-ink)'"></span>{{ stale ? T.stale : T.lastUpdate }} <span class="nums text-on-surface">{{ updatedAt ? clock(updatedAt, true) : "" }}</span></span
          >
          <BotRestart :available="status.env.launcher" />
        </div>
      </div>
      <!-- 주의 칩: 누르면 그 항목으로 가서 잠깐 테두리가 빛난다 -->
      <div v-if="attention.length" class="flex flex-wrap gap-2">
        <button v-for="a in attention" :key="a.name" type="button" class="tap state-layer h-8 px-2 rounded-sm flex items-center gap-2 text-xs font-medium cursor-pointer" :class="LEVEL_CHIP[a.level]" @click="jumpTo(a.at)"><Icon :name="LEVEL_ICON[a.level]" :size="18" fill />{{ a.name }} · {{ a.word }}</button>
      </div>
      <div class="rounded-(--r-inner) bg-surface-container-high px-4 py-3">
        <!-- 좁으면 단어 단위로 다음 줄에(단어 안에서 꺾이지 않게) -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant whitespace-nowrap" :class="status.recent.lines.length ? 'mb-2' : ''">
          <span>{{ T.recentSummary }}</span>
          <span :class="status.recent.error ? LEVEL_TEXT.bad : ''">{{ T.errors(status.recent.error) }}</span>
          <span :class="status.recent.warn ? LEVEL_TEXT.warn : ''">{{ T.warnings(status.recent.warn) }}</span>
          <button type="button" class="ml-auto text-primary font-semibold cursor-pointer hover:underline" @click="emit('openLogs')">{{ T.openLogs }}</button>
        </div>
        <ul class="flex flex-col gap-1 text-sm">
          <li v-for="r in status.recent.lines" :key="r.ts + r.text" class="flex items-center gap-2 min-w-0">
            <span class="text-xs nums text-on-surface-variant">{{ clock(r.ts) }}</span>
            <Icon :name="LEVEL_ICON[r.level === 'error' ? 'bad' : 'warn']" :size="16" fill :class="r.level === 'error' ? LEVEL_TEXT.bad : LEVEL_TEXT.warn" />
            <span class="min-w-0 truncate">{{ r.text }}</span>
            <span v-if="r.count > 1" class="shrink-0 h-4 px-1 rounded-full bg-surface-container-highest text-2xs leading-4 nums text-on-surface-variant" v-tooltip="T.repeated(r.count, clock(r.ts))">×{{ r.count }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- ② 연결: 봇이 실제로 부른 결과(따로 찔러 보지 않는다). 최근에 안 쓴 곳은 "대기 중", 쓰는 설정이 없는 곳은 "비활성" -->
    <!-- 내용 영역이 넓으면(STORAGE_BESIDE_REM 이상) 연결 카드 옆에 저장공간 카드를 붙인다(높이는 연결 카드에 맞춘다). 좁으면 저장공간은 아래쪽 왼쪽 열에.
         붙은 뒤로 더 넓어지면 둘이 임계값에서의 폭 비율대로 같이 늘어난다(flex 늘림 = 기준 폭) -->
    <div class="flex gap-(--gap-in) items-stretch">
      <BaseCard icon="hub" :title="T.links" data-at="links" class="flex-1 min-w-0" :style="storageBeside ? flexFromBase(LINK_CARD_REM) : undefined">
        <!-- 왼쪽 열에 재생, 유튜브(소리를 내는 데 쓰는 것), 오른쪽 열에 자동재생 -->
        <div class="grid grid-cols-1 @3xl/card:grid-cols-2 gap-x-10 gap-y-4">
          <div v-for="(col, ci) in linkColumns" :key="ci" class="flex flex-col gap-4">
            <div v-for="group in col" :key="group.title">
              <!-- 열: 이름, 무엇(설명, 모델, 방식), 마지막 성공, 응답(실패면 오류). 쓰지 않는 곳도 같은 열(설명에 그 사실, 숫자 열은 -).
                   좁은 카드(448px 미만, 휴대폰)는 설명 열이 남지 않아 행마다 두 줄: 위에 이름, 마지막 성공, 응답, 아래에 설명(이름 글자 위치부터). 헤더, 행이 저마다 같은 세 열 격자 -->
              <div :class="LINK_GRID" class="items-center text-sm">
                <span class="contents text-xs text-on-surface-variant" :class="LINK_NARROW"
                  ><span class="@md/card:col-span-2 pb-1">{{ group.title }}</span
                  ><span class="pb-1 text-right">{{ T.lastOk }}</span
                  ><span class="pb-1 text-right">{{ T.response }}</span></span
                >
                <div v-for="line in group.items" :key="line.name" :class="LINK_NARROW">
                  <span class="flex items-center gap-2 h-8 min-w-0"
                    ><Icon :name="LINK_ICON[line.state]" :size="20" :fill="LINK_ICON_FILLED[line.state]" :class="LINK_TEXT[line.state]" /><span class="truncate" :class="[line.state === 'off' && 'text-on-surface-variant', line.hint && 'underline decoration-dotted underline-offset-2 cursor-help']" v-tooltip="line.hint">{{ line.name }}</span></span
                  >
                  <!-- 설명이 셀보다 길면 잘라 두지 않고 좌우로 흘려 보이고(마퀴), 그때만 툴팁으로 전체를 -->
                  <MarqueeText class="min-w-0 text-xs text-on-surface-variant order-last col-span-full pl-7 -mt-1.5 pb-1 @md/card:order-0 @md/card:col-auto @md/card:p-0 @md/card:mt-0" :class="!line.detail && '@max-md/card:hidden'" :text="line.detail" tip />
                  <span class="text-xs nums text-right text-on-surface-variant whitespace-nowrap" :class="line.whenFull && 'underline decoration-dotted underline-offset-2 cursor-help'" v-tooltip="line.whenFull">{{ line.when || "-" }}</span>
                  <span class="text-xs nums text-right whitespace-nowrap" :class="LINK_TEXT[line.state]">{{ line.value || "-" }}</span>
                </div>
              </div>
              <!-- 유튜브 클라이언트(설정한 순서대로 시도): 유튜브의 하위라 테두리 상자로 묶는다. 제목, 열 헤더는 윗선 위에 걸치고(윗선을 조각으로 그어 반투명 바탕에서도 글자 밑으로 선이 지나지 않게),
                   이름 열은 바깥 이름 열에서 상자 여백, 테두리만큼 줄여 막대가 바깥 설명 열과 같은 위치에서 시작한다 -->
              <div v-if="group.youtube" class="mt-3">
                <div class="flex items-center h-5 text-xs text-on-surface-variant">
                  <span :class="[CLIENT_BOX_EDGE, 'w-3 border-l rounded-tl-sm']"></span><span class="px-1">{{ T.clients }}</span
                  ><span :class="[CLIENT_BOX_EDGE, 'flex-1']"></span><span class="px-1">{{ T.clientsRate }}</span
                  ><span :class="[CLIENT_BOX_EDGE, 'w-3 border-r rounded-tr-sm']"></span>
                </div>
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

    <!-- ③ 지금: 값 + 최근 15분 흐름. 지표 카드 여덟 개를 네 칸씩 두 줄(위: 재생, 응답, 아래: 자원). 2열이면 둘씩 짝이 맞는다.
         네 칸은 카드가 13rem(보조 텍스트를 한 줄에 두는 폭) 이상일 때부터, 410px 이하는 1열(2열이면 큰 숫자 옆에 보조 텍스트가 들어가지 않는다) -->
    <div class="grid grid-cols-1 min-[411px]:grid-cols-2 @4xl/content:grid-cols-4 gap-(--gap-in)">
      <section v-for="m in metrics" :key="m.title" :data-at="m.title" class="@container/metric pane rounded-(--r-window) px-4 py-3 flex flex-col gap-1">
        <div class="flex items-center gap-1 text-xs text-on-surface-variant">
          <span class="truncate" :class="m.why && 'underline decoration-dotted underline-offset-2 cursor-help'" v-tooltip="m.why || null"
            ><template v-if="m.short"
              ><span class="underline decoration-dotted underline-offset-2 cursor-help" :class="AT_SMALL[0]" v-tooltip="m.title">{{ m.short }}</span
              ><span :class="AT_SMALL[1]">{{ m.title }}</span></template
            ><template v-else>{{ m.title }}</template
            ><template v-if="m.stat"> · {{ m.stat }}</template></span
          >
          <span v-if="m.level !== 'ok'" class="ml-auto shrink-0 flex items-center gap-1 font-semibold" :class="LEVEL_TEXT[m.level]"><Icon :name="LEVEL_ICON[m.level]" :size="14" fill />{{ m.word }}</span>
        </div>
        <div class="flex items-baseline-last gap-0.5" :class="LEVEL_TEXT[m.level]">
          <!-- 글에 버전이 여럿(Stepped)이면 카드 너비에 맞는 버전 하나만 보인다 -->
          <span class="font-round text-2xl @min-[10.14rem]/metric:text-3xl font-semibold tracking-tighter nums"
            ><span v-for="s in stepsOf(m.value)" :key="s.cls" :class="[s.cls, s.tip && TIP]" v-tooltip="s.tip">{{ s.text }}</span></span
          ><span v-if="m.unit" class="text-xs" :class="m.level === 'ok' && 'text-on-surface-variant'"
            ><span v-for="s in stepsOf(m.unit)" :key="s.cls" :class="s.cls">{{ s.text }}</span></span
          >
          <!-- 보조 텍스트. subTop 이 있으면 그 위에 한 줄 더. 줄은 마지막 글줄의 베이스라인(last baseline)으로 맞춰, 큰 숫자, 단위, 보조 텍스트 아래 줄이 같은 선에 선다.
               둘째 선 표시(짧은 가로선)는 둘째 선의 값이 있는 줄에(markTop 이면 위 줄). 글 안의 줄바꿈은 그대로 줄을 나눈다. 툴팁은 숫자에만.
               늘 두 줄 높이(min-h-8)라 보조 텍스트가 한 줄인 카드도 두 줄인 옆 카드와 큰 숫자의 높이가 같다(큰 숫자가 작아지면 두 줄이 줄 높이를 정한다) -->
          <span class="ml-auto min-w-0 min-h-8 flex flex-col justify-end items-end text-right text-2xs @min-[10.14rem]/metric:text-xs text-on-surface-variant nums"
            ><span v-if="m.subTop" class="flex items-center gap-1 truncate"
              ><span v-if="m.second && m.markTop" class="w-3 h-0.5 rounded-full bg-current opacity-50"></span
              ><span v-for="s in stepsOf(lineOf(m.subTop).num)" :key="s.cls" class="whitespace-pre" :class="s.cls"
                >{{ lineOf(m.subTop).label }}{{ lineOf(m.subTop).label ? " " : "" }}<span :class="s.tip && TIP" v-tooltip="s.tip">{{ s.text }}</span></span
              ></span
            ><span class="flex items-center gap-1 truncate"
              ><span v-if="m.second && !m.markTop" class="w-3 h-0.5 rounded-full bg-current opacity-50"></span
              ><span v-for="s in stepsOf(lineOf(m.sub).num)" :key="s.cls" class="whitespace-pre" :class="s.cls"
                >{{ lineOf(m.sub).label }}{{ lineOf(m.sub).label ? " " : "" }}<span :class="s.tip && TIP" v-tooltip="s.tip">{{ s.text }}</span></span
              ></span
            ><span v-if="m.subUp" class="@min-[9.2rem]/metric:hidden">&nbsp;</span></span
          >
        </div>
        <SparkChart :values="m.series" :second="m.second" :max="m.max" :warn="m.warn" :scale="m.scale" :minutes="historyMinutes" :now="new Date(status.history.endAt)" :tone="LEVEL_GRAPH[m.level]" />
      </section>
    </div>

    <!-- ④ 작업, ⑤ 쌓이는 곳: 2열 격자. 첫 행에 활성 플레이어, 자식 프로세스(같은 행이라 높이가 같다), 둘째 행에 인코딩 워커, 저장공간(저장공간은 넓을 때 연결 카드 옆으로 간다).
         1열이 되면 DOM 순서 그대로 -->
    <div class="grid grid-cols-1 @4xl/content:grid-cols-2 gap-(--gap-in)">
      <BaseCard ref="playerCardEl" icon="graphic_eq" :title="T.playersTitle(status.players.voiceConnections)">
        <!-- 상태 필터: M3 필터 칩(여럿 켜기). 오른쪽 끝에 검색. 연결된 서버 수는 카드 제목에, 청취자, 대기열 합계는 카드 맨 아래(자식 프로세스 합계와 같은 모양) -->
        <div class="flex flex-wrap items-center gap-2 mb-2">
          <button v-for="f in playerFilters" :key="f.key" type="button" :aria-pressed="f.on" :class="[FILTER_CHIP, f.on ? FILTER_CHIP_ON : FILTER_CHIP_OFF]" @click="f.toggle()">
            {{ f.label }}<span class="nums font-semibold">{{ f.count }}</span>
          </button>
          <SearchInput v-model="playerTerm" :placeholder="T.search" :input-class="[SEARCH_FIELD, 'w-full']" class="ml-auto flex-1 min-w-28 max-w-48" />
        </div>
        <!-- 목록 영역은 서버 10.5줄(1열일 때는 6.5줄) 높이로 고정(마지막 줄이 반쯤 걸려 스크롤된다는 것이 보인다). 넘치면 영역 오른쪽을 카드 끝까지 넓혀 스크롤바가 가장자리에서 3px 떨어지게.
             보이는 행 둘레만 그리고 위아래는 스페이서로 높이만 채운다(composables/row-window). 아직 받지 못한 자리는 스켈레톤 행 -->
        <div ref="playerListEl" class="h-78 @4xl/content:h-126 overflow-y-auto -ml-2" :class="playerListOverflowing ? '-mr-4' : '-mr-2'" :style="playerFade">
          <ul v-if="status.players.matched" class="flex flex-col" :style="{ paddingTop: `${playerTop}px`, paddingBottom: `${playerBottom}px` }">
            <li v-for="{ key, row: player } in playerSlots" :key="key">
              <div v-if="!player" class="flex items-center gap-3 h-12 px-2" aria-hidden="true"><span class="size-8 shrink-0 rounded-full bg-on-surface/8" /><span class="h-3 w-1/2 rounded-sm bg-on-surface/8" /></div>
              <!-- 참가한 서버만 그 서버 화면으로 잇는다(참가하지 않은 서버는 운영자도 열지 않는다) -->
              <component v-else :is="player.member ? RouterLink : 'div'" :to="player.member ? `/servers/${player.guildId}` : undefined" class="flex items-center gap-3 h-12 px-2 rounded-(--r-row) no-underline text-on-surface" :class="player.member && 'state-layer'" v-tooltip="player.member ? null : NOT_MEMBER_TIP">
                <GuildAvatar :guild="{ name: player.name, icon: player.icon, hasPlayer: true }" :status="false" size-class="size-8" class="shrink-0" />
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-semibold truncate">{{ player.name }}</div>
                  <div class="text-xs text-on-surface-variant truncate">
                    <template v-if="player.title"
                      >{{ player.title }}<template v-if="player.artist"> · {{ player.artist }}</template></template
                    >
                    <template v-else>{{ T.noSong }}</template>
                  </div>
                </div>
                <div class="shrink-0 text-right text-xs nums whitespace-nowrap">
                  <div class="flex items-center justify-end gap-1 text-on-surface-variant"><Icon name="headphones" :size="14" />{{ T.playerLine(player.listeners, player.queued) }}</div>
                  <div :class="player.state !== 'playing' && 'text-on-surface-variant'">{{ player.state === "playing" ? `${formatDuration(player.position, "0:00")} / ${formatDuration(player.duration, "0:00")}` : PLAYER_STATE_WORD[player.state] }}</div>
                </div>
              </component>
            </li>
          </ul>
          <div v-else class="px-2 py-3 text-sm text-on-surface-variant">{{ query.states.length ? T.noMatch : T.noStatePicked }}</div>
        </div>
        <div class="mt-3 flex items-baseline gap-3 pt-3 border-t border-outline-variant/40 text-xs text-on-surface-variant">
          <span>{{ T.total }}</span>
          <span class="ml-auto shrink-0 nums">{{ T.playersTotal(status.players.listeners, status.players.queued) }}</span>
        </div>
      </BaseCard>
      <!-- 넓을 때(2열)는 옆 카드(활성 플레이어)의 높이를 따르고 제 높이로 행을 늘리지 않는다(h-0, min-h-full). 넘치는 행은 목록 영역 안에서 스크롤된다.
           1열일 때는 카드 높이를 활성 플레이어 카드와 같게(잰 높이 --player-card-h). 열 헤더는 스크롤되지 않게 따로 두고, 행과 같은 고정 열 폭으로 맞춘다 -->
      <BaseCard ref="processCardEl" icon="terminal" :title="T.processes" data-at="processes" class="flex flex-col h-(--player-card-h) @4xl/content:h-0 @4xl/content:min-h-full" :style="{ '--player-card-h': `${playerCardHeight}px` }">
        <template v-if="status.processes.total">
          <!-- 열 헤더를 누르면 그 열로 행을 정렬한다(다시 누르면 거꾸로). 정렬한 열은 글자를 진하게 하고 화살표를 붙인다(오른쪽 맞춤 열은 화살표가 앞) -->
          <!-- 좁은 카드(448px 미만)는 PID, 실행 시간 열을 헤더에서 빼고 행 아래에 작게 둔다(작업 열 폭이 모자란다) -->
          <div :class="PROCESS_GRID" class="pb-1 text-xs text-on-surface-variant">
            <button v-for="c in PROCESS_COLUMNS" :key="c.key" type="button" class="flex items-center gap-1 min-w-0 cursor-pointer hover:text-on-surface" :class="[c.right && 'justify-end', processSort.key === c.key && 'text-on-surface font-semibold', (c.key === 'pid' || c.key === 'age') && '@max-md/card:hidden']" :aria-label="T.sortBy(c.label)" @click="sortProcessesBy(c.key)">
              <Icon v-if="c.right && processSort.key === c.key" :name="processSort.desc ? 'arrow_downward' : 'arrow_upward'" :size="14" /><span class="truncate">{{ c.label }}</span
              ><Icon v-if="!c.right && processSort.key === c.key" :name="processSort.desc ? 'arrow_downward' : 'arrow_upward'" :size="14" />
            </button>
          </div>
          <!-- 넘치면 영역 오른쪽을 카드 끝까지 넓혀 스크롤바가 가장자리에서 3px 떨어지게(플레이어 목록과 같다). 늘린 만큼 안쪽 여백으로 행을 열 헤더에 맞춘다.
               보이는 행 둘레만 그린다(플레이어 목록과 같다). 그래서 행 높이를 고정한다: 좁은 카드는 두 줄 48px, 넓으면 한 줄 32px -->
          <div ref="processListEl" class="flex-1 min-h-0 overflow-y-auto mb-3" :class="processListOverflowing && '-mr-4 pr-1.5'" :style="processFade">
            <!-- 스페이서 높이는 안쪽 상자에(스크롤 영역에 두면 그 여백이 줄어들지 않아 영역이 내용만큼 커진다) -->
            <div :style="{ paddingTop: `${processTop}px`, paddingBottom: `${processBottom}px` }">
              <template v-for="{ key, row: p } in processSlots" :key="key">
                <div v-if="!p" :class="PROCESS_GRID" class="h-12 @md/card:h-8" aria-hidden="true"><span class="col-span-full h-3 w-1/2 rounded-sm bg-on-surface/8" /></div>
                <div v-else :class="PROCESS_GRID" class="h-12 content-center @md/card:h-8 text-sm">
                  <span class="hidden @md/card:block font-mono text-xs nums">{{ p.pid }}</span>
                  <span class="font-mono text-xs" :class="p.label === 'yt-dlp' && 'text-tertiary'">{{ p.label }}</span>
                  <!-- 길면 옆으로 흐르고(마퀴) 툴팁으로 전체를(잔류 프로세스는 까닭 툴팁) -->
                  <span class="min-w-0 flex items-center gap-1" :class="p.stray && LEVEL_TEXT.warn" v-tooltip="p.stray ? ORPHAN_TIP : null"><Icon v-if="p.stray" :name="LEVEL_ICON.warn" :size="14" fill class="shrink-0" /><MarqueeText class="min-w-0 flex-1" :text="processJob(p)" :tip="!p.stray" /></span>
                  <span class="hidden @md/card:block text-xs nums text-right" :class="p.stray && LEVEL_TEXT.warn">{{ formatDuration(p.ageMs / 1000, "0:00") }}</span>
                  <!-- 메모리는 서버가 15초마다 잰다. 막 뜬 프로세스는 아직 없다 -->
                  <span class="text-xs nums text-right">{{ p.memMb === null ? "—" : `${p.memMb} MB` }}</span>
                  <!-- 좁은 카드: PID, 실행 시간을 아래 줄에 -->
                  <span class="@md/card:hidden col-span-full -mt-0.5 font-mono text-xs nums text-on-surface-variant" :class="p.stray && LEVEL_TEXT.warn">PID {{ p.pid }} · {{ formatDuration(p.ageMs / 1000, "0:00") }}</span>
                </div>
              </template>
            </div>
          </div>
        </template>
        <div v-else class="py-3 text-sm text-on-surface-variant">{{ T.noProcesses }}</div>
        <!-- 합계는 카드 맨 아래에 붙인다(옆 카드에 맞춰 늘어난 높이의 바닥). 구분선은 한 줄로. 그 아래 yt-dlp 줄(올리면 지난 1시간 영상 정보 읽기 수) -->
        <div class="mt-auto flex flex-col gap-1 pt-3 border-t border-outline-variant/40 text-xs text-on-surface-variant">
          <div v-if="status.processes.total" class="flex items-baseline gap-3">
            <span class="min-w-0 truncate">{{ T.processesTotal(status.processes.total, status.processes.byLabel.map((b) => `${b.label} ${b.count}`).join(" · ")) }}</span>
            <span class="ml-auto shrink-0 nums">{{ status.processes.memMb }} MB</span>
          </div>
          <span class="self-start max-w-full flex items-center gap-0.5 cursor-help" :class="ytdlp.nearLimit && LEVEL_TEXT.warn" v-tooltip="T.ytdlpLoadTip(ytdlp.extractedLastHour, ytdlp.reused, ytdlp.missed)"
            ><span class="min-w-0 truncate nums">{{ T.ytdlpLoad(`${ytdlp.lookup.running}/${ytdlp.lookup.size}`, `${ytdlp.background.running}/${ytdlp.background.size}`, ytdlp.lookup.waiting + ytdlp.background.waiting) }}</span
            ><Icon name="info" :size="14" class="shrink-0"
          /></span>
        </div>
      </BaseCard>
      <!-- 인코딩 워커: 인코딩 응답 시간 카드가 "괜찮은가"면 여기는 "왜". 워커마다 맡은 재생, CPU(코어 하나 기준), 응답 시간 p99 와 응답 한도(응답이 그 안에 와야 소리가 끊기지 않는 시간, (큐 깊이 − 1) × 20ms).
           막대는 응답 시간이 응답 한도를 얼마나 쓰는지. 큐 깊이를 끝까지 올린 워커만 주의, 문제로 칠한다(덜 올렸으면 풀이 더 올린다) -->
      <BaseCard icon="memory" :title="T.workers.title(status.encoding.workers.length)" data-at="workers">
        <div class="flex flex-col gap-3">
          <div v-for="w in workerRows" :key="w.n">
            <div class="flex items-baseline gap-2 text-sm">
              <span>{{ T.workers.worker(w.n) }}</span>
              <div class="flex flex-1 flex-col items-end min-w-0 @min-[20rem]/card:flex-row @min-[20rem]/card:items-baseline @min-[20rem]/card:gap-2">
                <span class="text-xs text-on-surface-variant nums">{{ w.detail }}</span>
                <span class="text-xs nums @min-[20rem]/card:ml-auto" :class="LEVEL_TEXT[w.level]"
                  ><span v-for="(text, i) in w.rtt" :key="i" :class="AT_WORKER[i]">{{ text }}</span></span
                >
              </div>
            </div>
            <div class="h-2 mt-1 rounded-full bg-(--store-free) overflow-hidden">
              <div class="h-full rounded-full" :class="LEVEL_BAR[w.level]" :style="{ width: `${Math.max(2, w.ratio * 100)}%` }"></div>
            </div>
          </div>
          <div v-if="!workerRows.length" class="text-sm text-on-surface-variant">{{ T.workers.none }}</div>
          <dl class="flex flex-col gap-1 text-sm pt-3 border-t border-outline-variant/40">
            <div v-for="[k, v] in workerSummary" :key="k" class="flex items-baseline justify-between gap-3">
              <dt class="shrink-0 text-on-surface-variant">{{ k }}</dt>
              <dd class="min-w-0 nums text-right">{{ v }}</dd>
            </div>
          </dl>
        </div>
      </BaseCard>
      <ReuseStorage v-if="!storageBeside" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { createReusableTemplate, useElementSize, watchDebounced } from "@vueuse/core";
import { RouterLink } from "vue-router";
import BaseButton from "./BaseButton.vue";
import BaseCard from "./BaseCard.vue";
import BotRestart from "./BotRestart.vue";
import Icon from "./BaseIcon.vue";
import GuildAvatar from "./GuildAvatar.vue";
import MarqueeText from "./MarqueeText.vue";
import SparkChart from "./SparkChart.vue";
import SearchInput from "./SearchInput.vue";
import { rem } from "../utils/rem.ts";
import { useOverflowing } from "../composables/overflowing.ts";
import { useScrollFade } from "../composables/scroll-fade.ts";
import { slotsOf, useRowWindow } from "../composables/row-window.ts";
import { FILTER_CHIP, FILTER_CHIP_OFF, FILTER_CHIP_ON } from "../utils/filter-chip.ts";
import { SEARCH_FIELD } from "../utils/field.ts";
import { byteUnit, formatBytes, formatDuration, formatSpan, scaledText } from "../../../src/ui/format.ts";
import { PLAYER_STATES, Q_MAX, type AdminStatus, type LinkRow, type LinkState, type PlayerRow, type PlayerState, type ProcessRow, type ProcessSort, type Span, type StatusQuery } from "../../../src/dashboard/contract/admin.ts";
import type { IconName } from "../icons.ts";
import { formatClock, formatNumber } from "../utils/locale.ts";
import { axisMax, bitRate, byteRate, count, fixed, time, type Scale } from "../utils/units.ts";
import { text } from "../text/index.ts";
const T = text.status;

// query: 목록(플레이어, 자식 프로세스)의 구간, 필터링, 정렬. 바꾸면 운영자 패널이 바로 받는다
const props = defineProps<{ status: AdminStatus; updatedAt: number | null; stale: boolean }>();
const query = defineModel<StatusQuery>("query", { required: true });
const emit = defineEmits<{ openLogs: []; openDb: [] }>();

// ── 판정, 모양 ──
type Level = "ok" | "warn" | "bad";
const levelOf = (v: number, warn: number, bad: number): Level => (v >= bad ? "bad" : v >= warn ? "warn" : "ok");
const LEVEL_ICON: Record<Level, IconName> = { ok: "check_circle", warn: "warning", bad: "cancel" };
const LEVEL_TEXT: Record<Level, string> = { ok: "", warn: "text-(--warn-ink)", bad: "text-error" };
const LEVEL_GRAPH: Record<Level, string> = { ok: "text-primary", warn: "text-(--warn-ink)", bad: "text-error" };
const LEVEL_BAR: Record<Level, string> = { ok: "bg-primary", warn: "bg-(--warn-ink)", bad: "bg-error" };
// 주의는 어디서나 노랑 계열(--warn-ink: 밝기마다 바탕 대비 4.5:1 이상인 노랑). M3 에 경고 색 역할이 없어 칩 바탕은 그 색을 옅게 섞는다
const WARN_FILL = "bg-(--warn-ink)/15 text-(--warn-ink)";
const LEVEL_BADGE: Record<Level, string> = { ok: "bg-primary-container text-on-primary-container", warn: WARN_FILL, bad: "bg-error-container text-on-error-container" };
const LEVEL_CHIP: Record<Level, string> = { ok: "", warn: WARN_FILL, bad: "bg-error-container text-on-error-container" };

/** 기준(주의, 문제). 핑 ms, 루프 지연 ms, heap, CPU, 디스크 % */
// 핑: 디스코드 서버가 미국이라 한국에서는 190 ~ 200ms 가 보통이고 멀쩡해도 200ms 중후반이 자주 뜬다
const LIMITS = { ping: [210, 300], loop: [50, 100], heap: [80, 95], cpu: [70, 90], disk: [90, 98] } as const;

// ── 글 ──
const clock = (ms: number, seconds = false) => formatClock(ms, { seconds });
// 시간(ms). 1초부터 초(소수 한 자리), 그 아래는 받은 자릿수 그대로(utils/units)
const timeParts = (ms: number) => {
  const s = time(ms);
  return { value: s.unit === "ms" ? String(s.n) : s.n.toFixed(1), unit: s.unit };
};
const timeText = (ms: number) => {
  const { value, unit } = timeParts(ms);
  return `${value}${unit}`;
};
const MB = 1024 ** 2;
const toGB = (bytes: number) => bytes / 1024 ** 3;
// 크기: 단위는 크기에 맞게(MB, GB, TB, src/ui/format 의 byteUnit), 100 이상은 정수, 아래는 소수 한 자리(소수가 0 이면 뗀다: 10.0 → 10)
const sizeText = (bytes: number) => {
  const { value, unit } = scaledText(bytes, byteUnit, (n) => (n >= 100 ? 0 : 1));
  return `${value.replace(/\.0$/, "")} ${unit}`;
};
/** 소수 자릿수를 정한 크기("1.60 GB") */
const sizeFixed = (bytes: number, digits: number) => {
  const { value, unit } = scaledText(bytes, byteUnit, () => digits);
  return `${value} ${unit}`;
};
/** 크기 둘을 큰 쪽(whole)의 단위 하나로("18.3 / 20 GB") */
const sizePair = (part: number, whole: number, partDigits: number, wholeDigits = partDigits) => {
  const { value, unit, per } = scaledText(whole, byteUnit, () => wholeDigits);
  return `${(part / per).toFixed(partDigits)} / ${value} ${unit}`;
};
const toMBps = (bps: number) => bps / 1024 ** 2;
const downloadParts = (bps: number) => scaledText(toMBps(bps), byteRate, () => 1);
// 업로드는 회선 속도처럼 비트로(kbps, Mbps, Gbps). kbps 는 정수, 100 이상은 정수, 그 아래는 소수 한 자리
const toMbps = (bps: number) => (bps * 8) / 1e6;
const rateParts = (bps: number) => scaledText(toMbps(bps), bitRate, (n, unit) => (unit === "kbps" || n >= 100 ? 0 : 1));
const rateText = (bps: number) => {
  const { value, unit } = rateParts(bps);
  return `${value} ${unit}`;
};
/** 크기를 정수로(좁은 카드). 반올림으로 단위 경계를 넘으면 단위도 올린다 */
const bytesWhole = (bytes: number) => {
  const { value, unit } = scaledText(bytes, byteUnit, () => 0);
  return `${value} ${unit}`;
};
/** 정수로(좁은 카드). 반올림으로 단위 경계를 넘으면 단위도 올린다 */
const rateTextWhole = (bps: number) => {
  const { value, unit } = scaledText(toMbps(bps), bitRate, () => 0);
  return `${value} ${unit}`;
};
/** 휴대폰 폭 카드: 정수로 쓰되 places 자리가 되면 한 단위(step 배) 올려 소수 한 자리(100 Mbps → 0.1 Gbps, 1023 GB → 1.0 TB) */
function shortParts(v: number, pick: Scale, step: number, places: number) {
  const whole = scaledText(v, pick, () => 0);
  const up = pick(whole.per * step);
  return whole.value.length < places || up.unit === whole.unit ? whole : { value: (v / up.per).toFixed(1), unit: up.unit, per: up.per };
}
const rateShort = (bps: number) => shortParts(toMbps(bps), bitRate, 1000, 3);
const rateTextShort = (bps: number) => {
  const { value, unit } = rateShort(bps);
  return `${value} ${unit}`;
};
const bytesTextShort = (bytes: number) => {
  const { value, unit } = shortParts(bytes, byteUnit, 1024, 4);
  return `${value} ${unit}`;
};
/** 크기 둘을 큰 쪽의 휴대폰 폭 카드 글(네 자리면 단위를 올려 소수 한 자리)에 맞춰("1.0 / 1.0 GB") */
const sizePairShort = (part: number, whole: number) => {
  const { value, unit, per } = shortParts(whole, byteUnit, 1024, 4);
  return `${(part / per).toFixed(value.includes(".") ? 1 : 0)} / ${value} ${unit}`;
};
// 개수를 줄여서: 1000 부터 k, M 에 소수 한 자리(2,499 → 2.5k, 112,455,000 → 112.5M)
const countParts = (n: number) => scaledText(n, count, (_, unit) => (unit ? 1 : 0));
const countText = (n: number) => {
  const { value, unit } = countParts(n);
  return `${value}${unit}`;
};
/** 시간을 정수 ms 로(초는 소수 한 자리 그대로) */
const timeWhole = (ms: number) => scaledText(ms, time, (_, unit) => (unit === "ms" ? 0 : 1));

// 주의 칩을 누르면 그 항목으로 가서 M3 포커스 표시기(Material Web md-focus-ring)를 표시한다: 두께 3px, 바깥 간격 2px, secondary,
// 나타날 때 600ms(long4) 중 1/4 은 0 → 8px 로 두꺼워지고 3/4 은 3px 로 줄어든다(emphasized). 스크롤이 멎은 뒤 시작해 잠깐 두고 지운다
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
  // 스크롤되면 멎을 때까지 기다린다(이미 보이는 위치라 스크롤되지 않으면 바로)
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

// 저장공간 카드 위치: 내용 영역이 STORAGE_BESIDE_REM 이상이면 연결 카드 옆(연결 카드 2열이 설명을 덜 자르고 남는 폭).
// rem 이라 브라우저 기본 글자 크기를 키우면 기준도 같이 커진다(다른 배치 기준인 컨테이너 쿼리와 같다)
const STORAGE_BESIDE_REM = 84;
const [DefineStorage, ReuseStorage] = createReusableTemplate();
const { width: rootWidth } = useElementSize(root);
const storageBeside = computed(() => rootWidth.value >= rem(STORAGE_BESIDE_REM));
// 임계값에서의 폭: 저장공간 22rem, 연결은 나머지(사이 틈 --gap-in 0.75rem). 늘림을 기준 폭과 같게 두면 넓어질수록 그 비율대로 함께 커진다
const STORAGE_CARD_REM = 22;
const LINK_CARD_REM = STORAGE_BESIDE_REM - STORAGE_CARD_REM - 0.75;
const flexFromBase = (base: number) => ({ flex: `${base} 1 ${base}rem` });

// ── ③ 지금 ──
// 모은 구간이 덮는 시간(분). 봇을 켠 지 1분이 안 됐어도 "0분"이 아니라 1분으로
const historyMinutes = computed(() => Math.max(1, Math.round((props.status.history.stepMs * props.status.history.ping.length) / 60_000)));

// 카드 너비에 따라 바꿔 보일 글의 경계: 좁은 버전부터 넓은 버전까지의 클래스. 모바일 먼저라 기본은 가장 좁은 버전이고 카드 안쪽이 경계 이상이면 다음 버전.
// 경계는 끝 줄 주석의 화면 폭(휴대폰, 사이드바를 접은 데스크톱 네 칸)에서의 카드 안쪽 너비다
const AT_PHONE = ["@min-[12.02rem]/metric:hidden", "hidden @min-[12.02rem]/metric:inline"] as const; // 핑, 루프 지연, 인코딩 응답 시간(480px)
const AT_PING = ["@min-[11.08rem]/metric:hidden", "hidden @min-[11.08rem]/metric:inline"] as const; // 핑 보조 텍스트 두 줄(450px)
const AT_BIG = ["@min-[12.02rem]/metric:hidden", "hidden @min-[12.02rem]/metric:inline @min-[13.6rem]/metric:hidden", "hidden @min-[13.6rem]/metric:inline"] as const; // 업로드 큰 숫자(480px, 1220px)
const AT_SYSTEM = ["@min-[12.02rem]/metric:hidden", "hidden @min-[12.02rem]/metric:inline @min-[13.21rem]/metric:hidden", "hidden @min-[13.21rem]/metric:inline"] as const; // 업로드 시스템(480px, 1195px)
const AT_TODAY = ["@min-[12.02rem]/metric:hidden", "hidden @min-[12.02rem]/metric:inline @min-[12.2rem]/metric:hidden", "hidden @min-[12.2rem]/metric:inline"] as const; // 업, 다운 오늘(480px, 1130px)
const AT_HEAP = ["@min-[11.08rem]/metric:hidden", "hidden @min-[11.08rem]/metric:inline @min-[12.2rem]/metric:hidden", "hidden @min-[12.2rem]/metric:inline @min-[13.13rem]/metric:hidden", "hidden @min-[13.13rem]/metric:inline"] as const; // heap 보조 텍스트(450px, 1130px, 1190px)
const AT_DOWNLOAD = ["@min-[10.14rem]/metric:hidden", "hidden @min-[10.14rem]/metric:inline @min-[13.6rem]/metric:hidden", "hidden @min-[13.6rem]/metric:inline"] as const; // 다운로드 큰 숫자(420px, 1220px)
const AT_SMALL = ["@min-[10.14rem]/metric:hidden", "hidden @min-[10.14rem]/metric:inline"] as const; // 재생 중, 루프 지연 제목(420px)
/** 카드 너비에 따라 바꿔 보일 글: 좁은 버전부터 넓은 버전까지와 그 버전들의 클래스(AT_…). tips: 버전마다 숫자의 툴팁 */
type Stepped = { texts: string[]; at: readonly string[]; tips?: (string | null)[] };
type Text = string | Stepped;
/** 보조 텍스트 한 줄: 말 + 숫자(툴팁은 숫자에만) */
type Line = { label: string; num: Text };
const stepsOf = (t: Text) => (typeof t === "string" ? [{ text: t, cls: "", tip: null }] : t.texts.map((text, i) => ({ text, cls: t.at[i], tip: t.tips?.[i] ?? null })));
const lineOf = (t: Text | Line): Line => (typeof t === "object" && "label" in t ? t : { label: "", num: t });
const TIP = "underline decoration-dotted underline-offset-2 cursor-help";
// 줄여 쓴 글이 값을 알아볼 만큼 바꾸면 툴팁으로 가장 넓은 버전의 글: 단위가 바뀌었거나(k, M 포함) 같은 단위에서 5% 넘게 다를 때
const unitOf = (t: string) => /[^\d.,\s/]+$/.exec(t)?.[0] ?? "";
const numsOf = (t: string) => (t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
function tipFor(shown: string, full: string) {
  if (shown === full) return null;
  if (unitOf(shown) !== unitOf(full)) return full;
  const got = numsOf(shown);
  return numsOf(full).some((n, i) => Math.abs((got[i] ?? 0) - n) > Math.abs(n) * 0.05) ? full : null;
}
/** 버전마다 가장 넓은 버전(마지막)과 비교해 툴팁을 단다 */
const withTips = (s: Stepped): Stepped => ({ ...s, tips: s.texts.map((t) => tipFor(t, s.texts[s.texts.length - 1])) });
/** 버전마다의 큰 숫자, 단위를 큰 숫자(value) 필드와 단위(unit) 필드로 나눈다(툴팁은 큰 숫자에) */
const splitSteps = (parts: { value: string; unit: string }[], at: readonly string[]) => {
  const text = (p: { value: string; unit: string }) => `${p.value} ${p.unit}`.trim();
  const full = text(parts[parts.length - 1]);
  return { value: { texts: parts.map((p) => p.value), at, tips: parts.map((p) => tipFor(text(p), full)) }, unit: { texts: parts.map((p) => p.unit), at } };
};
/**
 * stat: 큰 숫자가 어떤 값인지(p99 등). 제목 뒤에 붙인다(주의 칩에는 제목만). short: 좁은 카드(AT_SMALL)의 제목, 툴팁으로 제목을 보인다. markTop: 둘째 선 표시를 위 줄에.
 * subUp: 좁은 카드(안쪽 9.2rem 아래, 390px)에서 한 줄 보조 텍스트를 위 줄에. 아래 줄에 빈 줄을 두어 베이스라인 맞춤은 그대로
 */
type Metric = { title: string; short?: string; subUp?: boolean; stat?: string; value: Text; unit: Text; sub: Text | Line; subTop?: Text | Line; markTop?: boolean; series: number[]; second?: number[]; max: number; warn?: number; scale: Scale; level: Level; word: string; why: string };
const metrics = computed<Metric[]>(() => {
  const { status } = props;
  const h = status.history;
  const heapPct = (status.node.memory.heapUsed / status.node.memory.heapLimit) * 100;
  const { counts } = status.players;
  const playing = counts.playing;
  const connected = counts.playing + counts.paused + counts.idle;
  const pingAvg = Math.round(h.ping.reduce((a, b) => a + b, 0) / Math.max(1, h.ping.length));
  const ping = timeParts(status.bot.ping);
  const loop = timeParts(status.loop.p99);
  const download = downloadParts(status.download.bytesPerSec);
  // 좁은 카드는 정수로(반올림으로 단위 경계를 넘으면 단위도 올린다)
  const loopWhole = timeWhole(status.loop.p99);
  const loopMaxWhole = timeWhole(status.loop.max);
  const downloadNarrow = scaledText(toMBps(status.download.bytesPerSec), byteRate, () => 0);
  const uploadNarrow = scaledText(toMbps(status.upload.bot), bitRate, () => 0);
  const uploadPhone = rateShort(status.upload.bot);
  const todayLine = (label: string, bytes: number): Line => ({ label, num: withTips({ texts: [bytesTextShort(bytes), bytesWhole(bytes), formatBytes(bytes)], at: AT_TODAY }) });
  const downloadSeries = h.downloadBps.map(toMBps);
  const upload = rateParts(status.upload.bot);
  const uploadSecond = status.upload.system === null ? undefined : h.uploadSystem.map(toMbps);
  const uploadSeries = h.uploadBot.map(toMbps);
  return [
    {
      title: T.metrics.playing,
      ...(playing >= 1000 ? splitSteps([countParts(playing), { value: formatNumber(playing), unit: "" }], AT_SMALL) : { value: formatNumber(playing), unit: "" }),
      sub: { label: T.metrics.playingSub, num: connected >= 1000 ? withTips({ texts: [countText(connected), formatNumber(connected)], at: AT_SMALL }) : formatNumber(connected) },
      series: h.playing,
      max: Math.max(1, connected),
      scale: fixed(""),
      level: "ok",
      word: "",
      why: "",
    },
    { title: T.metrics.ping, ...splitSteps([scaledText(status.bot.ping, time, () => 0), ping], AT_PHONE), sub: { texts: [true, false].map((lines) => T.metrics.pingSub(historyMinutes.value, timeText(pingAvg), lines)), at: AT_PING }, series: h.ping, max: axisMax(peak(h.ping), 300, time), warn: LIMITS.ping[0], scale: time, level: levelOf(status.bot.ping, ...LIMITS.ping), word: T.attention.high, why: "" },
    {
      title: T.metrics.loop,
      short: T.metrics.loopShort,
      stat: T.metrics.p99,
      ...splitSteps([loopWhole, loop], AT_PHONE),
      sub: { label: T.metrics.loopSub, num: withTips({ texts: [`${loopMaxWhole.value}${loopMaxWhole.unit}`, timeText(status.loop.max)], at: AT_PHONE }) },
      series: h.loopP99,
      max: axisMax(peak(h.loopP99), 100, time),
      warn: LIMITS.loop[0],
      scale: time,
      level: levelOf(status.loop.p99, ...LIMITS.loop),
      word: T.attention.lagging,
      why: "",
    },
    encodingMetric(status.encoding, h.encodeRtt, h.encodeLate),
    { title: T.metrics.cpu, subUp: true, value: `${status.cpu.bot}`, unit: "%", sub: T.metrics.cpuSub(status.cpu.system), series: h.cpuBot, second: h.cpuSystem, max: 100, warn: LIMITS.cpu[0], scale: fixed("%"), level: levelOf(status.cpu.bot, ...LIMITS.cpu), word: T.attention.high, why: "" },
    {
      title: T.metrics.heap,
      value: heapPct.toFixed(0),
      unit: "%",
      subTop: { label: "RSS", num: withTips({ texts: [bytesTextShort(status.node.memory.rss * MB), ...[0, 1, 2].map((digits) => sizeFixed(status.node.memory.rss * MB, digits))], at: AT_HEAP }) },
      sub: withTips({ texts: [sizePairShort(status.node.memory.heapUsed * MB, status.node.memory.heapLimit * MB), ...[0, 1, 2].map((digits) => sizePair(status.node.memory.heapUsed * MB, status.node.memory.heapLimit * MB, digits))], at: AT_HEAP }),
      series: h.heapPct,
      max: 100,
      warn: LIMITS.heap[0],
      scale: fixed("%"),
      level: levelOf(heapPct, ...LIMITS.heap),
      word: T.attention.high,
      why: "",
    },
    {
      title: T.metrics.upload,
      ...splitSteps([uploadPhone, uploadNarrow, upload], AT_BIG),
      // 아래 줄은 오늘 보낸 양, 위 줄은 시스템 전체 송신(둘째 선). 시스템을 재지 못하면 위 줄이 없다
      sub: todayLine(T.metrics.uploadToday, status.upload.todayBytes),
      ...(status.upload.system === null ? {} : { subTop: { label: T.metrics.uploadSystem, num: withTips({ texts: [rateTextShort(status.upload.system), rateTextWhole(status.upload.system), rateText(status.upload.system)], at: AT_SYSTEM }) }, markTop: true }),
      series: uploadSeries,
      second: uploadSecond,
      max: axisMax(peak(uploadSeries, uploadSecond), 1, bitRate),
      scale: bitRate,
      level: "ok",
      word: "",
      why: [T.metrics.uploadParts(rateText(status.upload.voice), rateText(status.upload.dashboard)), status.upload.system === null ? T.metrics.uploadNoSystem : ""].filter(Boolean).join("\n"),
    },
    { title: T.metrics.download, ...splitSteps([shortParts(toMBps(status.download.bytesPerSec), byteRate, 1024, 3), downloadNarrow, download], AT_DOWNLOAD), subTop: T.metrics.downloadActive(status.download.active), sub: todayLine(T.metrics.downloadToday, status.download.todayBytes), series: downloadSeries, max: axisMax(peak(downloadSeries), 5, byteRate), scale: byteRate, level: "ok", word: "", why: "" },
  ];
});

// 인코딩 응답 시간: 가장 늦은 워커의 응답 시간 p99. 응답은 응답 한도((큐 깊이 − 1) × 20ms) 안에 와야 하고, 큐 깊이를 상한까지 올린 워커가 그 80%를 넘으면 주의, 한도를 넘기면 문제(누락 프레임).
// 보조 텍스트는 최근 15분 누락 프레임 수(0 이어도). 한도는 고정값이라 글로 쓰지 않는다(그래프의 최소 상한, 주의 선이 보인다). 워커마다의 값은 인코딩 워커 카드에
const FRAME_MS = 20;
/** 그래프 세로축의 상한을 정할 최고값(15분) */
const peak = (...series: Array<number[] | undefined>) => Math.max(0, ...series.flatMap((s) => s ?? []));
function encodingMetric(e: AdminStatus["encoding"], series: number[], lateSeries: number[]): Metric {
  const budget = (e.maxDepth - 1) * FRAME_MS;
  const late = lateSeries.reduce((a, b) => a + b, 0);
  const worstAtMax = Math.max(0, ...e.workers.filter((w) => w.depth >= e.maxDepth).map((w) => w.rttP99));
  const worstMs = Math.max(0, ...e.workers.map((w) => w.rttP99));
  return {
    title: T.metrics.encoding,
    stat: T.metrics.p99,
    ...splitSteps([timeWhole(worstMs), timeParts(worstMs)], AT_PHONE),
    // 위 줄에 말, 아래 줄에 수. 수는 늘 줄여 쓰고(112.5M) 줄였으면 숫자에 툴팁으로 전체
    subTop: T.metrics.encodingLate,
    sub: { label: "", num: { texts: [countText(late)], at: [""], tips: [tipFor(countText(late), formatNumber(late))] } },
    series,
    max: axisMax(peak(series), budget, time),
    warn: budget * 0.8,
    scale: time,
    level: levelOf(worstAtMax, budget * 0.8, budget),
    word: T.attention.high,
    why: "",
  };
}

// 인코딩 워커 카드: 워커 수는 제목에, 워커마다 한 줄, 아래에 워커 상한, 켜진 뒤 누계.
// 세션 수는 싣지 않는다(워커마다의 재생 수를 더한 것, 새는 세션은 GC 안전망이 warn 로그로 알린다)
// 응답 시간: 카드 안쪽이 320px(휴대폰 386px) 보다 좁으면 재생, 코어와 함께 오른쪽에 두 줄로 쌓고, 320~336px(휴대폰 402px)에서만 한 줄에 넣으려고 ms 를 정수로
const AT_WORKER = ["hidden @min-[20rem]/card:inline @min-[21rem]/card:hidden", "@min-[20rem]/card:hidden @min-[21rem]/card:inline"] as const;
const wholeText = (ms: number) => {
  const { value, unit } = timeWhole(ms);
  return `${value}${unit}`;
};
const workerRows = computed(() => {
  const e = props.status.encoding;
  const budget = (e.maxDepth - 1) * FRAME_MS;
  return e.workers.map((w) => {
    const limit = (w.depth - 1) * FRAME_MS;
    return {
      n: w.n,
      detail: [T.workers.streams(w.streams), w.cpuPct === null ? "" : T.workers.cpu(w.cpuPct)].filter(Boolean).join(" · "),
      rtt: [T.workers.rtt(wholeText(w.rttP99), wholeText(limit)), T.workers.rtt(timeText(w.rttP99), timeText(limit))],
      ratio: Math.min(1, w.rttP99 / limit),
      level: w.depth >= e.maxDepth ? levelOf(w.rttP99, budget * 0.8, budget) : ("ok" as Level),
    };
  });
});
const workerSummary = computed(() => {
  const e = props.status.encoding;
  return [
    [T.workers.limit, [String(e.max), e.quota === null ? "" : T.workers.quota(e.quota)].filter(Boolean).join(" · ")],
    [T.workers.lateTotal, formatNumber(e.late)],
    [T.workers.deaths, formatNumber(e.deaths)],
  ];
});

// ── ② 연결 ──
const LINK_WORD: Record<LinkState, string> = T.linkWords;
const LINK_ICON: Record<LinkState, IconName> = { ok: "check_circle", slow: "warning", fail: "cancel", idle: "schedule", off: "block" };
const LINK_ICON_FILLED: Record<LinkState, boolean> = { ok: true, slow: true, fail: true, idle: false, off: false };
const LINK_TEXT: Record<LinkState, string> = { ok: "text-(--ok-ink)", slow: "text-(--warn-ink)", fail: "text-error", idle: "text-on-surface-variant", off: "text-on-surface-variant" };
// 셀 너비를 그룹, 열과 상관없이 고정해 이름, 마지막 성공, 응답이 위아래로 줄을 맞춘다(이름은 가장 긴 "SponsorBlock" 이 들어가게)
/** 클라이언트 상자의 윗선 조각: 행 가운데 높이에서 시작해 아래로 이어진다 */
const CLIENT_BOX_EDGE = "self-end h-2.5 border-t border-outline-variant/60";
const LINK_GRID = "grid grid-cols-1 @md/card:grid-cols-[8.5rem_minmax(0,1fr)_6.5rem_3.5rem] gap-x-3";
// 좁은 카드: 헤더, 행마다 제 격자(이름 | 마지막 성공 | 응답, 설명은 아래 줄). 넓으면 contents 로 바깥 네 열 격자에 그대로 든다
const LINK_NARROW = "grid grid-cols-[minmax(0,1fr)_6.5rem_3.5rem] items-center gap-x-3 @md/card:contents";
const COOKIE_WORD = T.cookieSources;
/** whenFull: "마지막 성공"을 줄여 보였을 때(약 …)만 전체 길이 */
type LinkLine = { name: string; state: LinkState; detail: string; when: string; whenFull?: string | null; value: string; hint?: string | null };
/**
 * 지난 때를 큰 단위 둘까지만 "2시간 8분 전" 형식으로(0인 단위는 뺀다). 그 아래 단위가 남으면 앞에 "약"을 붙이고 전체("2시간 8분 13초 전")는 full 로.
 * 셀 너비가 "약 23시간 59분 전"까지만 받으면 되게 하려는 것
 */
function sinceText(at: number): { short: string; full: string | null } {
  const elapsedSec = Math.floor((Date.now() - at) / 1000);
  if (elapsedSec < 5) return { short: T.justNow, full: null };
  const units: Array<[number, string]> = [
    [Math.floor(elapsedSec / 86400), T.unitNames.day],
    [Math.floor((elapsedSec % 86400) / 3600), T.unitNames.hour],
    [Math.floor((elapsedSec % 3600) / 60), T.unitNames.minute],
    [elapsedSec % 60, T.unitNames.second],
  ];
  const top = units.findIndex(([n]) => n > 0);
  const say = (list: Array<[number, string]>) =>
    list
      .filter(([n]) => n > 0)
      .map(([n, u]) => `${n}${u}`)
      .join(" ");
  const cut = units.slice(top + 2).some(([n]) => n > 0);
  const short = T.ago(say(units.slice(top, top + 2)));
  return cut ? { short: T.about(short), full: T.ago(say(units)) } : { short, full: null };
}
// 마지막 성공, 응답 셀이 비면 화면이 "-" 를 넣는다(설명 셀은 비워 둔다)
function toLinkLine(c: LinkRow): LinkLine {
  if (c.state === "off") return { name: c.name, state: c.state, detail: T.unused, when: "", value: "" };
  if (c.id === "discord") return { ...measuredLinkLine(c), detail: discordDetail() };
  return measuredLinkLine(c);
}
/** 디스코드 API 행의 설명: 끊겨 있으면 몇 번째 시도인지, 연결돼 있으면 켜진 뒤 재연결 횟수(0 이면 비운다) */
function discordDetail() {
  const { reconnects, retryAttempt } = props.status.bot;
  if (retryAttempt !== null) return T.retrying(retryAttempt);
  return reconnects > 0 ? T.reconnected(reconnects) : "";
}
function measuredLinkLine(c: LinkRow): LinkLine {
  const value = c.state === "fail" ? (c.error ?? T.failed) : c.latencyMs === null ? "" : timeText(c.latencyMs);
  const when = c.lastOkAt ? sinceText(c.lastOkAt) : null;
  return { name: c.name, state: c.state, detail: c.note ?? "", when: when?.short ?? "", whenFull: when?.full, value, hint: c.hint };
}
const linkGroups = computed(() => {
  const { links, youtube } = props.status;
  const of = (group: LinkRow["group"]) => links.filter((c) => c.group === group).map(toLinkLine);
  // 쿠키는 부르는 곳이 아니라 파일, 브라우저라 응답이 없다. 유효한지는 쓸 때만 알 수 있다
  const cookie: LinkLine = youtube.cookies === "none" ? { name: T.cookies, state: "off", detail: T.noCookies, when: "", value: "" } : { name: T.cookies, state: "ok", detail: COOKIE_WORD[youtube.cookies], when: "", value: "" };
  return [
    { title: T.groups.play, critical: true, items: of("play") },
    { title: T.groups.youtube, critical: true, youtube: true, items: [...of("youtube"), cookie] },
    { title: T.groups.autoplay, critical: false, items: of("autoplay") },
  ];
});
const linkColumns = computed(() => [linkGroups.value.slice(0, 2), linkGroups.value.slice(2)]);
const youtubeClients = computed(() =>
  props.status.youtube.clients.map((c, i) => {
    const ok = c.tried - c.failed;
    const rate = c.tried ? ok / c.tried : 0;
    const level: Level = c.excluded ? "warn" : levelOf(c.tried ? c.failed / c.tried : 0, 0.1, 0.5);
    return { name: c.name, rate, level, excluded: c.excluded, value: c.excluded ? T.clientSkipped : `${ok}/${c.tried}`, detail: T.clientDetail(i + 1, c.tried, ok, c.excluded) };
  }),
);

// ── ④ 작업 ──
// 목록 둘은 서버가 필터링, 정렬하고 보이는 구간만 준다. 행 높이: 플레이어 48px, 자식 프로세스는 좁은 카드(448px 미만) 48px, 넓으면 32px
const PLAYER_STATE_WORD: Record<PlayerState, string> = T.playerStates;
const REM = rem(1);
const playerListEl = ref<HTMLElement | null>(null);
const {
  range: playerRange,
  top: playerTop,
  bottom: playerBottom,
  toTop: playerToTop,
} = useRowWindow({
  el: playerListEl,
  rowHeight: () => 3 * REM,
  total: () => props.status.players.matched,
  have: () => ({ from: props.status.players.from, count: props.status.players.rows.length }),
  request: (span: Span) => (query.value = { ...query.value, players: span }),
});
const playerSlots = computed(() => slotsOf<PlayerRow>(playerRange.value, props.status.players.from, props.status.players.rows, (row) => row.guildId));
// 스페이서 높이만 바뀌어도(필터링된 수, 받은 구간) 다시 잰다
const playerListOverflowing = useOverflowing(playerListEl, () => [playerTop.value, playerBottom.value]);
// 더 있는 쪽 끝 반 줄(24px)을 페이드 처리한다(자식 프로세스 목록과 같다)
const playerFade = useScrollFade(
  playerListEl,
  () => true,
  24,
  () => [playerTop.value, playerBottom.value],
);
// 필터, 검색어를 바꾸면 처음부터
function filterPlayers(patch: Partial<Pick<StatusQuery, "states" | "q">>) {
  query.value = { ...query.value, ...patch, players: { ...query.value.players, from: 0 } };
  playerToTop();
}
// 검색: 서버 이름, 곡, 가수(한국어 조합 중 글자, 초성도, rules/ko-search). 입력이 200ms 쉬면 보낸다
const playerTerm = ref(query.value.q);
watchDebounced(playerTerm, (q) => filterPlayers({ q: q.slice(0, Q_MAX) }), { debounce: 200 });
function togglePlayerState(k: PlayerState) {
  const next = new Set(query.value.states);
  if (!next.delete(k)) next.add(k);
  filterPlayers({ states: PLAYER_STATES.filter((s) => next.has(s)) });
}
const playerFilters = computed(() => PLAYER_STATES.map((k) => ({ key: k, label: PLAYER_STATE_WORD[k], count: props.status.players.counts[k], on: query.value.states.includes(k), toggle: () => togglePlayerState(k) })));
const NOT_MEMBER_TIP = T.notMemberTip;
const ORPHAN_TIP = T.strayTip;
// 작업: 봇 헬퍼는 이름, 서버의 일은 서버 이름(다음 곡, 곡 찾기는 덧붙인다). 서버를 나갔으면 이름이 없다
const HELPER_JOB: Partial<Record<NonNullable<ProcessRow["job"]>, string>> = { "pot-server": T.jobs.potServer, "ytdlp-update": T.jobs.ytdlpUpdate, "login-background": T.jobs.loginBackground, "net-stats": T.jobs.netStats };
function processJob(p: ProcessRow) {
  const helper = p.job && HELPER_JOB[p.job];
  if (helper) return helper;
  const guild = p.guildName ?? (p.guildId ? T.jobs.leftServer : null);
  const task = p.job === "prefetch" ? T.jobs.prefetch : p.job === "lookup" ? T.jobs.lookup : null;
  return [guild, task].filter(Boolean).join(" · ") || T.jobs.none;
}
// 열 헤더와 행이 따로라 열 폭을 고정한다: PID 5자리, 프로그램(yt-dlp), 작업, 실행 시간(2:58:33), 메모리(52 MB)
const PROCESS_GRID = "grid grid-cols-[4rem_minmax(0,1fr)_3.5rem] @md/card:grid-cols-[3rem_4rem_minmax(0,1fr)_4rem_3.5rem] items-center gap-x-3";
// 정렬(서버가 한다): 처음은 실행 시간이 긴 순서. 다른 열을 처음 누르면 수는 큰 것부터, 글은 가나다 순서
const PROCESS_COLUMNS: Array<{ key: ProcessSort; label: string; right?: boolean; numeric?: boolean }> = [
  { key: "pid", label: T.columns.pid, numeric: true },
  { key: "label", label: T.columns.label },
  { key: "job", label: T.columns.job },
  { key: "age", label: T.columns.age, right: true, numeric: true },
  { key: "mem", label: T.columns.mem, right: true, numeric: true },
];
const processSort = computed(() => ({ key: query.value.sort, desc: query.value.desc }));
function sortProcessesBy(key: ProcessSort) {
  const { key: now, desc } = processSort.value;
  const next = key === now ? !desc : Boolean(PROCESS_COLUMNS.find((c) => c.key === key)?.numeric);
  query.value = { ...query.value, sort: key, desc: next, procs: { ...query.value.procs, from: 0 } };
  processToTop();
}
const playerCardEl = ref<InstanceType<typeof BaseCard> | null>(null);
const { height: playerCardHeight } = useElementSize(playerCardEl, undefined, { box: "border-box" });
// 행 높이는 카드 안쪽 너비로 정한다(@md/card 와 같은 448px)
const processCardEl = ref<InstanceType<typeof BaseCard> | null>(null);
const { width: processCardWidth } = useElementSize(processCardEl);
const processListEl = ref<HTMLElement | null>(null);
const {
  range: processRange,
  top: processTop,
  bottom: processBottom,
  toTop: processToTop,
} = useRowWindow({
  el: processListEl,
  rowHeight: () => (processCardWidth.value >= 28 * REM ? 2 : 3) * REM,
  total: () => props.status.processes.total,
  have: () => ({ from: props.status.processes.from, count: props.status.processes.rows.length }),
  request: (span: Span) => (query.value = { ...query.value, procs: span }),
});
const processSlots = computed(() => slotsOf<ProcessRow>(processRange.value, props.status.processes.from, props.status.processes.rows, (row) => row.pid));
const processListOverflowing = useOverflowing(processListEl, () => [processTop.value, processBottom.value]);
// 더 있는 쪽 끝 반 줄(16px)을 페이드 처리한다
const processFade = useScrollFade(
  processListEl,
  () => true,
  16,
  () => [processTop.value, processBottom.value],
);
const ytdlp = computed(() => props.status.processes.ytdlp);

// ── ⑤ 저장공간 ──
const storageBars = computed(() => {
  const { cache, disk } = props.status.storage;
  const diskPct = (disk.usedBytes / disk.totalBytes) * 100;
  return [
    { key: "cache", label: T.audioCache, ratio: cache.bytes / cache.maxBytes, text: sizePair(cache.bytes, cache.maxBytes, 1, 0), level: "ok" as Level },
    { key: "files", label: T.cacheFiles, ratio: cache.files / cache.maxFiles, text: T.files(cache.files, cache.maxFiles), level: "ok" as Level },
    { key: "drive", label: T.drive(disk.drive), ratio: diskPct / 100, text: T.driveFree(sizeText(disk.totalBytes), sizeText(disk.totalBytes - disk.usedBytes)), level: levelOf(diskPct, ...LIMITS.disk) },
  ];
});
// 재생 중 캐시 보호: 지금 재생 중인 곡의 캐시 파일(삭제하지 않는다). 미재생 캐시 파일: 캐시에 다운로드해 뒀는데 재생 횟수가 0 인 파일(미리 다운로드했다가 건너뛴 곡 등). 다운로드 실패한 캐시 파일: 다운로드 실패, 다운로드 멈춤, 파일이 사라진 캐시 행(다시 다운로드하면 풀린다)
const cacheCounts = computed<Array<[string, string]>>(() => {
  const { cache } = props.status.storage;
  return [
    [T.cacheCounts.protected, T.count(cache.protectedFiles)],
    [T.cacheCounts.neverPlayed, T.count(cache.neverPlayed)],
    [T.cacheCounts.failed, T.count(cache.failed)],
  ];
});
// 캐시 드라이브 막대의 조각: 오디오 캐시, DB(같은 드라이브일 때만), 기타, 여유 공간, 최소 여유
const driveParts = computed(() => {
  const { cache, disk, db } = props.status.storage;
  const dbHere = db.drive === disk.drive;
  const other = Math.max(0, disk.usedBytes - cache.bytes - (dbHere ? db.bytes : 0));
  const free = disk.totalBytes - disk.usedBytes;
  const reserve = Math.min(free, disk.minFreeBytes);
  const parts = [{ label: T.audioCache, bytes: cache.bytes, tone: "bg-(--store-cache)" }, ...(dbHere ? [{ label: "DB", bytes: db.bytes, tone: "bg-(--store-db)" }] : []), { label: T.driveParts.other, bytes: other, tone: "bg-(--store-other)" }, { label: T.driveParts.free, bytes: free - reserve, tone: "bg-(--store-free)" }];
  const rows = parts.map((part) => ({ ...part, text: sizeText(part.bytes), tip: `${part.label} ${sizeText(part.bytes)}` }));
  const minFree = sizeText(disk.minFreeBytes);
  return [...rows, { label: T.driveParts.reserve, bytes: reserve, tone: "bg-(--store-reserve)", text: minFree, tip: T.reserveTip(minFree) }];
});
const dbRows = computed<Array<[string, string]>>(() => {
  const { db, cache, disk } = props.status.storage;
  // DB 크기는 늘 표에(드라이브가 다르면 드라이브명을 붙인다). 같은 드라이브면 드라이브 막대에도 조각으로 들어간다
  return [
    [T.db.file, db.drive === disk.drive ? sizeText(db.bytes) : `${sizeText(db.bytes)} (${db.drive})`],
    [T.db.lookups, T.songCount(db.lookups)],
    [T.db.pins, T.songCount(db.pins)],
    [T.db.sponsor, T.songCount(db.sponsorSegments)],
    // 재시작 때 복원할 세션(player_sessions). 나가며 남긴 것, 복원하지 않고 남긴 것도 세므로 "활성"을 붙이지 않는다
    [T.db.sessions, T.count(db.sessions)],
    // 마지막으로 실제로 삭제한 정리: 언제, 삭제한 수, 비운 용량(정리는 시작, 정기 간격, 다운로드 뒤마다 돌고, 한도를 넘었을 때만 삭제한다)
    [T.db.lastCleanup, cache.lastCleanup ? T.cleanup(sinceText(cache.lastCleanup.at).short, cache.lastCleanup.files, sizeText(cache.lastCleanup.bytes)) : "-"],
  ];
});

// ── ① 요약: 위 값들 중 주의, 문제인 것(at: 누르면 갈 항목). 가장 나쁜 것이 전체 상태 ──
const linkLevel = (state: LinkState, critical: boolean): Level => (state === "fail" ? (critical ? "bad" : "warn") : state === "slow" ? "warn" : "ok");
const attention = computed(() => [
  ...metrics.value.filter((m) => m.level !== "ok").map((m) => ({ name: m.title, word: m.word, level: m.level, at: m.title })),
  ...linkGroups.value.flatMap((group) => group.items.map((line) => ({ name: line.name, word: LINK_WORD[line.state], level: linkLevel(line.state, group.critical), at: "links" }))).filter((item) => item.level !== "ok"),
  ...youtubeClients.value.filter((client) => client.level !== "ok").map((client) => ({ name: T.youtubeClient(client.name), word: client.excluded ? T.attention.skipped : T.attention.failingOften, level: client.level, at: "links" })),
  ...storageBars.value.filter((u) => u.level !== "ok").map((u) => ({ name: u.label, word: T.attention.nearlyFull, level: u.level, at: "storage" })),
  ...props.status.processes.stray.map((p) => ({ name: `${p.label} ${p.pid}`, word: T.attention.stray, level: "warn" as Level, at: "processes" })),
  // 앞 몇 개만 칩으로, 나머지는 수 하나로(개수를 셀 때는 다 센다)
  ...(props.status.processes.strayMore ? [{ name: T.strayMore(props.status.processes.strayMore), word: T.attention.stray, level: "warn" as Level, at: "processes", count: props.status.processes.strayMore }] : []),
  ...(props.status.processes.ytdlp.nearLimit ? [{ name: T.extractions, word: T.attention.nearLimit, level: "warn" as Level, at: "processes" }] : []),
]);
const attentionCount = computed(() => attention.value.reduce((n, a) => n + ("count" in a ? a.count : 1), 0));
const overallLevel = computed<Level>(() => (attention.value.some((a) => a.level === "bad") ? "bad" : attention.value.length ? "warn" : "ok"));
</script>

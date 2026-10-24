<template>
  <!-- 서버 화면. 위에 "지금 재생" 띠, 아래에 대기열이 남는 높이를 다 쓴다(태블릿 · PC 는 화면 높이에 맞고 대기열만 스크롤된다). 휴대폰은 쌓아서 화면이 스크롤된다.
       대기열이 한 단 목록이라 넓어도 행만 길어진다: 최대 1280 으로 가운데에 두고 양옆은 배경화면이 비친다 -->
  <!-- 휴대폰(sheetMode): 플레이어가 화면 높이를 채우고 대기열은 바텀 시트(스포티파이식). 시트 헤더(76)만큼 아래를 비운다.
       가로는 자른다(clip): 앨범아트를 밀어 넘길 때 화면 밖에 놓인 그림이 바탕화면에 가로 스크롤바를 잠깐 만들어 그만큼 높이가 줄며 아래가 움찔했다 -->
  <div class="w-full max-w-7xl mx-auto flex flex-col" :class="sheetMode ? (short ? 'relative h-full overflow-x-clip px-6 pt-4 pb-18' : 'relative h-full overflow-x-clip px-6 pt-6 pb-22') : 'px-(--gap-out) pt-(--gap-out) min-h-full md:h-full pb-[calc(var(--gap-out)+var(--player))] md:pb-(--gap-out)'">
    <!-- 음성 상태 · 설정(태블릿 · PC)은 위 막대 오른쪽 끝으로 보낸다(서버 이름 · 아이콘은 위 막대 가운데). 휴대폰은 아래 한 줄로 -->
    <!-- 위 막대 왼쪽 끝에 ← 서버 목록(모든 크기). 이전 화면이 아니라 늘 목록으로(세로 막대 · 사이드 드로어에서 다른 서버로 건너왔어도 나가는 길은 하나).
         공간이 되면(태블릿 · PC) "← 서버 목록", 휴대폰은 화살표만 두고 이름은 툴팁으로(서버 설정의 돌아가기와 같은 버튼) -->
    <Teleport to="#topbar-start" defer>
      <router-link to="/servers" :class="TOPBAR_TEXT_BTN" :aria-label="text.shell.serverList" v-tooltip="isPhone ? text.shell.serverList : null"
        ><Icon name="arrow_back" /><span class="hidden md:inline text-sm font-semibold truncate">{{ text.shell.serverList }}</span></router-link
      >
    </Teleport>
    <Teleport to="#topbar-end" defer>
      <span class="hidden lg:flex items-center gap-1 text-xs text-on-surface-variant truncate"
        ><Icon :name="voiceLine.icon" :size="16" :fill="player.sameVoice" :class="player.sameVoice ? 'text-primary' : ''" /><span class="truncate">{{ voiceLine.text }}</span></span
      >
      <router-link v-if="player.canManage" :to="`/servers/${guildId}/settings`" v-tooltip="T.serverSettings" :class="TOPBAR_BTN" :aria-label="T.serverSettings"><Icon name="tune" /></router-link>
    </Teleport>

    <!-- 휴대폰: 글 · 버튼 뒤의 받침 막. 곡마다 배경화면 색이 달라 그림 아래 글이 묻혀서, 세로는 아래로(35~72%) · 가로는 오른쪽으로(0~62%) 단계를 나눠 부드럽게 짙어지고 가장 짙은 데도 60%(글자와 반대 색: 어두운 모드는 검정 쪽, 밝은 모드는 흰 쪽 = 바탕 면 색).
         좁게 두면 띠처럼 뭉친다 -->
    <div
      v-if="sheetMode && !loading && !loadError"
      class="absolute inset-0 pointer-events-none"
      :class="
        short
          ? 'bg-[linear-gradient(to_right,transparent_0%,color-mix(in_oklab,var(--md-surface)_13%,transparent)_20%,color-mix(in_oklab,var(--md-surface)_33%,transparent)_35%,color-mix(in_oklab,var(--md-surface)_50%,transparent)_50%,color-mix(in_oklab,var(--md-surface)_60%,transparent)_62%)]'
          : 'bg-[linear-gradient(to_bottom,transparent_35%,color-mix(in_oklab,var(--md-surface)_13%,transparent)_46%,color-mix(in_oklab,var(--md-surface)_33%,transparent)_55%,color-mix(in_oklab,var(--md-surface)_50%,transparent)_64%,color-mix(in_oklab,var(--md-surface)_60%,transparent)_72%)]'
      "
      aria-hidden="true"
    ></div>

    <div v-if="loading" class="flex-1 flex items-center justify-center text-on-surface-variant"><Icon name="progress_activity" :size="40" class="animate-spin text-primary" /></div>

    <!-- 서버가 없거나 멤버가 아니면 다시 해도 같다: 서버 목록으로. 그 밖(봇이 답하지 않음 등)은 다시 시도 -->
    <PageError v-else-if="loadError" :icon="loadGone ? 'block' : 'cloud_off'" :text="loadError">
      <BaseButton v-if="loadGone" variant="secondary" @click="router.push('/servers')"><Icon name="dns" :size="20" />{{ text.common.toServerList }}</BaseButton>
      <BaseButton v-else variant="secondary" @click="retryLoad"><Icon name="refresh" :size="20" />{{ text.shell.retry }}</BaseButton>
    </PageError>

    <div v-else class="flex-1 min-h-0" :class="sheetMode ? 'relative flex flex-col' : 'grid content-start md:content-stretch gap-(--gap-in) grid-cols-1 md:grid-rows-[auto_minmax(0,1fr)]'">
      <!-- ── 지금 재생: 한 줄 높이의 띠(아트 · 제목 · 조작). 곡이 없어도 같은 줄들을 두어 높이가 같다(플레이스홀더 · 비활성 조작) ── -->
      <AppWindow v-if="!sheetMode">
        <div class="relative" :class="locked && 'blur-sm saturate-50 pointer-events-none select-none'">
          <div class="flex items-center gap-4">
            <!-- 아트. 누르면 크게 본다 -->
            <button v-if="artShown" type="button" class="group/art relative shrink-0 size-22 @xl/win:size-28 @4xl/win:size-32 rounded-sm @xl/win:rounded-md overflow-hidden bg-surface-container-high cursor-zoom-in transition-[border-radius] spring-fast hover:rounded-xl" v-tooltip="T.enlarge" :aria-label="T.enlargeArt" @click="artOpen = true">
              <img :src="artShown" alt="" class="size-full object-cover transition-[filter] effects group-hover/art:brightness-90" :style="artZoom > 1 ? { scale: artZoom } : undefined" @error="brokenArt = artShown" />
              <span class="absolute right-1 bottom-1 @xl/win:right-2 @xl/win:bottom-2 size-7 rounded-full bg-black/45 text-white flex items-center justify-center opacity-0 transition-opacity effects group-hover/art:opacity-100"><Icon name="open_in_full" :size="16" /></span>
            </button>
            <span v-else class="shrink-0 size-22 @xl/win:size-28 @4xl/win:size-32 rounded-sm @xl/win:rounded-md bg-surface-container-high text-on-surface-variant flex items-center justify-center"><Icon :name="track ? 'audio_file' : 'music_off'" :size="36" /></span>

            <div class="min-w-0 flex-1">
              <!-- 출처 줄 아래와 아티스트 위 간격을 같게(제목이 가운데). 좁은 창의 아트(88)는 이 그룹 높이(출처 32 + 6 + 제목 + 6 + 아티스트)에 맞춘다.
                   곡이 없으면 이 줄을 숨겨 "재생 중인 곡이 없어요" 두 줄이 아트 높이의 가운데에 온다 -->
              <div v-if="track" class="flex items-center gap-2 mb-1.5 min-w-0 h-8">
                <!-- 좁은 창은 하이라이트 · 정지 공간을 지키려고 "내가 넣은 곡"을 뺀다 -->
                <TrackChips :track="track" :mine="mine" mine-class="hidden! @xl/win:inline-flex!" />
                <!-- 좁은 창: 하이라이트 · 정지는 이 줄 오른쪽 끝 -->
                <div class="@xl/win:hidden ml-auto flex items-center gap-2 shrink-0">
                  <PlayerActions small :player="player" :highlight="highlightMarker !== null" :busy="isBusy" @highlight="jumpToHighlight" @stop="showStopConfirm = true" />
                </div>
              </div>
              <!-- 링크는 글자에만 건다(줄 전체가 눌리지 않게) -->
              <div v-if="track" class="font-round font-semibold leading-tight text-on-surface line-clamp-1 @xl/win:line-clamp-2 text-lg @xl/win:text-xl @4xl/win:text-2xl">
                <a :href="track.url" target="_blank" rel="noopener" class="no-underline hover:underline decoration-2 underline-offset-4">{{ songTitle(track.title) }}</a>
              </div>
              <div v-else class="font-round font-semibold leading-tight text-on-surface-variant line-clamp-1 text-lg @xl/win:text-xl @4xl/win:text-2xl">{{ P.nothingPlaying }}</div>
              <div class="mt-1.5 text-sm @xl/win:text-base text-on-surface-variant truncate">{{ track ? track.artist || " " : T.addToPlay }}</div>
            </div>

            <!-- 넓은 창: 조작은 아트 · 제목 오른쪽 -->
            <div class="hidden @xl/win:block shrink-0">
              <PlayerControls :player="player" :busy="isBusy" @shuffle="shuffle" @previous="previous" @pause="togglePause" @skip="skip" @loop="cycleLoop" />
            </div>
          </div>

          <!-- 진행 줄. 넓은 창은 끝에 [볼륨 | 하이라이트 · 정지], 좁은 창은 [볼륨 버튼] -->
          <SeekRow class="mt-3" :time="timeText" :length="lengthText" :bar="seekView" :grabbable="seekable && Boolean(player.canControl)" @grab="grabSeek">
            <div class="hidden @xl/win:flex items-center gap-2 shrink-0 pl-2">
              <div class="flex items-center gap-2 h-10 pl-2 pr-3 rounded-full bg-surface-container-high/60">
                <span class="flex text-on-surface-variant"><VolumeIcon :level="volumeShown" :size="24" /></span>
                <VolumeSlider class="w-24 @4xl/win:w-30" :level="volumeShown" :disabled="!player.canControl || !player.hasPlayer" @input="volumeInput" @change="volumeChange" />
              </div>
              <span class="w-px h-6 bg-outline-variant/60"></span>
              <PlayerActions :player="player" :highlight="highlightMarker !== null" :busy="isBusy" @highlight="jumpToHighlight" @stop="showStopConfirm = true" />
            </div>
            <!-- 좁은 창: 볼륨은 버튼 하나. 누르면 슬라이더 말풍선 -->
            <div class="@xl/win:hidden relative shrink-0">
              <button type="button" :class="[ROUND_BTN, 'text-on-surface-variant', volumeOpen ? 'bg-secondary-container text-on-secondary-container' : '']" :aria-label="T.volumeLabel(volumeShown)" :aria-expanded="volumeOpen" :disabled="!player.canControl || !player.hasPlayer" @click="volumeOpen = !volumeOpen"><VolumeIcon :level="volumeShown" :size="24" /></button>
              <template v-if="volumeOpen">
                <div class="fixed inset-0 z-40" @click="volumeOpen = false"></div>
                <div class="absolute right-0 bottom-full mb-2 z-50 pane-menu rounded-full h-12 pl-4 pr-3 flex items-center gap-2">
                  <VolumeSlider class="w-40" :level="volumeShown" :bubble="false" @input="volumeInput" @change="volumeChange" />
                  <span class="w-7 text-right text-xs font-semibold nums">{{ volumeShown }}</span>
                </div>
              </template>
            </div>
          </SeekRow>

          <!-- 좁은 창: 조작 한 줄, 양끝까지 펼친다 -->
          <PlayerControls class="@xl/win:hidden mt-3" spread :player="player" :busy="isBusy" @shuffle="shuffle" @previous="previous" @pause="togglePause" @skip="skip" @loop="cycleLoop" />
          <div v-if="track && !player.canControl && player.sameVoice" class="mt-3 text-sm text-on-surface-variant flex items-center gap-2"><Icon name="lock" :size="16" />{{ noticeText("must-dj").body }}</div>
        </div>
        <VoiceLockOverlay v-if="locked" />
      </AppWindow>

      <!-- ── 휴대폰(스포티파이식): 창 없이 바탕화면 위에. 위에서부터 그림(남는 높이 안의 가장 큰 정사각형) · 배지 · 제목 · 진행 · 조작 · 아래 줄(음성 상태 · 볼륨 · 정지 · 대기열) ── -->
      <div v-else class="relative flex-1 min-h-0 flex flex-col">
        <!-- 낮은 화면(휴대폰 가로): 왼쪽에 높이에 맞춘 정사각형 그림, 오른쪽에 나머지(배지는 빼고 간격을 줄인다). 둘을 가운데로 모은다 -->
        <div class="flex-1 min-h-0 flex" :class="[short ? 'flex-row items-center justify-center gap-6' : 'flex-col', locked && 'blur-sm saturate-50 pointer-events-none select-none']">
          <div class="min-h-0 flex items-center justify-center @container-size" :class="short ? 'h-full aspect-square shrink-0' : 'flex-1'">
            <!-- 좌우로 밀어 곡 넘기기: 왼쪽 = 다음 곡, 오른쪽 = 이전 곡(useArtSwipe). 사이드 드로어 쓸기는 여기서 받지 않는다(data-no-swipe). 밀었으면 크게 보기는 열지 않는다 -->
            <button
              v-if="artShown"
              ref="artSwipeEl"
              type="button"
              data-no-swipe
              class="size-[min(100cqw,100cqh)] rounded-(--r-window) overflow-hidden bg-surface-container-high cursor-zoom-in shadow-[0_2px_6px_rgb(0_0_0/0.2),0_8px_24px_rgb(0_0_0/0.15)] select-none"
              :class="artSwipe.animating.value && 'transition-[translate,opacity] duration-250 ease-smooth'"
              :style="artSwipe.style.value"
              :aria-label="T.enlargeArt"
              @pointerdown="artSwipe.down"
              @pointermove="artSwipe.move"
              @pointerup="artSwipe.up"
              @pointercancel="artSwipe.up"
              @click="artSwipe.swiped.value || (artOpen = true)"
            >
              <img :src="artShown" alt="" draggable="false" class="size-full object-cover" :style="artZoom > 1 ? { scale: artZoom } : undefined" @error="brokenArt = artShown" />
            </button>
            <!-- 그림이 없는 곡도 같은 위치에서 밀어 넘긴다 -->
            <span v-else ref="artSwipeEl" data-no-swipe class="size-[min(100cqw,100cqh)] rounded-(--r-window) bg-surface-container-high text-on-surface-variant flex items-center justify-center select-none" :class="artSwipe.animating.value && 'transition-[translate,opacity] duration-250 ease-smooth'" :style="artSwipe.style.value" @pointerdown="artSwipe.down" @pointermove="artSwipe.move" @pointerup="artSwipe.up" @pointercancel="artSwipe.up"
              ><Icon :name="track ? 'audio_file' : 'music_off'" :size="64"
            /></span>
          </div>

          <div :class="short ? 'flex-1 min-w-0 max-w-md flex flex-col justify-center' : 'contents'">
            <div v-if="!short" class="shrink-0 mt-6 flex items-center gap-2 h-6">
              <TrackChips v-if="track" :track="track" :mine="mine" />
            </div>
            <div class="shrink-0 flex items-center gap-3" :class="!short && 'mt-3'">
              <div class="min-w-0 flex-1">
                <!-- 길면 뉴스 티커처럼 흘려 돈다 -->
                <a v-if="track" :href="track.url" target="_blank" rel="noopener" class="block no-underline font-round font-semibold leading-tight text-on-surface" :class="short ? 'text-xl' : 'text-2xl'"><MarqueeText :text="songTitle(track.title)" loop /></a>
                <div v-else class="font-round font-semibold leading-tight text-on-surface-variant truncate" :class="short ? 'text-xl' : 'text-2xl'">{{ P.nothingPlaying }}</div>
                <MarqueeText class="text-on-surface-variant" :class="short ? 'text-sm' : 'text-base'" :text="track ? track.artist || ' ' : T.addToPlay" loop />
              </div>
            </div>

            <!-- 진행: 막대 아래 양 끝에 시간 -->
            <SeekRow stacked class="shrink-0" :class="short ? 'mt-0.5' : 'mt-1'" :time="timeText" :length="lengthText" :bar="seekView" :grabbable="seekable && Boolean(player.canControl)" @grab="grabSeek" />

            <PlayerControls spread class="shrink-0" :class="short ? 'mt-1' : 'mt-3'" :play-size="short ? 'size-14' : 'size-16'" :player="player" :busy="isBusy" @shuffle="shuffle" @previous="previous" @pause="togglePause" @skip="skip" @loop="cycleLoop" />

            <!-- 아래 줄: 음성 상태(스포티파이의 연결 기기 위치) · 볼륨 | 하이라이트 · 정지(태블릿 · PC 진행 줄 끝과 같은 그룹).
                 볼륨: 줄이 넓으면(400 이상, 가로 화면) 음성 상태 오른쪽에 막대를 늘 둔다. 좁으면 🔊 를 누를 때 음성 상태가 빠지고 그 위치로 막대가 🔊 쪽에서 펼쳐진다
                 (바깥을 누르거나 3초 손대지 않으면 접힌다). 숫자는 핸들을 잡는 동안 말풍선(태블릿 · PC 볼륨 막대와 같다) -->
            <div ref="volRowEl" class="shrink-0 flex items-center gap-2" :class="short ? 'mt-1' : 'mt-5'">
              <div class="relative flex-1 min-w-0 h-10 flex items-center gap-3">
                <span class="min-w-0 flex items-center gap-1.5 text-xs transition-opacity duration-200" :class="[player.sameVoice ? 'text-primary' : 'text-on-surface-variant', volumeExpand && !volumeInline && 'opacity-0 pointer-events-none']"
                  ><Icon :name="voiceLine.icon" :size="16" :fill="player.sameVoice" class="shrink-0" /><span class="truncate">{{ voiceLine.text }}</span></span
                >
                <div class="flex items-center transition-[clip-path,opacity] duration-300 ease-smooth" :class="volumeInline ? 'ml-auto w-28 shrink-0' : ['absolute inset-y-0 left-1 right-0', volumeExpand ? '[clip-path:inset(-3rem_-1rem_-1rem_-1rem)]' : '[clip-path:inset(-3rem_-1rem_-1rem_100%)] opacity-0 pointer-events-none']">
                  <VolumeSlider
                    class="w-full"
                    :level="volumeShown"
                    :disabled="!player.canControl || !player.hasPlayer"
                    @input="
                      volumeTouched();
                      volumeInput($event);
                    "
                    @change="
                      volumeTouched();
                      volumeChange($event);
                    "
                  />
                </div>
              </div>
              <!-- 넓으면 아이콘만(막대가 늘 있다), 좁으면 펼치는 버튼 -->
              <span v-if="volumeInline" class="flex text-on-surface-variant"><VolumeIcon :level="volumeShown" :size="24" /></span>
              <button v-else type="button" :class="[ROUND_BTN, 'text-on-surface-variant', volumeExpand ? 'bg-secondary-container text-on-secondary-container' : '']" :aria-label="T.volumeLabel(volumeShown)" :aria-expanded="volumeExpand" :disabled="!player.canControl || !player.hasPlayer" @click="volumeExpand ? (volumeExpand = false) : volumeTouched()">
                <VolumeIcon :level="volumeShown" :size="24" />
              </button>
              <span class="w-px h-6 bg-outline-variant/60"></span>
              <PlayerActions :player="player" :highlight="highlightMarker !== null" :busy="isBusy" @highlight="jumpToHighlight" @stop="showStopConfirm = true" />
            </div>
            <div v-if="track && !player.canControl && player.sameVoice" class="shrink-0 mt-2 text-sm text-on-surface-variant flex items-center gap-2"><Icon name="lock" :size="16" />{{ noticeText("must-dj").body }}</div>
          </div>
        </div>
        <VoiceLockOverlay v-if="locked" />
      </div>

      <ArtLightbox v-model:open="artOpen" :track="track" :content="artContent" />

      <!-- ── 대기열 ── -->
      <!-- 휴대폰은 같은 내용을 바텀 시트(QueueSheet)에 담는다 -->
      <component :is="sheetMode ? QueueSheet : AppWindow" :title="P.queue" icon="queue_music" v-bind="sheetMode ? { deskHeight: shell.deskHeight, next: nextTitle, compact: short } : { class: 'max-h-[80dvh] md:max-h-none' }">
        <template #badge>
          <span v-if="player.queue.length" class="h-6 px-2 rounded-full bg-secondary-container text-on-secondary-container text-xs font-semibold nums inline-flex items-center">{{ T.songs(player.queueTotal ?? player.queue.length) }}</span>
        </template>
        <template #actions>
          <span v-if="queueSeconds !== null && player.queue.length" class="hidden @xl/win:inline text-xs text-on-surface-variant nums mr-1">{{ formatDuration(queueSeconds) }}</span>
          <!-- 자동재생 켜기 · 끄기. 꺼져 있으면 장르를 선택하고, 켜져 있으면 누르면 끈다(디스코드 장르 메뉴와 같은 판정) -->
          <div class="relative">
            <button
              type="button"
              class="tap state-layer h-8 px-3 rounded-full flex items-center gap-2 text-xs font-semibold cursor-pointer transition-[background-color,color] effects disabled:opacity-38 disabled:cursor-not-allowed"
              :class="autoplayGenre ? 'bg-tertiary-container text-on-tertiary-container' : 'border border-outline-variant text-on-surface-variant'"
              :disabled="!player.canControl || isBusy('autoplay')"
              v-tooltip="autoplayGenre ? T.autoplayOff : T.autoplayOn"
              @click="autoplayGenre ? setAutoplay(null) : toggleGenreMenu($event)"
            >
              <Icon name="auto_awesome" :size="18" :fill="Boolean(autoplayGenre)" />
              <span>{{ T.autoplay }}</span>
              <span v-if="autoplayGenre" class="max-w-24 truncate opacity-80">· {{ autoplayGenreLabel ?? autoplayGenre }}</span>
            </button>
            <div v-if="genreMenu" class="fixed inset-0 z-40" @click="genreMenu = false"></div>
            <!-- 스크롤바 트랙은 위아래 32 - 5 = 27 을 비우고, 넘치면 오른쪽 여백을 8 - 3 = 5 로(useOverflowing) -->
            <!-- 아래에 공간이 없으면(휴대폰 대기열 판이 접혀 화면 아래에 있을 때) 위로 연다 -->
            <div v-if="genreMenu" ref="genreMenuEl" class="absolute right-0 z-50 w-70 max-h-80 overflow-y-auto rounded-3xl pane-menu [&::-webkit-scrollbar-track]:my-6.75" :class="[genreMenuUp ? 'bottom-full mb-2' : 'top-full mt-2', genreOverflowing ? 'py-2 pl-2 pr-1.25' : 'p-2']">
              <div class="px-3 pt-2 pb-2 text-xs font-semibold text-on-surface-variant">{{ T.whichGenre }}</div>
              <div class="grid grid-cols-2 gap-1">
                <button v-for="g in genres" :key="g.id" type="button" class="tap state-layer h-10 px-3 rounded-2xl flex items-center gap-2 text-sm font-medium text-left cursor-pointer" @click="pickGenre(g.id)">
                  <span class="emoji text-lg">{{ g.emoji ?? "" }}</span
                  ><span class="truncate">{{ g.label }}</span>
                </button>
              </div>
            </div>
          </div>
        </template>

        <QueueAddBox :guild-id="guildId" :player="player" :queue-window="loadedCount" @state="applyState" />

        <!-- 떠 있는 재생 바 밑으로도 곡이 지나가고, 끝 곡은 바 위까지 올릴 수 있게 바 높이만큼 아래를 비운다 -->
        <div v-if="player.queue?.length > 0" ref="queueBoxRef" data-reorder-scroller class="mt-3 -mx-2 px-1 flex-1 min-h-0 overflow-y-auto flex flex-col md:pb-(--player)" :class="sheetMode && 'pb-[max(1rem,env(safe-area-inset-bottom))]'" :style="queueFade" @scroll.passive="onQueueScroll">
          <div v-for="(item, i) in shownQueue" :key="item.entry ?? `i${i}`" class="group/item relative shrink-0 flex items-center gap-3 h-16 pl-1 pr-1 rounded-lg hover:bg-on-surface/6" data-reorder>
            <span class="text-outline group-hover/item:text-on-surface-variant transition-colors duration-150 touch-none cursor-grab active:cursor-grabbing shrink-0 select-none" v-tooltip="T.dragToReorder" @pointerdown="startDrag($event, i)"><Icon name="drag_indicator" :size="20" /></span>
            <span class="-ml-1 text-right text-xs nums text-on-surface-variant shrink-0 whitespace-nowrap" :style="{ width: numWidth }">{{ i + 1 }}</span>
            <TrackArt :track="item" size-class="size-12 rounded-md" :icon-size="24" />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">{{ songTitle(item.title) }}</div>
              <div class="text-xs text-on-surface-variant truncate flex items-center gap-1">
                <span class="size-2 rounded-full shrink-0" :style="{ backgroundColor: platformColor(item.platform) }" v-tooltip="item.platformLabel || item.platform"></span>
                <span v-if="item.artist" class="truncate">{{ item.artist }}</span>
                <span class="nums shrink-0">· {{ formatDuration(item.duration) }}</span>
              </div>
            </div>
            <span v-if="item.autoplay" class="shrink-0 text-tertiary" v-tooltip="T.pickedByAutoplay"><Icon name="auto_awesome" :size="16" fill /></span>
            <button class="tap state-layer size-8 rounded-full text-outline group-hover/item:text-on-surface-variant transition-colors duration-150 cursor-pointer flex items-center justify-center shrink-0 disabled:opacity-38 disabled:cursor-not-allowed" v-tooltip="T.removeSong" :disabled="!removeAllowed(player, item) || !Number.isInteger(item.entry) || isBusy(`remove:${item.entry}`)" @click="removeTrack(item)"><Icon name="close" :size="20" /></button>
          </div>
          <div v-if="player.queue.length < (player.queueTotal ?? 0)" class="flex items-center justify-center gap-2 py-4 text-xs text-on-surface-variant">
            <Icon name="progress_activity" :size="20" class="animate-spin text-primary" />
            {{ T.moreSongs(player.queueTotal - player.queue.length) }}
          </div>
        </div>
        <div v-else class="flex-1 flex items-center justify-center py-8 text-sm text-on-surface-variant">{{ T.queueEmpty }}</div>
      </component>
    </div>

    <!-- 정지 확인(M3 대화상자) -->
    <ConfirmDialog v-model="showStopConfirm" icon="stop_circle" :title="text.server.stopConfirm.title" :body="text.server.stopConfirm.body" :confirm-label="P.stop" @confirm="doStop" />
  </div>
</template>

<script setup lang="ts">
import { songTitle } from "../../../src/ui/text/ko/labels.ts";
import { nextLoopMode } from "../../../src/rules/loop-cycle.ts";
import { problemText, noticeText } from "../utils/problem.ts";
import { useGuildsStore, onGuildNudge } from "../stores/guilds.ts";
import { notify, notifyProblem } from "../composables/toasts.ts";
import { problemCodeOf, replyOf } from "../utils/request.ts";
import { useScrollFade } from "../composables/scroll-fade.ts";
import { accepts, canRemove as removeAllowed, clockOf, moveTarget, onTrackOf, positionAt, previousEnabled, retime, skipEnabled } from "../utils/playback.ts";
import { reordered } from "../utils/reorder.ts";
import { withReadFields, type PlayerSeen } from "../utils/playback.ts";
import { useSeekBar } from "../composables/seek-bar.ts";
import { useArtSwipe } from "../composables/art-swipe.ts";
import { useBusy } from "../composables/busy.ts";
import { usePointerReorder } from "../composables/pointer-reorder.ts";
import { TOPBAR_BTN, TOPBAR_TEXT_BTN } from "../utils/topbar.ts";
import { PHONE_QUERY, SHORT_QUERY } from "../utils/breakpoints.ts";
import { useOverflowing } from "../composables/overflowing.ts";
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useCloseLayer } from "../composables/close-layer.ts";
import { useRoute, useRouter } from "vue-router";
import { useElementSize, useMediaQuery } from "@vueuse/core";
import axios from "axios";
import BaseButton from "../components/BaseButton.vue";
import Icon from "../components/BaseIcon.vue";
import VolumeIcon from "../components/VolumeIcon.vue";
import VolumeSlider from "../components/VolumeSlider.vue";
import AppWindow from "../shell/AppWindow.vue";
import QueueSheet from "../components/QueueSheet.vue";
import { shell } from "../shell/shell-state.ts";
import PageError from "../components/PageError.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import TrackArt from "../components/TrackArt.vue";
import MarqueeText from "../components/MarqueeText.vue";
import ArtLightbox from "../components/ArtLightbox.vue";
import PlayerActions from "../components/PlayerActions.vue";
import PlayerControls from "../components/PlayerControls.vue";
import QueueAddBox from "../components/QueueAddBox.vue";
import SeekRow from "../components/SeekRow.vue";
import TrackChips from "../components/TrackChips.vue";
import VoiceLockOverlay from "../components/VoiceLockOverlay.vue";
import { platformColor } from "../utils/platform-color.ts";
import { HOLD, NO_ART, prefetchArt, releasePageArt, setPageArt, SHIFT_MS } from "../theme/theme.ts";
import { useArtContent, useArtZoom } from "../theme/art.ts";
import { useVolumeControl } from "../composables/volume-control.ts";
import { formatDuration } from "../../../src/ui/format.ts";
import { categoryLabel, isSkipCategory, type SkipCategory } from "../../../src/rules/sponsor-categories.ts";
import { QUEUE_PAGE, modeOf, type AutoplayGenres, type PlayerRead, type PlayerState, type QueuePage, type QueueTrackView } from "../../../src/dashboard/contract/player.ts";
import type { IconName } from "../icons.ts";
import { text } from "../text/index.ts";
const P = text.player;
const T = text.server;

// 볼륨 버튼(좁은 창 · 휴대폰). 누르는 동안 모서리가 줄어든다(하이라이트 · 정지 PlayerActions 와 같은 모양)
const ROUND_BTN = "tap state-layer size-10 shrink-0 rounded-[50%] flex items-center justify-center cursor-pointer transition-[border-radius] spring-fast active:not-disabled:rounded-[30%] disabled:opacity-38 disabled:cursor-not-allowed";

const route = useRoute();
const router = useRouter();
const guildId = String(route.params.guildId);
const loading = ref(true);
const loadError = ref(""); // 처음 읽기가 실패했다. 기본 상태("곡 없음")를 진짜처럼 보이지 않게 까닭과 다시 시도를 표시한다
// 처음 읽기의 실패가 서버가 없거나 멤버가 아니어서다(다시 해도 같다)
const loadGone = ref(false);
const GONE = ["guild-not-found", "no-guild-access"];
// 처음 읽기 전의 모양. 봇이 없는 서버와 같다
const player = ref<PlayerSeen>({ boot: 0, seq: 0, playing: false, paused: false, queue: [], queueTotal: 0, currentTrack: null, volume: 100, loop: false, hasLive: false, botInVoice: false, userInVoice: false, sameVoice: false, hasPlayer: false, canControl: false, canAdd: false, canManage: false, userId: "", hasPrevious: false });

// 대기열은 앞에서부터 한 페이지씩 받는다. 서버 응답도 지금 펼쳐 둔 만큼(loadedCount)만 싣는다.
const loadedCount = ref(QUEUE_PAGE);
const loadingMore = ref(false);
const queueBoxRef = ref<HTMLElement | null>(null);
// 더 있는 쪽 끝 반 줄(32)을 흐리게(봇 상태 · 서버 관리의 목록과 같다)
const queueFade = useScrollFade(queueBoxRef, () => true, 32);
// 조작 응답도 상태를 통째로 돌려주므로 모든 호출에 창 크기를 실어 보낸다. 안 그러면 목록이 접힌다.
const qs = () => `?queue=${loadedCount.value}`;

const showStopConfirm = ref(false);

// 대기열 끌기(핸들, composables/pointer-reorder). 끄는 동안(isDragging)은 받은 서버 대기열을 미룬다
const isDragging = ref(false);
// 끄는 동안 받은 서버 대기열. 끄는 그 필드만 미루고(다른 필드는 바로 넣는다) 끌기가 끝나면 넣는다
let heldQueue: Pick<PlayerState, "queue" | "queueTotal"> | null = null;

// 진행 시계: 받은 위치 + 지난 시간(utils/playback). 1초마다 now 만 바꾼다
const clock = ref(clockOf(null, 0));
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | undefined;
let nudgeTimer: ReturnType<typeof setTimeout> | undefined;
// 진행 막대 요소. 화면마다 SeekRow 가 하나라 누를 때 그 요소를 잡는다(grabSeek)
const progressBarRef = ref<HTMLElement | null>(null);

// 응답을 기다리는 조작(넘기기 · 이전 · 정지 · 섞기 · 빼는 항목 · 옮기기). 그동안 그 버튼을 끈다
const { isBusy, whileBusy } = useBusy();

// ── 상태 ──────────────────────────────────────────────────────────────────────

// 받은 재생 상태를 넣는다. 늦게 온 옛 상태는 버린다(만든 순서). 조작 응답에 없는 읽기 전용 필드(권한 · 음성)는 지금 값을 남긴다(utils/playback).
// 대기열을 끄는 동안에는 대기열만 미룬다
function applyState(data: PlayerState | PlayerRead) {
  if (!accepts(player.value, data)) return;
  let next = withReadFields(player.value, data);
  if (isDragging.value) {
    heldQueue = { queue: next.queue, queueTotal: next.queueTotal };
    next = { ...next, queue: player.value.queue, queueTotal: player.value.queueTotal };
  }
  player.value = next;
  clock.value = clockOf(next, Date.now());
  syncLoaded();
}

// 곡이 빠져 큐가 줄면 펼쳐 둔 창도 같이 줄인다. 안 그러면 바닥에 닿아도 더 받을 게 없다고 판단한다.
function syncLoaded() {
  loadedCount.value = Math.max(QUEUE_PAGE, player.value.queue?.length || 0);
}

async function loadMore() {
  const total = player.value.queueTotal ?? 0;
  if (loadingMore.value || isDragging.value || player.value.queue.length >= total) return;
  loadingMore.value = true;
  try {
    const res = await axios.get<QueuePage>(`/api/guilds/${guildId}/player/queue`, { params: { offset: player.value.queue.length, limit: QUEUE_PAGE } });
    // 받는 사이에 큐가 바뀌었을 수 있다. 지금 길이보다 뒤에 있는 것만 이어 붙인다.
    const fresh = (res.data.items || []).filter((t) => t.index >= player.value.queue.length);
    player.value = { ...player.value, queue: [...player.value.queue, ...fresh], queueTotal: res.data.total };
    syncLoaded();
  } catch (e) {
    notifyProblem(e, T.failed.queueMore);
  } finally {
    loadingMore.value = false;
  }
}

function onQueueScroll(e: Event) {
  const el = e.target as HTMLElement;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) void loadMore();
}

// 봇과 다른 채널(또는 음성 밖)이면 서버가 조작을 전부 막는다. 카드를 가려 이유를 먼저 보여준다.
// 모더레이터는 checkVoice 면제라 canControl이 참이므로 여기 걸리지 않는다.
const channelLocked = computed(() => !player.value.canControl && player.value.botInVoice && !player.value.sameVoice);

async function refresh() {
  try {
    const res = await axios.get<PlayerRead>(`/api/guilds/${guildId}/player${qs()}`);
    applyState(res.data);
    loadError.value = "";
  } catch (e) {
    // 처음 읽기면 화면에 까닭을, 그 뒤면 알림으로(지금 화면은 둔다)
    if (loading.value) {
      loadError.value = problemText(e, T.failed.state);
      loadGone.value = GONE.includes(problemCodeOf(replyOf(e)) ?? "");
    } else notifyProblem(e, T.failed.state);
  } finally {
    loading.value = false;
  }
}

function retryLoad() {
  loading.value = true;
  loadError.value = "";
  void refresh();
}

// ── 조작 ─────────────────────────────────────────────────────────────────

// 응답을 기다리는 조작. 응답의 상태를 넣고, 거절되면 알리고 다시 읽는다
async function send(key: string, path: string, body: object | undefined, fallback: string): Promise<boolean> {
  const done = await whileBusy(key, async () => {
    try {
      applyState((await axios.post<PlayerState>(`/api/guilds/${guildId}/player/${path}${qs()}`, body)).data);
      return true;
    } catch (e) {
      notifyProblem(e, fallback);
      void refresh();
      return false;
    }
  });
  return done === true;
}

// 넘기기 · 이전은 누른 때의 곡일 때만 하게 항목 번호를 싣는다(그 사이 바뀌면 서버가 거절한다)
const skip = () => send("skip", "skip", onTrackOf(player.value), P.failed.skip);
const previous = () => send("previous", "previous", onTrackOf(player.value), P.failed.previous);
// 휴대폰 앨범아트를 좌우로 밀어 곡 넘기기
const artSwipeEl = ref<HTMLElement | null>(null);
const artSwipe = useArtSwipe(artSwipeEl, {
  canNext: () => skipEnabled(player.value) && !isBusy("skip"),
  canPrevious: () => previousEnabled(player.value) && !isBusy("previous"),
  next: skip,
  previous,
});
const shuffle = () => send("shuffle", "shuffle", undefined, P.failed.shuffle);

// 일시정지는 먼저 바꿔 보이고, 거절되면 다시 읽어 되돌린다
function togglePause() {
  if (isBusy("pause")) return;
  const paused = !player.value.paused;
  const current = player.value.currentTrack;
  clock.value = retime(clock.value, Date.now(), { running: Boolean(current && player.value.playing && !paused) });
  player.value = { ...player.value, paused };
  void send("pause", "pause", undefined, P.failed.pause);
}

// 반복도 먼저 바꿔 보인다. 다음 모드는 디스코드 반복 버튼과 같은 순환(rules/loop-cycle)이고, 정할 값은 서버가 돌려준 상태가 정한다
function cycleLoop() {
  if (isBusy("loop")) return;
  const mode = nextLoopMode(player.value.loop ?? false);
  player.value = { ...player.value, loop: mode };
  void send("loop", "loop", { mode: modeOf(mode) }, P.failed.loop);
}

// 끄는 동안 바로 틀고 끄는 값을 보여 준다(composables/volume-control)
const {
  shown: volumeShown,
  input: volumeInput,
  change: volumeChange,
} = useVolumeControl(
  computed(() => player.value.volume),
  async (level) => {
    const res = await axios.post<PlayerState>(`/api/guilds/${guildId}/player/volume${qs()}`, { volume: level });
    if (res.data?.volume !== undefined) applyState(res.data);
  },
);

// 정지는 응답을 기다리고 서버가 돌려준 상태를 쓴다. 봇이 나가 음성 필드도 바뀌므로 한 번 더 읽는다
async function doStop() {
  showStopConfirm.value = false;
  if (await send("stop", "stop", undefined, T.failed.stop)) void refresh();
}

// 빼기는 그 항목 번호로(그 사이 대기열이 바뀌어도 그 곡). 응답을 기다린다
async function removeTrack(track: QueueTrackView) {
  const entry = track.entry;
  if (entry === null || !Number.isInteger(entry)) return;
  await whileBusy(`remove:${entry}`, async () => {
    try {
      applyState((await axios.delete<PlayerState>(`/api/guilds/${guildId}/player/queue/entry/${entry}${qs()}`)).data);
    } catch (e) {
      notifyProblem(e, T.failed.remove);
      void refresh();
    }
  });
}

// ── 대기열 끌어 옮기기 ───────────────────────────────────────────────────────

const { startDrag } = usePointerReorder({
  // 놓으면 moveQueue 가 위치를 정하고 미뤄 둔 것을 넣는다. end 는 그 뒤(놓지 않고 끝난 때도)
  enabled: () => Boolean(player.value.canControl) && !isBusy("move"),
  start: () => (isDragging.value = true),
  end: releaseHeld,
  drop: (from, insertAt) => void moveQueue(from, insertAt),
});

// 끌기가 끝났다(놓음 · 취소). 끄는 동안 미뤄 둔 서버 대기열을 넣는다
function releaseHeld() {
  isDragging.value = false;
  if (heldQueue) {
    player.value = { ...player.value, ...heldQueue };
    heldQueue = null;
    syncLoaded();
  }
}

// 놓은 위치는 끄는 동안 본 목록 기준이다. 미뤄 둔 서버 대기열을 넣기 전에 정한다
async function moveQueue(from: number, insertAt: number) {
  const queue = player.value.queue;
  const target = moveTarget(queue, from, insertAt, player.value.queueTotal ?? queue.length);
  releaseHeld();
  if (target === "same") return;
  if (target === "partial") return notify({ ...T.moveNeedsAll, severity: "warning" });
  if (target === "unknown") return refresh();
  // 응답을 기다리는 동안 옮긴 순서로 보인다. 거절되면 다시 읽어 서버 순서로 돌린다
  player.value = { ...player.value, queue: reordered(queue, from, insertAt) };
  await send("move", "queue/move-entry", target, T.failed.move);
}

// ── 계산 값 ──────────────────────────────────────────────────────────────────

const isLive = computed(() => !!player.value.currentTrack?.isLive);
// 길이를 알아야 위치를 옮길 수 있다. 라이브에는 실시간밖에 없어 옮길 위치가 없다.
const seekable = computed(() => (player.value.currentTrack?.duration ?? 0) > 0 && !isLive.value);

// 탐색 막대(composables/seek-bar). 놓은 위치를 먼저 보이고 보낸다. 거절되면 다시 읽어 핸들이 서버 위치로 돌아간다
const seekBar = useSeekBar({
  el: progressBarRef,
  duration: () => player.value.currentTrack?.duration ?? 0,
  enabled: () => seekable.value && Boolean(player.value.canControl),
  entry: () => player.value.currentTrack?.entry ?? null,
  send: (sec, entry) => {
    clock.value = retime(clock.value, Date.now(), { at: sec });
    void send("seek", "seek", { position: sec, ...(Number.isInteger(entry) ? { onTrack: entry } : {}) }, P.failed.seek);
  },
});
const isScrubbing = seekBar.dragging;
function grabSeek(e: PointerEvent) {
  progressBarRef.value = e.currentTarget as HTMLElement;
  seekBar.onPointerDown(e);
}
const displayTime = computed(() => (isScrubbing.value ? seekBar.value.value : positionAt(clock.value, now.value)));

// 재생 중일 때 진행 막대가 1초에 나아가는 %(막대가 그 사이를 스스로 채운다)
const progressRate = computed(() => (clock.value.running && seekable.value && !isScrubbing.value ? 100 / (player.value.currentTrack?.duration || 1) : 0));
const progressPct = computed(() => {
  const t = player.value.currentTrack;
  if (!t?.duration) return 0;
  return Math.min((displayTime.value / t.duration) * 100, 100);
});

// 카테고리 → SponsorBlock 공식 색상 CSS 변수명 매핑
const SB_COLOR_VAR: Record<SkipCategory, string> = {
  sponsor: "sponsor",
  selfpromo: "selfpromo",
  interaction: "interaction_reminder",
  intro: "intro",
  outro: "endcards",
  preview: "preview",
  hook: "hook",
  music_offtopic: "nonmusic",
  filler: "tangents",
};

// SponsorBlock 자동 스킵 구간 → 진행바 상 위치(%) + 카테고리별 공식 색상. 하이라이트 지점도 %로.
const sponsorMarkers = computed(() => {
  const t = player.value.currentTrack;
  const dur = t?.duration || 0;
  if (!dur || !Array.isArray(t?.sponsorSegments)) return [];
  return t.sponsorSegments.map((s) => {
    const left = Math.max(0, Math.min(100, (s.start / dur) * 100));
    const right = Math.max(0, Math.min(100, (s.end / dur) * 100));
    const cat = (s.categories && s.categories[0]) || "music_offtopic";
    // 이름은 봇의 것(rules/sponsor-categories, 디스코드 설정 화면과 같다)
    const label = (s.categories && s.categories.length ? s.categories : [cat]).map(categoryLabel).join(", ");
    return { left, width: Math.max(0.4, right - left), color: `var(--category-${isSkipCategory(cat) ? SB_COLOR_VAR[cat] : "nonmusic"}-color)`, label };
  });
});
const highlightMarker = computed(() => {
  const t = player.value.currentTrack;
  const dur = t?.duration || 0;
  const h = t?.highlightAt;
  if (!dur || h === null || h === undefined) return null;
  return Math.max(0, Math.min(100, (h / dur) * 100));
});
// 진행 줄(SeekRow): 시간 글 · 막대. 라이브의 경과 시간은 곡 안의 위치가 아니라 붙어 있은 시간이라 표식으로 대신한다
const timeText = computed(() => (!track.value ? "--:--" : isLive.value ? P.live : formatDuration(displayTime.value)));
const lengthText = computed(() => (track.value && track.value.duration > 0 ? formatDuration(track.value.duration) : "--:--"));
const seekView = computed(() => ({ value: track.value ? progressPct.value : 0, rate: progressRate.value, markers: sponsorMarkers.value, highlight: highlightMarker.value, handle: Boolean(track.value) && seekable.value && Boolean(player.value.canControl), dragging: isScrubbing.value }));

// 하이라이트로 가기. 누른 때의 곡일 때만
function jumpToHighlight() {
  const h = player.value.currentTrack?.highlightAt;
  if (h === null || h === undefined) return;
  clock.value = retime(clock.value, Date.now(), { at: h });
  void send("highlight", "highlight", onTrackOf(player.value), T.failed.highlight);
}

// 아트의 위아래 검은 띠는 키워서 감춘다(theme/art 가 픽셀로 잰다)
const artZoom = useArtZoom(() => player.value.currentTrack?.thumbnail, true);
const artContent = useArtContent(() => player.value.currentTrack?.thumbnail);

const track = computed(() => player.value.currentTrack);
// 지금 곡의 그림. 불러오지 못하면(곡이 바뀐 뒤 늦게 불린 그림 등) 아이콘으로
const brokenArt = ref<string | null>(null);
const artShown = computed(() => (track.value?.thumbnail && track.value.thumbnail !== brokenArt.value ? track.value.thumbnail : null));
// 지금 곡을 내가 넣었는지(출처 배지의 "내가 넣은 곡")
const mine = computed(() => track.value?.requestedBy?.id === player.value.userId);
// 가림막은 곡이 있을 때만. 곡이 없으면 가릴 조작이 없다
const locked = computed(() => Boolean(track.value) && channelLocked.value);

// 휴대폰 볼륨 말풍선
const volumeOpen = ref(false);

// 휴대폰 아래 줄의 볼륨 막대. 줄이 넓으면 늘 펼쳐 두고(volumeInline), 좁으면 누를 때 펼친다(volumeExpand). 손대지 않으면 3초 뒤 · 바깥을 누르면 접는다
const volRowEl = ref<HTMLElement | null>(null);
const { width: volRowWidth } = useElementSize(volRowEl);
const volumeInline = computed(() => volRowWidth.value >= 400);
const volumeExpand = ref(false);
let volumeTimer = 0;
function volumeTouched() {
  volumeExpand.value = true;
  clearTimeout(volumeTimer);
  volumeTimer = window.setTimeout(() => (volumeExpand.value = false), 3000);
}
function volumeOutside(e: PointerEvent) {
  if (volumeExpand.value && !volRowEl.value?.contains(e.target as Node)) volumeExpand.value = false;
}
onMounted(() => document.addEventListener("pointerdown", volumeOutside, true));
onUnmounted(() => {
  document.removeEventListener("pointerdown", volumeOutside, true);
  clearTimeout(volumeTimer);
});

// 앨범아트 크게 보기(ArtLightbox)
const artOpen = ref(false);

// 휴대폰: 큰 그림 플레이어 + 대기열 바텀 시트(스포티파이식)
const isPhone = useMediaQuery(PHONE_QUERY);
// 낮은 화면(휴대폰 가로): 플레이어를 그림 | 나머지 두 단으로
const short = useMediaQuery(SHORT_QUERY);
const sheetMode = computed(() => isPhone.value);
// 판이 접혔을 때 헤더에 보이는 다음 곡
const nextTitle = computed(() => (player.value.queue[0] ? songTitle(player.value.queue[0].title) : ""));
useCloseLayer(volumeOpen, () => (volumeOpen.value = false));

// 헤더 아래 한 줄: 나와 봇의 음성 채널
const voiceLine = computed((): { icon: IconName; text: string } => {
  const p = player.value;
  if (p.sameVoice) return { icon: "headphones", text: T.voice.same };
  if (p.botInVoice) return { icon: "headset_off", text: p.userInVoice ? T.voice.botElsewhere : T.voice.botInVoice };
  return { icon: "bedtime", text: p.userInVoice ? T.voice.userOutside : T.voice.resting };
});

// 자동재생: 지금 장르는 재생 상태가 싣는다. 장르 목록은 메뉴를 처음 열 때 불러온다(디스코드 장르 메뉴와 같은 것)
const autoplayGenre = computed(() => player.value.autoplayGenre ?? null);
const autoplayGenreLabel = computed(() => player.value.autoplayGenreLabel ?? null);
const genres = ref<AutoplayGenres["genres"]>([]);
const genreMenu = ref(false);
useCloseLayer(genreMenu, () => (genreMenu.value = false));
// 장르 메뉴를 위로 열지(버튼 아래 공간이 메뉴 높이 320 + 여유보다 좁으면)
const genreMenuUp = ref(false);
async function toggleGenreMenu(e: MouseEvent) {
  if (!genreMenu.value) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    genreMenuUp.value = window.innerHeight - r.bottom < 340 && r.top > window.innerHeight - r.bottom;
    if (!genres.value.length) {
      try {
        genres.value = (await axios.get<AutoplayGenres>(`/api/guilds/${guildId}/autoplay/genres`)).data.genres;
      } catch (err) {
        return notifyProblem(err, T.failed.genres);
      }
    }
  }
  genreMenu.value = !genreMenu.value;
}
const genreMenuEl = ref<HTMLElement | null>(null);
const genreOverflowing = useOverflowing(genreMenuEl);
// 켜기(장르) · 끄기(null). 응답의 상태를 넣는다
function setAutoplay(genre: string | null) {
  genreMenu.value = false;
  void send("autoplay", "autoplay", { genre }, genre ? T.failed.autoplayOn : T.failed.autoplayOff);
}
const pickGenre = (name: string) => setAutoplay(name);

// 처음 그릴 때는 화면에 보이는 만큼만 만들고, 나머지는 색이 옮겨 간 뒤 한가할 때 붙인다.
// 100행을 한 번에 만들면 그 프레임이 길어져 색 옮김의 첫 단계가 걸린다(아래쪽 행은 화면 밖이라 늦게 붙어도 보이지 않는다)
const FIRST_ROWS = 30;
const rowLimit = ref(FIRST_ROWS);
const shownQueue = computed(() => player.value.queue.slice(0, rowLimit.value));
// 대기열 번호 열 폭: 보이는 가장 큰 번호의 자릿수(두 자리 이상)만큼. 모든 행이 같은 폭이라 제목이 나란하다
const numWidth = computed(() => `${Math.max(2, String(shownQueue.value.length).length) + 0.5}ch`);
watch(loading, (isLoading) => {
  if (isLoading) return;
  setTimeout(() => {
    const all = () => (rowLimit.value = Infinity);
    if ("requestIdleCallback" in window) requestIdleCallback(all, { timeout: 1000 });
    else all();
  }, SHIFT_MS + 150);
});

// 대기열 전체 길이. 다 불러온 때만(일부만 더하면 틀린 값이 된다)
const queueSeconds = computed(() => {
  const p = player.value;
  if (p.queue.length < (p.queueTotal ?? 0)) return null;
  return p.queue.reduce((sum, t) => sum + (t.duration || 0), 0);
});

// 다음 곡의 그림을 미리 읽어 둔다. 곡이 넘어가는 순간 색이 바로 옮겨 간다(theme)
watch(
  () => player.value.queue[0]?.thumbnail,
  (url) => prefetchArt(url),
  { immediate: true },
);

// 이 서버의 곡이 화면 색 · 배경화면이 된다(theme). 처음 읽는 동안은 지금 색을 붙잡아 둔다(서버를 옮길 때 다른 색을 들르지 않게)
const artOwner = Symbol("server");
watch(
  () => (loading.value ? HOLD : (player.value.currentTrack?.thumbnail ?? NO_ART)),
  (url) => setPageArt(artOwner, url),
  { immediate: true },
);

// 실시간 신호는 탭의 목록 연결 하나에서 받는다(stores/guilds). 이 서버의 신호 · 어느 서버인지 모르는 신호(끊긴 뒤 따라잡기 · 끊긴 동안의 주기 읽기)면 다시 읽는다.
// 연달아 조작하면 신호도 연달아 온다. 합쳐서 한 번만 다시 읽는다
const guilds = useGuildsStore();
let offNudge: (() => boolean) | null = null;
onMounted(() => {
  void refresh();
  guilds.subscribe();
  offNudge = onGuildNudge((changed) => {
    if (changed && changed !== guildId) return;
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(refresh, 600);
  });
  ticker = setInterval(() => (now.value = Date.now()), 1000);
});
onUnmounted(() => {
  releasePageArt(artOwner);
  offNudge?.();
  guilds.unsubscribe();
  clearInterval(ticker);
  clearTimeout(nudgeTimer);
});
</script>

# Discord Musicbot Project

한국어 UI 기반의 개인용 Discord 음악 봇.

일부 봇들과 달리 **음악 봇**임에 집중하여 불필요한 기능을 줄였으며, yt-dlp를 기반으로 사용자가 직접 호스팅하기에 대형 클라우드 서비스 봇에 비해 안정적입니다.

[![discord.js](https://img.shields.io/badge/discord.js-14-blue?style=flat-square&logo=discord.js)](https://discord.js.org/)
[![Node.js](https://img.shields.io/badge/24.11%2B-x?logo=Node.js&logoColor=green&label=Node.js&color=green&style=flat-square)](https://nodejs.org/)
[![Typescript](https://img.shields.io/badge/typescript-6.0-blue?logo=typescript&style=flat-square)](https://www.typescriptlang.org/)
[![Vue](https://img.shields.io/badge/Vue-3-mediumseagreen?logo=vue.js&style=flat-square)](https://vuejs.org/)
[![Vite](https://img.shields.io/badge/vite-8-blueviolet?logo=vite&style=flat-square)](https://vite.dev/)
[![Tailwind CSS](https://img.shields.io/badge/tailwindcss-4-%2306B6D4?logo=tailwindcss&style=flat-square)](https://tailwindcss.com/)
![라이선스](https://img.shields.io/github/license/PLeC98/Discord-Musicbot-Project?style=flat-square)

## 주요 기능

### 음악 플레이어

- **재생 소스**: YouTube, Spotify, SoundCloud, 직접 오디오 링크
- **대기열 관리**: 우선 재생, 섞기, 반복, 순서 변경, 건너뛰기, 이전 곡, 일시 정지/재개
- **긴 재생목록 나눠 넣기**: 재생목록은 한 번에 정해진 곡 수(기본 50, `/setplaylistlimit`로 서버별 지정)만 넣고, 남은 곡은 "더 넣기" 메뉴로 이어 넣음. 대기열 총량은 `.env` `QUEUE_MAX_TRACKS`(기본 250)로 제한
- **Components V2 재생 UI**: 진행 바, 컨트롤 버튼, 대기열 점프 셀렉트 메뉴가 달린 now-playing 메시지 (웹훅)
- **SQLite 오디오 캐시**: 재생한 곡을 로컬 캐싱, 캐시를 활용한 오류 복구·빠른 다회 재생 반응성 등 확보, 재생 빈도·최근성·전체 캐시 용량·디스크 여유 공간 기반 자동 정리
- **세션 저장/복구**: `/leave`로 대기열·재생 위치를 저장하고 `/join`으로 복구. 봇 재시작 시에도 자동 복구
- **봇 전용 채널**: `/setchannel`로 지정한 채널에 곡명/링크만 입력하면 자동 재생. 재생 패널이 채널 하단에 상주하고, 곡이 끝나면 같은 자리에서 대기 모양으로 바뀜
- **장르 자동재생**: 선택한 장르의 곡을 자동 탐색·재생. 재생 중에도 다음 곡을 미리 받아 둬 곡 사이가 비지 않음. `config/genres.yaml`에서 장르, 검색 키워드, 메타데이터 소스를 직접 설정 가능하며, 해당 설정은 핫 리로드 가능.
  - 사용 가능한 소스: Last.fm, ListenBrainz Radio, AnisongDB, AnimeThemes, VocaDB, UtaiteDB, TouhouDB, 스포티파이/유튜브 재생목록. 섞어서 사용 가능, 소스별 가중치 설정 가능.
- **[자동재생 AI 보조](#자동재생-ai-보조-선택-configaiyaml)**: 곡 이름만 아는 출처에서 고른 후보를 모델에게 한 번 더 판정시켜 믹스, 타 장르 등을 걸러냄. 로컬 모델부터 클라우드까지 붙일 수 있고, 못 부르면 규칙만으로 돌아감
- **DJ 역할 지정**: `/setdjrole`로 역할을 지정 가능. 권한이 없다면, 곡 추가와 자기가 추가한 곡의 스킵 / 제거, 조회만 가능.
- **SponsorBlock 자동 스킵**: 음악이 아닌 구간을 [SponsorBlock](https://sponsor.ajay.app/) 데이터로 자동 건너뜀. `/sponsorblock` 또는 웹 대시보드에서 서버별로 사용 여부·건너뛸 카테고리를 지정. 커뮤니티 하이라이트 지점으로 점프하는 `/highlight`도 제공. (동작·라이선스는 아래 [SponsorBlock](#sponsorblock) 참조)

### 웹 대시보드

- **Discord OAuth 로그인**: 안전한 권한 기반의 접근 제어 제공
- **음악 제어**: 디스코드 내에서 할 수 있는 모든 기능을 더 편리하게
- **채널 설정 관리**: DJ 역할, 전용 채널 설정, SponsorBlock 설정, 재생목록 한 번에 넣는 곡 수
- **봇 운영자 패널**: 봇 상태, WebSocket 핑, 운영 시스템 상태, 전체 공지, 터미널 로그, 봇이 참여중인 서버 관리, 커맨드 재배포

### 비주얼

- **상태 메시지 로테이션**: 시간대·양력/음력 날짜 조건부 봇 상태 메시지 (`config/status.yaml`)
- **음성 채널 상태 표시**: 재생 중인 곡 제목을 음성 채널 상태에 자동 반영

## 명령어

| 분류   | 명령어                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------- |
| 재생   | `/play` `/playfirst` `/search` `/pause` `/seek` `/replay` `/skip` `/previous` `/stop` `/highlight` |
| 대기열 | `/queue` `/shuffle` `/loop` `/move` `/remove` `/clear` `/autoplay`                                 |
| 채널   | `/join` `/leave` `/setchannel` `/setdjrole` `/setplaylistlimit`                                    |
| 정보   | `/nowplaying` `/help` `/ping` `/system` `/cachestatus` `/dashboard` `/license`                     |
| 기타   | `/volume` `/sponsorblock`                                                                          |

## 설치 및 실행

### 요구 사항

- Windows / Linux (개발 / 유지보수 환경: **Windows 10, Ubuntu 24**)
- [Node.js](https://nodejs.org/ko/download) >=24.3.0 (개발 / 유지보수 환경: **>= 24.14.0**)
  - 이론상 동작 하한치는 22.18.0부터이나, 테스트 스크립트가 24.3.0부터 정상 동작.
- C++ 빌드 툴체인 (C++20 지원 컴파일러): `@discordjs/opus`의 프리빌드 바이너리가 Node 22 이하 ABI까지만 배포되어 있어, Node 23 이상에서는 소스 컴파일로 폴백. 툴체인이 없으면 `pnpm install`이 실패함.
  - Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/ko/downloads/) 2022(17.x) 이상 + "C++를 사용한 데스크톱 개발" 워크로드, Python 3.9 이상
    - VS2019 이하는 Node 22+ 지원 대상이 아니라 사용 불가
  - Linux: g++ 12.2 이상 (또는 상응하는 clang) + make + python3 3.9 이상
    - Ubuntu 24.04 이상은 `sudo apt install -y build-essential python3`로 충족. 기본 gcc가 12 미만인 배포판(Ubuntu 22.04 = gcc 11 등)은 `g++-12` 이상을 별도 설치. 시스템 libopus 패키지는 불필요. (opus 소스가 번들되어 함께 컴파일됨)
- [pnpm](https://pnpm.io/)
- 저장소 `clone`을 위한 [git](https://git-scm.com/)
- ffmpeg: Windows / Linux(x64·arm64)는 `pnpm install` 시 [BtbN 빌드](https://github.com/BtbN/FFmpeg-Builds)를 `bin/`에 자동으로 내려받습니다. **별도 설치가 필요 없습니다**.
  - Linux의 `.tar.xz` 해제에 `xz-utils`가 필요합니다 (대부분의 배포판에 기본 포함).
  - **macOS는 자동 설치 대상이 아닙니다** (BtbN이 macOS 빌드를 제공하지 않음). `brew install ffmpeg`로 설치해 PATH에 두거나 `.env`의 `FFMPEG_PATH`로 지정하세요.
  - 시스템에 이미 쓰던 ffmpeg가 있으면 `.env`의 `FFMPEG_PATH`로 지정할 수 있고, 그러면 자동 다운로드를 건너뜁니다.
- [디스코드 개발자 포털](https://discord.com/developers/applications)에서 생성된 디스코드 어플리케이션 및 디스코드 봇

### 설정

```bash
git clone https://github.com/PLeC98/Discord-Musicbot-Project.git
cd Discord-Musicbot-Project
pnpm install
cp .env.example .env   # 이후 .env 편집
```

`.env` 필수 항목:

| 변수                                          | 설명                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`                               | 봇 토큰                                                                                |
| `CLIENT_ID` / `CLIENT_SECRET`                 | Discord 애플리케이션 ID / 시크릿 (시크릿은 대시보드 OAuth용)                           |
| `GUILD_ID`                                    | 테스트 서버 ID (즉시 커맨드 배포). 비우면 글로벌 배포 (최대 1시간 소요)                |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Spotify 링크 지원용 ([developer.spotify.com](https://developer.spotify.com/dashboard)) |

### 유튜브 접속 클라이언트 경로 (선택)

`.env`의 `YTDLP_PLAYER_CLIENTS` 옵션으로 유튜브 영상 스트림/다운로드에 사용할 클라이언트를 지정할 수 있습니다.
지정하지 않으면 yt-dlp의 기본 값을 사용합니다.

여러 클라이언트를 적어 예비를 둘 수 있습니다. 앞에서부터 시도하고 실패하면 다음으로 폴백하며, 자주 실패하는 갈래는 접근이 차단된 클라이언트로 판단하여 해당 실행 세션 중에는 건너뜁니다.

예시:

```
YTDLP_PLAYER_CLIENTS=web_embedded,mweb,visionos,tv_simply
```

#### 클라이언트별 사용 가능 여부

- 작성 기준일: 2026/09/22. 날짜, 환경, 계정 상태, yt-dlp 버전 등에 따라 다를 수 있습니다.
- 범례:
  - [권장] **Opus**: Opus로 받기에 바로 사용하거나 리먹싱만을 필요로 합니다. (itag 250, 251)
  - [비권장] _AAC_: AAC 코덱으로 받기에 인코딩이 필요합니다. (itag 140)
  - [비권장] _360p mp4, HLS_: 영상과 오디오가 전부 포함된 것을 받습니다. (itag 18, 93~96)

| 클라이언트 /<br>쿠키-POT |              없음              |                        POT                         |     쿠키<br>(연령제한)      |             쿠키+POT<br>(연령제한)              | 비고                                                                |
| ------------------------ | :----------------------------: | :------------------------------------------------: | :-------------------------: | :---------------------------------------------: | ------------------------------------------------------------------- |
| (미지정)                 | (visionos)<br>**Opus**, _AAC_  | (visionos)<br>**Opus**, _AAC_<br>**(POT 미사용)**  | (web_creator)<br>_360p mp4_ | (web_creator)<br>**Opus**, _AAC_,<br>_360p mp4_ |                                                                     |
| mweb                     |           _360p mp4_           |           **Opus**, _AAC_,<br>_360p mp4_           |         _360p mp4_          |         **Opus**, _AAC_,<br>_360p mp4_          |                                                                     |
| web_embedded             | **Opus**, _AAC_,<br>_360p mp4_ | **Opus**, _AAC_,<br>_360p mp4_<br>**(POT 미사용)** |              X              |                        X                        | 임베드 가능한 영상만 가능<br>연령 제한: yt-dlp가 web_creator로 폴백 |
| visionos                 |        **Opus**, _AAC_         |        **Opus**, _AAC_<br>**(POT 미사용)**         |              X              |                        X                        | yt-dlp 기본값<br>쿠키 미지원                                        |
| tv_simply                |           _360p mp4_           |           **Opus**, _AAC_,<br>_360p mp4_           |              X              |                        X                        | 쿠키 미지원                                                         |
| android                  |           _360p mp4_           |           _360p mp4_<br>**(POT 미사용)**           |              X              |                        X                        | 안드로이드용 POT가 필요한 것으로 추정<br>쿠키 미지원                |
| android_vr               |           _360p mp4_           |           _360p mp4_<br>**(POT 미사용)**           |              X              |                        X                        | yt-dlp 曰: 어린이용 영상 불가<br>쿠키 미지원                        |
| web                      |               X                |          _360p mp4<br>(재생 성공률 낮음)_          |         _360p mp4_          |                   _360p mp4_                    | SABR (yt-dlp 미지원)로 인해<br>360p 영상만 **랜덤으로** 가능        |
| web_safari               |               X                |                         X                          |       _360p mp4, HLS_       |                 _360p mp4, HLS_                 |                                                                     |
| web_creator              |               X                |                         X                          |         _360p mp4_          |         **Opus**, _AAC_,<br>_360p mp4_          | web_embedded에서 **연령 제한시**<br>yt-dlp가 해당 클라이언트로 폴백 |
| ~~web_music~~            |               X                |                         X                          |              X              |                        X                        | 유튜브 뮤직 프리미엄 전용                                           |
| ~~ios~~                  |               X                |                         X                          |              X              |                        X                        | iOS용 POT 필요                                                      |
| ~~tv~~                   |               X                |                         X                          |              X              |                        X                        |                                                                     |
| ~~tv_downgraded~~        |               X                |                         X                          |              X              |                        X                        |                                                                     |

- 미지정시 yt-dlp 기본 작동 경로: `visionos`를 기본으로 사용하고, 쿠키가 제공되면 `web_embedded`를 사용하며, 연령 제한 영상일 경우, `web_embedded`는 연령 인증이 불가능하여 `web_creator`로 폴백하고 있습니다.
- bgutil은 웹 계열 POT 제공자이므로 Android/iOS용 DroidGuard·iOSGuard POT를 발급하지 못합니다.
  - 받아오는 포맷을 현재로써는 알 수 없어, POT를 발급받을 수 있다고 하더라도 사용이 가능하다는 보장은 없습니다.
- `web_music`은 유튜브 뮤직 프리미엄 전용이나, 구독 계정의 쿠키로 확인하지는 않았습니다.
  - 사용이 가능하다고 해도, 비 연령 제한 영상에서는 쿠키를 사용하지 않기에 재생은 불가능 할 것으로 추정됩니다.

| 클라이언트    | 권장도<br>(연령 제한은 포기) | 권장도<br>(연령 제한도 재생) | 제약/사유                                                                                     |
| ------------- | :--------------------------: | :--------------------------: | :-------------------------------------------------------------------------------------------- |
| (미지정)      |            **○**             | **○<br>쿠키 필수+POT 필수**  | 쿠키 없으면 연령 제한 영상은 영상 포맷만 가능                                                 |
| mweb          |      **○<br>POT 필수**       | **○<br>쿠키 필수+POT 필수**  | 쿠키 없으면 연령 제한 영상은 영상 포맷만 가능                                                 |
| web_embedded  |            **○**             | **○<br>쿠키 필수+POT 필수**  | 쿠키 없으면 연령 제한 영상은 영상 포맷만 가능<br>임베드 제한 영상 재생 불가                   |
| visionos      |            **○**             |              X               |                                                                                               |
| tv_simply     |      **○<br>POT 필수**       |              X               |                                                                                               |
| android       |              △               |              X               | 영상 포맷만 사용 가능                                                                         |
| android_vr    |              △               |              X               | 영상 포맷만 사용 가능                                                                         |
| web           |              X               |              X               | 영상 포맷만 사용 가능<br>일반 영상 재생시 POT가 필수이나, 그렇게 해도 높은 확률로 재생 실패.  |
| web_safari    |              X               |              X               | 항시 쿠키를 사용하는 모드는 봇에서 의도적으로 제공하지 않음.<br>- 일반 영상이 전부 재생 불가. |
| web_creator   |              X               |              X               | 항시 쿠키를 사용하는 모드는 봇에서 의도적으로 제공하지 않음.<br>- 일반 영상이 전부 재생 불가. |
| web_music     |              X               |              X               | 불가능                                                                                        |
| ios           |              X               |              X               | 불가능                                                                                        |
| tv            |              X               |              X               | 불가능                                                                                        |
| tv_downgraded |              X               |              X               | 불가능                                                                                        |

- 쿠키만 사용하는 경로는 의도적으로 제공되지 않습니다. 쿠키는 연령 제한 영상의 재생에만 사용합니다.
- 일부 클라이언트는 오디오만 수신이 불가능하여 360p 영상을 통째로 받습니다. 통신량 및 캐시 용량이 약 2배에서 4배까지 증가하기에 해당 클라이언트의 사용은 권장하지 않습니다.

### POToken 설정 (선택)

[Brainicism/bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) 를 사용합니다.

**하는 일**: 일부 클라이언트는 POToken 없이는 저화질 영상 코덱만을 제공합니다. 이 클라이언트들을 사용하는게 아니라면 실익은 없습니다. 연령 제한 영상의 재생을 위해 쿠키를 사용하는 경우, 오디오 코덱을 받기 위해서는 필수입니다.

```bash
pnpm run install:bgutil    # 클론 + 의존성 설치 + 빌드
```

설치한 뒤 `.env`에서 `BGUTIL_ENABLED=true`로 켜야 동작합니다. 켜면 봇 실행 시 POToken 서버(포트 4416)를 함께 띄웁니다. 켜두고 설치를 안 했으면 오류를 남기고 POToken 없이 진행합니다.

### 쿠키 설정 (연령 제한 영상 전용)

`.env`의 `COOKIES_SOURCE`로 지정 가능합니다.

| 값                                         | 동작                               |
| ------------------------------------------ | ---------------------------------- |
| (비움)                                     | 쿠키를 쓰지 않습니다.              |
| `chrome` · `firefox` · `edge` · `safari` … | 브라우저에서 가져옵니다.           |
| `file`                                     | `config/cookies.txt`를 사용합니다. |

`file`로 두면 **대시보드 운영자 화면에 "쿠키 설정" 탭이 생깁니다.** 브라우저 확장에서 복사한 내용을 대시보드에서 붙여넣어 갈아 끼울 수 있습니다.

> [!CAUTION]
> **쿠키는 연령 제한 영상에만 사용합니다.**
> 유튜브는 요청에 제한을 두고 있으며, 과다 사용 시 **계정이 (일시적 또는 영구적으로) 정지될 수 있습니다.** 요청 빈도와 다운로드 양에 주의하세요. 사용은 전적으로 운영자의 책임입니다.
>
> ([yt-dlp 문서](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies): 계정 기준 시간당 약 2000영상)

> [!IMPORTANT]
> 현재, 크롬/크로미움 기반 브라우저에서 "권한 거부"가 발생한다는 [yt-dlp의 이슈](https://github.com/yt-dlp/yt-dlp/issues/7271)가 있습니다. 브라우저 이름을 먼저 시도해 보고, 문제가 발생하면 `COOKIES_SOURCE=file`을 사용하시기 바랍니다.
>
> 크롬/엣지: [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)
>
> 파이어폭스: [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/)
>
> 자세한 것은 yt-dlp의 [유튜브 쿠키 추출하기](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#exporting-youtube-cookies)를 참고하세요.

**연령 제한 영상 재생**: 연령 제한 영상은 **인증된 쿠키가 필수**입니다.

- 연령 인증이 된 계정의 쿠키여야 합니다.
- 쿠키를 설정하지 않으면 연령 제한 영상은 재생이 불가능합니다.
- 캐시되지 않은 영상의 초회 시도에서 연령 제한 실패(≈3초)를 받으면 쿠키로 전환해 다시 시도합니다.
- 연령 제한 영상 여부는 캐싱되어, 오디오 캐시가 정리되어도 이후에는 처음부터 쿠키로 접근합니다.
- 연령 제한 영상은 재취득 비용이 크기에 오디오 캐시를 더 오래 보존합니다.

### 상태 메시지 (`config/status.yaml`)

봇의 Discord 상태 메시지를 시간대·날짜 조건에 따라 자동 전환합니다.

| 필드               | 설명                                                   |
| ------------------ | ------------------------------------------------------ |
| `rotationInterval` | 기본 메시지 전환 주기 (초)                             |
| `rotation`         | 기본 메시지 목록 (조건 없이 순환)                      |
| `scheduled`        | 조건부 메시지 목록 (위에서부터 첫 번째 일치 항목 적용) |

`scheduled` 각 항목에 조건과 메시지를 지정합니다:

```yaml
# 조건: dateRange(양력 MM-DD), lunarDateRange(음력 MM-DD), timeRange(HH:MM)
# 메시지: text(단일) 또는 rotation(복수 순환)
scheduled:
  # 크리스마스 (12/24~26)
  - dateRange: { start: 12-24, end: 12-26 }
    text: 🎄 메리 크리스마스!

  # 야간 (22:00~06:00)
  - timeRange: { start: 22:00, end: 06:00 }
    rotation:
      - text: 🌌 별빛 아래 음악
      - text: 🛌 잠들기 전 노래 한곡
```

> 설정 파일은 설치할 때 `config/*.example.yaml`에서 복사되며, 실제 파일은 저장소에 추적되지 않습니다.
> 그래서 취향대로 고쳐도 업데이트와 충돌하지 않습니다. 들여쓰기는 **공백 두 칸**(탭 불가).

`timeRange`는 자정을 넘는 범위(`22:00`–`06:00`)도 지원합니다.
`scheduled` 항목이 일치하지 않으면 최상위 `rotation`으로 폴백됩니다.

### 자동재생 AI 보조 (선택, `config/ai.yaml`)

자동재생이 **곡 이름만 아는 출처**(키워드·Last.fm)에서 후보를 고를 때, 키워드와 규칙만으로는 1시간짜리 믹스나 제목에만 장르 이름이 들어간 곡을 놓칩니다. 그 후보를 LLM을 사용하여 모델에게 물어봅니다. 주소를 직접 받아오는 출처(VocaDB·AnisongDB·AnimeThemes·재생목록)는 메타데이터, 영상 등 정답이 제공되기에 이 옵션이 켜져있어도 LLM을 거치지 않습니다.

**기본값은 꺼짐이고, 사용하지 않아도 무방한 기능입니다.** 모델 호출에 실패하거나, 올바르지 않은 응답이 오면 규칙만으로 선택 합니다. 재생을 멈추지 않습니다.

| 파일                      | 내용                                                 |
| ------------------------- | ---------------------------------------------------- |
| `config/ai.yaml`          | 프로바이더·모델·온도·타임아웃 등                     |
| `config/ai-keys.yaml`     | API 키. 프로바이더마다 따로 (저장소에 추적되지 않음) |
| `config/ai-prompt.chatml` | 판정 프롬프트. ChatML 규격                           |

로컬(Ollama · LM Studio · vLLM · llama.cpp)과 클라우드(OpenAI · Anthropic · Google AI Studio · Vertex AI · OpenRouter 등)를 고를 수 있습니다. 대부분 OpenAI 호환 규격으로 부르고, 규격이 다른 앤트로픽·버텍스 네이티브는 따로 처리합니다. 여기 없는 곳은 `custom`으로 주소를 직접 적습니다.

**운영자 패널의 "AI 보조" 탭에서 전부 설정할 수 있습니다** — 프로바이더를 고르면 모델 목록을 받아 채우고, 프롬프트를 섹션으로 짜고, 실제로 나갈 요청을 미리 보거나 보내 볼 수 있습니다. 키는 넣을 수는 있어도 화면으로 되읽지는 못합니다.

> 판정 품질에 프롬프트의 영향이 매우 큽니다. 140곡을 갖고 실험해본 결과, 동일 모델/동일 표본에서 프롬프트만 수정하여 정답률이 77%에서 95%로 상승했습니다.

### 실행

```bash
pnpm run start    # 일반 실행
```

## 대시보드

1. `.env`에 대시보드 설정 값들을 본인 환경에 맞게 설정
2. [Discord Developer Portal](https://discord.com/developers/applications) → OAuth2 → Redirects에
   `{DASHBOARD_URL}/auth/callback` 추가
3. 클라이언트 빌드:

```bash
pnpm run install:dashboard   # 대시보드 빌드 (의존성은 루트 pnpm install이 워크스페이스로 이미 설치)
```

4. 봇 실행 시 대시보드 서버가 함께 시작됩니다.

### 다른 기기에서 접속하기

기본값은 **같은 PC에서만** 열립니다 — `DASHBOARD_HOST`가 `127.0.0.1`이라 다른 기기에서는 보이지 않습니다.
의도치 않게 외부로 열려 있는 상태를 만들지 않으려는 기본값이므로, 원격 접속이 필요할 때만 바꾸세요.

바꿔야 하는 값은 둘입니다.

| 값               | 뜻                                                         |
| ---------------- | ---------------------------------------------------------- |
| `DASHBOARD_HOST` | 서버가 **귀 기울일 주소**. 외부에 열려면 `0.0.0.0`         |
| `DASHBOARD_URL`  | 브라우저로 **접속하는 주소 **. 디스코드 OAuth, CORS의 기준 |

`DASHBOARD_URL`을 바꿨다면 Discord Developer Portal의 Redirects도 `{DASHBOARD_URL}/auth/callback`으로 함께 고쳐야 합니다.

> [!WARNING]
> **HTTPS 없이 외부에 열지 마세요.** 로그인 세션 쿠키가 평문으로 오가게 되어 보안에 취약해집니다.
> 리버스 프록시(nginx, Caddy 등)를 앞에 두고 HTTPS 프로비저닝을 하는 것을 권장합니다.
> 그 경우 프록시가 `X-Forwarded-*` 헤더를 넘겨야 쿠키의 Secure 판정과 요청 제한이 제대로 동작합니다.

### `SESSION_SECRET` 생성 방법 예시

- node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
- 외부 랜덤 문자열 생성기를 사용해도 됩니다.

> [!IMPORTANT]
> `SESSION_SECRET` 값은 최소 64자 이상 랜덤 문자열을 권장합니다.

## 업데이트 / 유지보수

`git pull`로 코드를 갱신한 뒤, 갱신 내용에 따라:

| 명령                       | 용도                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| `pnpm install`             | 루트 의존성 갱신 (+ `postinstall`로 ffmpeg 설치, yt-dlp 자동 업데이트) |
| `pnpm run build:dashboard` | 대시보드(Vue) 변경분 재빌드                                            |
| `pnpm run update:bgutil`   | bgutil POToken 공급자 `git pull` + 재빌드                              |
| `pnpm run update:ytdlp`    | yt-dlp 바이너리 최신화                                                 |
| `pnpm run install:ffmpeg`  | ffmpeg 바이너리 재설치 (`--force`로 강제 재다운로드)                   |
| `pnpm run cmddeploy`       | 슬래시 커맨드 강제 재배포                                              |

**슬래시 커맨드 배포**: 기동 시 자동 배포되며, 커맨드 정의가 이전 배포와 같으면 등록을 건너뜁니다.
Discord 쪽 등록 상태가 어긋난 것 같으면 `pnpm run cmddeploy` 또는 대시보드 운영자 페이지의 재배포 버튼으로 강제 배포하세요.

**ffmpeg 설치**: `pnpm install`이 알아서 처리하므로 `install:ffmpeg`를 직접 칠 일은 보통 없습니다. 다운로드가 실패했거나 `bin/`의 바이너리가 없어졌을 때만 쓰세요.
내려받는 릴리스는 `scripts/install-ffmpeg.ts`의 기본값으로 고정되어 있고 sha256으로 검증합니다. 다른 버전을 쓰려면 `.env`의 `FFMPEG_RELEASE`에 태그를 적고 `pnpm run install:ffmpeg --force`로 다시 받으세요.
**각 달의 마지막 빌드만 쓸 수 있습니다** — BtbN은 그 외 autobuild를 2주 뒤 삭제하므로, 중간 날짜로 고정하면 얼마 못 가 내려받기가 404가 됩니다(월말 빌드는 2년 보존).

**yt-dlp 자동 업데이트**: `pnpm install` 시 `postinstall`이 `yt-dlp -U`를 실행해 최신화합니다.
기동 시 자동 체크는 하지 않으므로, YouTube 추출이 갑자기 막히면(YouTube가 API를 자주 바꿈) 봇 재시작 전에 `pnpm run update:ytdlp`로 갱신하세요.

> [!NOTE]
> 업데이트 내용에 따라 기능이 추가되면 `.env`파일의 수정이 필요할 수 있습니다.

## SponsorBlock

음악이 아닌 구간을 [SponsorBlock](https://sponsor.ajay.app/) API로 조회해 재생 중 자동으로 건너뜁니다.

- **캐싱**: 받은 구간 데이터는 SponsorBlock 서버 다운 등으로 조회가 안 될 때를 대비하여 로컬 캐싱합니다. 실시간 조회가 되지 않으면 캐싱된 데이터로 구간을 스킵합니다.
- **설정**: 기본 활성 카테고리는 비음악 구간·인트로·최종 화면 구간이며, `.env` 파일 내 설정 (봇 전역 기본 설정), `/sponsorblock` 명령어 또는 웹 대시보드의 서버 설정(서버별 설정/서버 관리 권한 필요)에서 사용 여부와 건너 뛸 카테고리를 조정할 수 있습니다.
- **하이라이트**: `/highlight` 명령이나 대시보드 버튼으로 SponsorBlock에 등록된 하이라이트 지점으로 점프할 수 있습니다.

> [!IMPORTANT]
> https://sponsor.ajay.app/의 CC BY-NC-SA 4.0 라이선스에 따라 제공되는 SponsorBlock 데이터를 사용합니다.
>
> Uses SponsorBlock data licensed under CC BY-NC-SA 4.0 from https://sponsor.ajay.app/.

> [!WARNING]
> **상업적 이용시 주의**: SponsorBlock 데이터는 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)(비상업) 라이선스입니다. 이 봇을 **상업적 목적으로 운영**하려면 `.env`에서 `SPONSORBLOCK_ENABLED=false`로 기능을 끄거나 코드를 수정하여 SponsorBlock 기능을 수정/제거해 주세요.

## 라이선스

이 저장소는 이중 라이선스 구조입니다:

> 많은 부분이 변경·추가·삭제 되었으나, 본 프로젝트의 출발점은 [umutxyp/MusicBot](https://github.com/umutxyp/MusicBot) (MIT)입니다.
> 잔류한 원본 코드는 MIT, 이 저장소에서 수정·추가된 코드는 **AGPL-3.0-or-later**를 따릅니다.

- **업스트림 베이스** ([umutxyp/MusicBot](https://github.com/umutxyp/MusicBot)): Copyright (c) 2025 umutxyp - [MIT License](LICENSE-MIT)
- **이 저장소의 수정·추가분**: Copyright (C) 2026 PLeC - [GNU AGPL-3.0-or-later](LICENSE)

결합 저작물 전체에는 AGPL-3.0 조건이 적용됩니다. 이 봇을 네트워크 서비스로 운영하는 경우, 사용자에게 소스 코드를 제공해야 합니다 (`/license` 명령어가 이 역할을 합니다).
상세한 구분 기준은 [NOTICE.md](NOTICE.md)를 참조하세요.

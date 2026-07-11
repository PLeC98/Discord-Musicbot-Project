# Discord Musicbot Project

[umutxyp/MusicBot](https://github.com/umutxyp/MusicBot) (MIT)을 베이스로 개조한 한국어 UI 기반의 개인용 Discord 음악 봇.

몇몇 음악 봇들과 달리 **음악 봇**임에 집중하며, yt-dlp를 기반으로 사용자가 직접 호스팅하기에 대형 클라우드 서비스 봇에 비해 안정적입니다.

[![discord.js](https://img.shields.io/badge/discord.js-14-blue?style=flat-square&logo=discord.js)](https://discord.js.org/)
[![Node.js](https://img.shields.io/badge/24.11%2B-x?logo=Node.js&logoColor=green&label=Node.js&color=green&style=flat-square)](https://nodejs.org/)
[![Vue](https://img.shields.io/badge/Vue-3-mediumseagreen?logo=vue.js&style=flat-square)](https://vuejs.org/)
[![Vite](https://img.shields.io/badge/vite-8-blueviolet?logo=vite&style=flat-square)](https://vite.dev/)
[![Tailwind CSS](https://img.shields.io/badge/tailwindcss-4-%2306B6D4?logo=tailwindcss&style=flat-square)](https://tailwindcss.com/)
![라이선스](https://img.shields.io/github/license/PLeC98/Discord-Musicbot-Project?style=flat-square)

> **라이선스** — 원본 베이스는 MIT, 이 저장소의 수정·추가분은 **AGPL-3.0-or-later**입니다.
> 자세한 구조는 [NOTICE.md](NOTICE.md)를 참조하세요.

## 주요 기능

### 음악 플레이어

- **재생 소스**: YouTube, Spotify, SoundCloud, 직접 오디오 링크
- **대기열 관리**: 우선 재생, 섞기, 반복, 순서 변경, 건너뛰기, 이전 곡, 일시 정지/재개
- **Components V2 재생 UI**: 진행 바, 컨트롤 버튼, 대기열 점프 셀렉트 메뉴가 달린 now-playing 메시지 (웹훅)
- **SQLite 오디오 캐시**: 재생한 곡을 로컬 캐싱, 캐시를 활용한 오류 복구·빠른 다회 재생 반응성 등 확보, 재생 빈도·최근성·전체 캐시 용량·디스크 여유 공간 기반 자동 정리
- **세션 저장/복구**: `/leave`로 대기열·재생 위치를 저장하고 `/join`으로 복구. 봇 재시작 시에도 자동 복구
- **봇 전용 채널**: `/setchannel`로 지정한 채널에 곡명/링크만 입력하면 자동 재생
- **장르 자동재생**: 대기열 소진 시 선택한 장르(`config/genres.js`에서 추가/삭제, 검색 키워드 변경 가능)의 곡을 자동 탐색·재생
- **DJ 역할 지정**: `/setdjrole`로 역할을 지정 가능. 권한이 없다면, 곡 추가와 자기가 추가한 곡의 스킵 / 제거, 조회만 가능.

### 웹 대시보드

- **Discord OAuth 로그인**: 안전하고, 권한 기반의 접근 제어를 제공
- **음악 제어**: 디스코드 내에서 할 수 있는 모든 기능을 더 편리하게
- **채널 설정 관리**: DJ 역할, 전용 채널 설정
- **봇 운영자 용 패널**: 봇 상태, WebSocket 핑, 운영 시스템 상태, 전체 공지, 터미널 로그, 봇이 참여중인 서버 관리, 커맨드 재배포

### 비주얼

- **상태 메시지 로테이션**: 시간대·양력/음력 날짜 조건부 봇 상태 메시지 (`config/status.js`)
- **음성 채널 상태 표시**: 재생 중인 곡 제목을 음성 채널 상태에 자동 반영

## 명령어

| 분류   | 명령어                                                                                |
| ------ | ------------------------------------------------------------------------------------- |
| 재생   | `/play` `/playfirst` `/search` `/pause` `/seek` `/replay` `/skip` `/previous` `/stop` |
| 대기열 | `/queue` `/shuffle` `/loop` `/move` `/remove` `/clear` `/autoplay`                    |
| 채널   | `/join` `/leave` `/setchannel` `/setdjrole`                                           |
| 정보   | `/nowplaying` `/help` `/ping` `/system` `/cachestatus` `/dashboard` `/license`        |
| 기타   | `/volume`                                                                             |

## 설치 및 실행

### 요구 사항

- Windows / Linux (개발 / 유지보수 환경: Windows 10, Ubuntu 24)
- [Node.js](https://nodejs.org/ko/download) >= 24.11.1 (2026/07/07 기준, 기술적 하한은 `@discordjs/voice`가 요구하는 22.12.\*)
- C++ 빌드 툴체인 (C++20 지원 컴파일러): `@discordjs/opus`의 프리빌드 바이너리가 Node 22 이하 ABI까지만 배포되어 있어, Node 23 이상에서는 소스 컴파일로 폴백. 툴체인이 없으면 `pnpm install`이 실패함.
  - Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/ko/downloads/) 2022(17.x) 이상 + "C++를 사용한 데스크톱 개발" 워크로드, Python 3.9 이상
    - VS2019 이하는 Node 22+ 지원 대상이 아니라 사용 불가
  - Linux: g++ 12.2 이상 (또는 상응하는 clang) + make + python3 3.9 이상
    - Ubuntu 24.04 이상은 `sudo apt install -y build-essential python3`로 충족. 기본 gcc가 12 미만인 배포판(Ubuntu 22.04 = gcc 11 등)은 `g++-12` 이상을 별도 설치. 시스템 libopus 패키지는 불필요. (opus 소스가 번들되어 함께 컴파일됨)
- [pnpm](https://pnpm.io/)
- 저장소 `clone`을 위한 [git](https://git-scm.com/)
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

### POToken 설정 (권장)

[Brainicism/bgutil-ytdlp-pot-provider](https://github.com/Brainicism/bgutil-ytdlp-pot-provider) 를 사용합니다.
YouTube 봇 감지 차단을 우회하는 POToken 공급자입니다. 설정하면 쿠키 없이도 안정적으로 재생됩니다.

```bash
pnpm run install:bgutil    # 클론 + 의존성 설치 + 빌드
```

봇 실행 시 자동으로 감지하여 POToken 서버(포트 4416)를 함께 실행하며, 별도 설정 없이 작동합니다.

### 쿠키 설정 (대안)

POToken을 사용하지 않을 경우, `COOKIES_FROM_BROWSER=chrome`(또는 firefox/edge) 혹은 브라우저 확장으로 내보낸 `cookies.txt`를 `COOKIES_FILE=./cookies.txt`로 지정하세요.

### 상태 메시지 (`config/status.js`)

봇의 Discord 상태 메시지를 시간대·날짜 조건에 따라 자동 전환합니다.

| 필드               | 설명                                                   |
| ------------------ | ------------------------------------------------------ |
| `rotationInterval` | 기본 메시지 전환 주기 (초)                             |
| `rotation`         | 기본 메시지 목록 (조건 없이 순환)                      |
| `scheduled`        | 조건부 메시지 목록 (위에서부터 첫 번째 일치 항목 적용) |

`scheduled` 각 항목에 조건과 메시지를 지정합니다:

```js
// 조건: dateRange(양력 MM-DD), lunarDateRange(음력 MM-DD), timeRange(HH:MM)
// 메시지: text(단일) 또는 rotation(복수 순환)

// 크리스마스 (12/24~26)
{ dateRange: { start: "12-24", end: "12-26" }, text: "🎄 메리 크리스마스!" },

// 야간 (22:00~06:00)
{
  timeRange: { start: "22:00", end: "06:00" },
  rotation: [{ text: "🌌 별빛 아래 음악" }, { text: "🛌 잠들기 전 노래 한곡" }],
},
```

`timeRange`는 자정을 넘는 범위(`22:00`–`06:00`)도 지원합니다.
`scheduled` 항목이 일치하지 않으면 최상위 `rotation`으로 폴백됩니다.

### 실행

```bash
pnpm run start    # 일반 실행
pnpm run shard    # 1000+ 서버용 샤딩 실행 (샤딩 설정 필요)
```

## 대시보드

1. `.env`에 `DASHBOARD_URL`(외부 공개 주소 — 로컬 접속만 쓰면 비워둠), `OWNER_ID`, `SESSION_SECRET` 설정
2. [Discord Developer Portal](https://discord.com/developers/applications) → OAuth2 → Redirects에
   `{DASHBOARD_URL}/auth/callback` 추가
3. 클라이언트 빌드:

```bash
pnpm run install:dashboard   # 대시보드 빌드 (의존성은 루트 pnpm install이 워크스페이스로 이미 설치)
```

봇 실행 시 대시보드 서버가 함께 시작됩니다.

> [!CAUTION]
> 현재 샤딩 구동 시 0번 샤드를 제외한 샤드가 소유한 길드는 대시보드에 안 보이고 조작도 불가한 문제가 있습니다.

## 업데이트 / 유지보수

`git pull`로 코드를 갱신한 뒤, 상황에 따라:

| 명령                       | 용도                                                      |
| -------------------------- | --------------------------------------------------------- |
| `pnpm install`             | 루트 의존성 갱신 (+ `postinstall`로 yt-dlp 자동 업데이트) |
| `pnpm run build:dashboard` | 대시보드(Vue) 변경분 재빌드                               |
| `pnpm run update:bgutil`   | bgutil POToken 공급자 `git pull` + 재빌드                 |
| `pnpm run update:ytdlp`    | yt-dlp 바이너리 최신화                                    |
| `pnpm run cmddeploy`       | 슬래시 커맨드 강제 재배포                                 |

**슬래시 커맨드 배포**: 기동 시 자동 배포되며, 커맨드 정의가 이전 배포와 같으면 등록을 건너뜁니다.
Discord 쪽 등록 상태가 어긋난 것 같으면 `pnpm run cmddeploy` 또는 대시보드 관리자 페이지의 재배포 버튼으로 강제 배포하세요.

**yt-dlp 자동 업데이트**: `pnpm install` 시 `postinstall`이 `yt-dlp -U`를 실행해 최신화합니다.
기동 시 자동 체크는 하지 않으므로, YouTube 추출이 갑자기 막히면(YouTube가 API를 자주 바꿈) 봇 재시작 전에 `pnpm run update:ytdlp`로 갱신하세요.

## 라이선스

이 저장소는 이중 라이선스 구조입니다:

- **업스트림 베이스** ([umutxyp/MusicBot](https://github.com/umutxyp/MusicBot): Copyright (c) 2025 umutxyp - [MIT License](LICENSE-MIT)
- **이 저장소의 수정·추가분**: Copyright (C) 2026 PLeC - [GNU AGPL-3.0-or-later](LICENSE)

결합 저작물 전체에는 AGPL-3.0 조건이 적용됩니다. 이 봇을 네트워크 서비스로 운영하는 경우, 사용자에게 소스 코드를 제공해야 합니다 (`/license` 명령어가 이 역할을 합니다).
상세한 구분 기준은 [NOTICE.md](NOTICE.md)를 참조하세요.

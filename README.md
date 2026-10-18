# Discord Musicbot Project

> 왜 음악봇을 백화점으로 만들려고 하는가

한국어 UI 기반의 개인용 Discord 음악 봇.

일부 봇들, 특히 다수의 클라우드 서비스 봇들과 달리 **음악봇**이라는 본연에 집중하고 있으며, [yt-dlp](https://github.com/yt-dlp/yt-dlp)를 기반으로 사용자가 직접 호스팅하는 방식을 택하여 안정성을 챙겼습니다.

[![discord.js](https://img.shields.io/badge/discord.js-14-blue?style=flat-square&logo=discord.js)](https://discord.js.org/)
[![Node.js](https://img.shields.io/badge/24.14%2B-x?logo=Node.js&logoColor=green&label=Node.js&color=green&style=flat-square)](https://nodejs.org/)
[![Typescript](https://img.shields.io/badge/typescript-6.0-blue?logo=typescript&style=flat-square)](https://www.typescriptlang.org/)
[![Vue](https://img.shields.io/badge/Vue-3-mediumseagreen?logo=vue.js&style=flat-square)](https://vuejs.org/)
[![Vite](https://img.shields.io/badge/vite-8-blueviolet?logo=vite&style=flat-square)](https://vite.dev/)
[![Tailwind CSS](https://img.shields.io/badge/tailwindcss-4-%2306B6D4?logo=tailwindcss&style=flat-square)](https://tailwindcss.com/)
![라이선스](https://img.shields.io/github/license/PLeC98/Discord-Musicbot-Project?style=flat-square)
[![커버리지](https://img.shields.io/codecov/c/github/PLeC98/Discord-Musicbot-Project?style=flat-square&logo=codecov)](https://codecov.io/gh/PLeC98/Discord-Musicbot-Project)

## 주요 기능

### 음악 플레이어

- **재생 소스**: YouTube (라이브 지원), Spotify, SoundCloud, 직접 오디오 링크
- **대기열 관리**: 우선 재생, 셔플, 반복, 대기열 순서 변경, 건너뛰기, 이전 곡, 일시 정지/재개. 그리고 대기열 총량 직접 설정 가능.
- **긴 재생목록 나눠 넣기**: 재생목록을 무조건 다 집어넣지 않습니다. 우선 정해진 만큼만 넣고 (수치 설정 가능), 남은 곡은 후속 메뉴로 이어서 넣을지 결정할 수 있습니다.
- **Components V2 재생 UI**: 진행 바, 컨트롤 버튼, 대기열 점프 셀렉트 메뉴가 달린 now-playing 메시지로 간단하게 조작할 수 있습니다.
- **SQLite 오디오 캐시**: 재생한 곡을 로컬에 캐싱하여 캐시를 활용한 오류 복구, 빠른 다회 재생 반응성 등을 확보. 재생 빈도, 최근 재생 여부, 전체 캐시 용량, 디스크 여유 공간을 기반으로 자동 정리합니다.
- **세션 저장/복구**: `/leave`로 대기열·재생 위치를 저장하고 `/join`으로 복구 가능. 봇 재시작 시에도 자동 복구합니다.
- **봇 전용 채널**: `/setchannel`로 지정한 채널에 곡명/링크만 입력하면 자동 재생. 재생 패널이 채널 하단에 상주하며 곡이 재생 중인지 아닌지, 무슨 곡이 재생 중인지를 보여줍니다.
- **장르 자동재생**: 선택한 장르의 곡을 자동 탐색하고 재생. 재생 중에도 다음 곡을 미리 준비하여 곡 사이가 비지 않고, 다음 곡이 뭔지 볼 수 있으며, 곡을 넘길 수도 있습니다.
  - 운영자 패널의 "자동재생" 탭에서 장르, 검색 키워드, 메타데이터를 가져올 소스를 설정하며, 봇 작동 중에도 바로 수정이 가능.
  - 사용 가능한 소스: 키워드(유튜브 검색), Last.fm, ListenBrainz Radio, AnisongDB, AnimeThemes, VocaDB, UtaiteDB, TouhouDB, 스포티파이/유튜브 재생목록.
  - 섞어서 사용 가능, 소스별 가중치 설정 가능
- **[자동재생 AI 보조](#자동재생-ai-보조)**: 유튜브 검색으로 고른 후보를 LLM 모델에게 한 번 더 판정시켜 믹스, 타 장르 등을 걸러냅니다. 로컬 모델부터 클라우드 모델까지 사용 가능. 물론 사용하지 않는 것도 가능.
- **DJ 역할 지정**: `/setdjrole`로 역할을 지정 가능. 권한이 없다면 곡 추가와 자기가 추가한 곡의 스킵 / 제거, 조회만 가능.
- **SponsorBlock 자동 스킵**: 음악이 아닌 구간을 [SponsorBlock](https://sponsor.ajay.app/) 데이터로 자동 스킵이 가능하며, 스킵할 카테고리도 설정 가능.
  - 하이라이트 지점으로 점프하는 `/highlight`도 사용 가능.
  - 동작·라이선스는 아래 [SponsorBlock](#sponsorblock) 참조

### 비주얼

- **상태 메시지 로테이션**: 시간대·양력/음력 날짜 조건부 봇 상태 메시지 (운영자 패널의 "상태 문구" 탭)
- **음성 채널 상태 표시**: 재생 중인 곡 제목을 음성 채널 상태에 자동 반영

### 웹 대시보드

- **Discord OAuth 로그인**: 안전한 권한 기반의 접근 제어 제공
- **음악 제어**: 디스코드 내에서 할 수 있는 모든 기능을 더 편리하고 익숙한 UI로
- **서버 설정 관리**: DJ 역할, 전용 채널 설정, SponsorBlock 설정, 한 번에 나눠 넣을 재생목록 곡 수
- **봇 운영자 패널**: 봇에 무슨 문제가 있는지 한눈에 모니터링
  - 버전, CPU 및 메모리 사용량, 외부 서비스 연결 상태, 자식 프로세스, 저장공간, 지난 1시간 요약, 실시간 로그 등
- **직관적인 봇 설정**: 여러 텍스트 파일에 설정이 흩어져 있을 이유는 없습니다. 대시보드에서 설정을 마치세요.
- **커스터마이징**: 대시보드 [파비콘 변경](docs/favicon.md) 지원 (미설정시 봇 프로필 이미지 사용)
- **반응형 디자인**: 모바일, 태블릿, PC 전부에 대응하며, 머티리얼 3 익스프레시브, 하이퍼랜드, 스포티파이 앱에서 아이디어를 얻은 대시보드.

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

- Windows / Linux (개발 / 유지보수 환경: Windows 10, Ubuntu 26)
- [Node.js](https://nodejs.org/ko/download): >= 24.14.0 (개발 / 유지보수 환경)
  - 이론상 동작 하한치는 22.18.0부터이나, 테스트 스크립트가 24.3.0부터 정상 동작.
- C++ 빌드 툴체인 (C++20 지원 컴파일러): `@discordjs/opus`의 프리빌드 바이너리가 Node 22 이하 ABI까지만 배포되어 있어, Node 23 이상에서는 소스 컴파일로 폴백. 툴체인이 없으면 `pnpm install`이 실패함.
  - Windows: [Visual Studio Build Tools](https://visualstudio.microsoft.com/ko/downloads/) 2022(17.x) 이상 + "C++를 사용한 데스크톱 개발" 워크로드, Python 3.9 이상
    - VS2019 이하는 Node 22+ 지원 대상이 아니라 사용 불가
  - Linux: g++ 12.2 이상 (또는 상응하는 clang) + make + python3 3.9 이상
    - Ubuntu 24.04 이상은 `sudo apt install -y build-essential python3`로 충족. 기본 gcc가 12 미만인 배포판(Ubuntu 22.04 = gcc 11 등)은 `g++-12` 이상을 별도 설치. 시스템 libopus 패키지는 불필요. (opus 소스가 번들되어 함께 컴파일됨)
- [pnpm](https://pnpm.io/)
- 저장소 `clone`을 위한 [git](https://git-scm.com/)
- ffmpeg: Windows / Linux(x64·arm64)는 `pnpm install` 시 [BtbN 빌드](https://github.com/BtbN/FFmpeg-Builds)를 `vendor/bin/`에 자동으로 내려받습니다. **별도 설치가 필요 없습니다**.
  - Linux의 `.tar.xz` 해제에 `xz-utils`가 필요합니다 (대부분의 배포판에 기본 포함).
  - **macOS는 자동 설치 대상이 아닙니다** (BtbN이 macOS 빌드를 제공하지 않음). `brew install ffmpeg`로 설치해 PATH에 두거나 `.env`의 `FFMPEG_PATH`로 지정하세요.
  - 시스템에 이미 쓰던 ffmpeg가 있으면 `.env`의 `FFMPEG_PATH`로 지정할 수 있고, 그러면 자동 다운로드를 건너뜁니다.
- [디스코드 개발자 포털](https://discord.com/developers/applications)에서 생성된 디스코드 어플리케이션 및 디스코드 봇

### 설치

#### 1단계

```bash
git clone https://github.com/PLeC98/Discord-Musicbot-Project.git
cd Discord-Musicbot-Project
pnpm install
```

`pnpm install`을 하면 의존성 설치, ffmpeg 설치, yt-dlp 설치, 대시보드 빌드를 하고, `.env`가 없으면 `.env.example`을 `.env`로 복사한 뒤 랜덤 비밀 키(`SECRETS_KEY` · `SESSION_SECRET`)를 채웁니다.
`.env`가 이미 있다면 `.env`는 건드리지 않고 나머지만 진행합니다.
의존성이 바뀌지 않았으면 pnpm이 이 단계를 통째로 건너뛰므로, 봇을 실행할 때도 `.env`가 없으면 같은 방법으로 만들고 채울 값을 알려 준 뒤 멈춥니다.

#### 2단계

아래 내용들은 `.env`에 직접 채워 넣어야 할 필수 항목입니다.
(하나라도 없으면 기동을 중단합니다.)
발급: [Discord Developer Portal](https://discord.com/developers/applications)

| 변수            | 설명                                                               |
| --------------- | ------------------------------------------------------------------ |
| `DISCORD_TOKEN` | 봇 토큰 (Bot → Token)                                              |
| `CLIENT_ID`     | 애플리케이션 ID (OAuth2 → Client ID)                               |
| `CLIENT_SECRET` | 클라이언트 시크릿 (OAuth2 → Client Secret). 대시보드 로그인에 쓰임 |

> `SECRETS_KEY`도 필수이지만, `pnpm install`이 채워 넣으므로 손으로 채우지 않아도 됩니다.
> 비었거나(옛 `.env` 를 쓰는 경우 등) 모양이 틀리면 봇의 기동을 중단하고, 생성하는 방법을 안내합니다.
> 키가 변경되면 이전 키 값으로 암호화된 데이터는 봇이 복호화할 수 없어 새로 입력해야 합니다.

그 외에 `OWNER_ID` 값은 필수는 아니지만, 대부분의 봇 설정을 대시보드의 운영자 패널에서 하므로 사실상 필수입니다.
봇 운영자의 Discord 사용자 ID (Snowflake ID)를 입력하면 됩니다.

## 설정

`.env` 의 필수 값과 비밀 키, ffmpeg 경로 · 버전, yt-dlp 버전, bgutil 버전, 대시보드 접속, 로깅, 테스트 서버(`GUILD_ID`), 소스 저장소 주소(`SOURCE_REPO_URL`)를 제외한 모든 설정은 **대시보드를 통해 이뤄집니다**.

### 유튜브 재생 상세 설정

필수 설정은 아닙니다.
유튜브 영상이 재생이 잘 안 되거나, 연령 제한 영상의 재생을 원하는 등의 경우 설정이 필요합니다.

자세한 것은 [해당 문서](docs/youtube.md)를 참고해 주세요.

### 상태 메시지

봇의 Discord 상태 메시지를 시간대·날짜 조건에 따라 자동 전환합니다. 운영자 패널의 "상태 문구" 탭에서 고칩니다.

- 지정한 주기(초)마다 차례로 돌아가며 설정한 문구를 사용합니다.
- 양력/음력 날짜, 시간을 조건으로 하여 특정 시기에만 특정한 문구가 나오도록 할 수 있습니다.
  - 시간대는 날짜를 넘어가는 범위(`22:00`~`06:00`)도 가능합니다.

### 자동재생 AI 보조

> **기본적으로 꺼져 있는 기능이며, 사용하지 않아도 재생에는 문제가 없습니다.**
> 모델 호출에 실패하거나, 올바르지 않은 응답이 오면 규칙만으로 곡을 고르며, 재생을 멈추지 않습니다.

자동재생이 **유튜브 검색으로 후보를 고를 때**, 키워드와 규칙만으로는 1시간짜리 믹스나 제목에만 장르 이름이 들어간 곡이 섞입니다.
(키워드 기반 재생, Last.fm, ListenBrainz Radio, AnimeThemes, AnisongDB, 스포티파이처럼 곡 이름으로 유튜브에서 찾는 출처)
그 후보를 LLM을 사용하여 물어보고 걸러냅니다.

유튜브 주소를 직접 주는 출처(VocaDB, UtaiteDB, TouhouDB, 유튜브 재생목록)와 유튜브에서 찾지 못했을 경우에는 음원을 제공받아 그대로 트는 경우(AnimeThemes, AnisongDB의 TV Size)는 틀릴 수 없기에, 해당 옵션을 켜도 기능을 사용하지 않습니다.

## 실행

```bash
pnpm run start    # 일반 실행
```

`pnpm start`로 봇을 실행하면 간단한 실행기 아래에서 봇을 구동합니다.
운영자 패널에서 봇을 다시 시작할 수 있게 하기 위함이며, `node src/index.ts`로 바로 켜면 다시 띄워 줄 쪽이 없어 대시보드의 다시 시작 버튼이 막힙니다.

pm2, systemd, 도커 등을 사용할 때도 `pnpm start`(또는 `node scripts/launch.ts`)를 사용하면 됩니다. 실행기는 다시 시작만 맡고, 크래시나 기동 실패는 그대로 같은 종료 코드로 끝나기에 그쪽의 재실행 규칙을 따릅니다.

> 현재로서는 도커 이미지 배포 계획은 없습니다.

## 대시보드

봇의 설정 상당수를 대시보드의 운영자용 패널에서 GUI로 편하게 처리할 수 있습니다.

봇을 켜면 대시보드 서버가 함께 뜹니다. (기본 `http://localhost:33333`)
화면은 처음 `pnpm install` 때 빌드되므로, 따로 설치할 것은 없습니다.

앞선 설치 과정 설명의 2단계에서 언급한 다음 요소들이 필수입니다:

1. `.env`의 `CLIENT_SECRET`과 `OWNER_ID`가 **필수 값** (OAuth 인증 및 운영자 판별 목적)
2. [Discord Developer Portal](https://discord.com/developers/applications) → OAuth2 → Redirects에 `{DASHBOARD_URL}/auth/callback`을 추가 (OAuth 인증 후 리다이렉트할 페이지)
   - 봇을 켜면 기동 로그에 등록할 주소가 표시되니 참고해도 좋습니다. (기본 `http://localhost:33333/auth/callback`).
3. 설정에 따라 봇과 동일한 네트워크 혹은 외부 네트워크에서 브라우저로 대시보드를 열고 디스코드 계정으로 로그인합니다.

대시보드에 업데이트가 있은 뒤에는 `pnpm run build:dashboard`로 다시 빌드해야 합니다. (봇을 재시작할 필요는 없습니다)

### 다른 기기에서 접속하기

기본 설정으로는 **같은 PC에서만** 접근할 수 있습니다.
(`DASHBOARD_HOST`가 `127.0.0.1`이라 외부 기기에서 **일반적으로는** 접속할 수 없습니다.)
의도치 않은 외부 공개로 인해 **보안상의 취약점**을 방지하려는 목적이므로, 외부 접속이 필요할 때만 변경하시기 바랍니다.

외부 접속을 위해 변경해야 하는 값은 두 가지입니다.

| 값               | 뜻                                                                |
| ---------------- | ----------------------------------------------------------------- |
| `DASHBOARD_HOST` | 서버가 통신을 **청취할 주소**. 외부로 접근을 개방하려면 `0.0.0.0` |
| `DASHBOARD_URL`  | 브라우저로 **접속하는 주소**. 디스코드 OAuth, CORS의 기준         |

`DASHBOARD_URL`을 바꿨다면 Discord Developer Portal의 Redirects도 `{DASHBOARD_URL}/auth/callback`으로 수정되어야 합니다.

> [!WARNING]
> **HTTPS 없이 외부에 열지 마세요.** 로그인 세션 쿠키가 평문으로 오가게 되어 보안에 취약해집니다.
> **리버스 프록시**(nginx, Caddy 등)를 앞에 두고 HTTPS 프로비저닝을 하는 것을 권장합니다.
> 그 경우 프록시가 `X-Forwarded-*` 헤더를 넘겨야 쿠키의 Secure 판정과 요청 제한이 제대로 동작합니다.

### `SESSION_SECRET` 생성 방법

일반적으로는 `pnpm install`이 `.env`를 만들 때 채우므로 직접 할 필요가 없습니다.

어떠한 사유로 인해 직접 생성하려면 아래 명령어를 사용하세요:

- node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
- 외부 랜덤 문자열 생성기를 사용해도 됩니다.

> [!IMPORTANT]
> `SESSION_SECRET` 값은 최소 64자 이상의 랜덤 문자열을 권장합니다.

> [!TIP]
> 대시보드 보안의 핵심은 운영자의 디스코드 계정입니다.
>
> 운영자의 디스코드 계정이 탈취/해킹당할 경우, 아무리 봇과 네트워크 단에서 보안을 철저히 하여도 대시보드에 운영자로서 로그인할 수 있게 됩니다.
>
> 그러한 경우, **봇의 설정 및 정보, 시크릿 키, API 키 등의 안전을 보장할 수 없습니다.**
>
> **디스코드 계정에 2단계 인증을 켜 두세요.**
>
> API 키 및 쿠키 저장, 설정 내보내기 및 가져오기, 스냅샷 복원 같은 중대한 조작은 로그인 후 10분 내로만 가능하며, 시간이 지난 후 조작을 시도하면 로그인 창이 뜹니다.

## 설정 백업

봇 설정을 백업하고, 그 백업을 불러올 수 있습니다.
백업은 5종류로 나뉩니다.

| 백업                       | 담는 것                                                 | 쓰임                                                                                                                                         |
| -------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 자동 스냅샷                | 설정 DB 전체(서버별 설정, 암호화된 API 키 · 쿠키 포함)  | 하루 한 번 자동으로 생성(최근 7개). 잘못된 설정 변경, 설정 파일 손상 등의 복구                                                               |
| 봇 설정만 내보내기         | 운영 조절값, 장르 설정, 활동 문구, AI 설정, 프롬프트    | 설정 공유 등. 서버별 설정, API 키, 쿠키는 빠집니다. 이 PC에 매인 값(쿠키 출처, POToken 사용)은 들어가고, 불러오기 전에 바뀌는지 알려 줍니다. |
| 파비콘 내보내기            | 크기별 파비콘과 기록                                    | 파비콘만 옮기거나 되돌릴 때.                                                                                                                 |
| 로그인 배경 내보내기       | 다 만든 로그인 배경과 기록, 화면 값(흐림 등), 보관 한도 | 로그인 배경만 옮길 때. 영상이면 수백 MB가 될 수 있고, 만드는 중인 배경은 담지 않습니다. 불러오면 지금 배경 기록이 통째로 바뀝니다.           |
| `pnpm run backup` (명령어) | `.env` + 설정 DB + 파비콘 + 로그인 배경(다 만든 것)     | 다른 폴더, 기기로 옮길 때. 백업을 적용하려면 봇을 끄고 직접 봇 폴더에 백업 데이터를 압축 해제하여 덮어써야 합니다.                           |

- **`.env`의 `SECRETS_KEY`**는 따로 안전히 백업해 두는 것을 권장합니다. 해당 키가 유실되면, DB에 저장된 API 키나 쿠키를 봇이 복호화하지 못하며, 복구할 수 있을 가능성도 현 세기에는 **없습니다**. (AES-256-GCM)
- **백업 불러오기**: 운영자 패널의 백업 탭에서 내보낸 파일을 올리면 항목마다 지금 값과 비교해 보여 주고, 고른 항목만 덮어씁니다. 덮어쓴 설정은 "가져오기 전" 스냅샷(최근 5개)으로만 되돌릴 수 있습니다. 파비콘과 로그인 배경은 스냅샷에 들지 않으니, 불러오기 전에 지금 것을 내보내 두세요.
- `pnpm run backup`으로 만든 파일에는 봇 토큰과 `SECRETS_KEY`가 평문으로 들어 있습니다. **관리에 주의**하고, 사용 목적을 다한 뒤에는 **꼭 삭제하세요**.
- DB의 문제로 봇이 켜지지 않아 대시보드를 못 쓸 때는 **봇을 끈 채** `database/backups/`의 자동 스냅샷 하나를 직접 `database/settings.restore.db`로 복사하고 켜세요. 봇이 기동 과정에서 해당 백업을 불러옵니다.
- Windows에서는 파일 권한이 적용되지 않으므로, 봇 폴더는 다른 사용자와 같이 쓰지 않는 곳에 두는 등 보안 관리에 주의를 기하세요.

## 업데이트 / 유지보수

`git pull`로 코드를 갱신한 뒤, 갱신 내용에 따라:

| 명령                       | 용도                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm install`             | 의존성 갱신. 의존성이 바뀌었을 때만 `postinstall`(ffmpeg 설치, yt-dlp 목표 버전 받기, 대시보드 빌드)이 돕니다 |
| `pnpm run build:dashboard` | 대시보드 화면 다시 빌드. 업데이트 뒤 화면이 구 버전의 것이면 기동 시 로그가 알려 줍니다                       |
| `pnpm run update:bgutil`   | bgutil POToken 공급자를 설정한 태그로 옮기고 다시 빌드                                                        |
| `pnpm run update:ytdlp`    | yt-dlp 를 목표 버전(`.env` 의 채널 · 고정 버전)으로 받기                                                      |
| `pnpm run install:ffmpeg`  | ffmpeg 바이너리 재설치 (`--force`로 강제 재다운로드)                                                          |
| `pnpm run cmddeploy`       | 슬래시 커맨드 강제 재배포                                                                                     |

**슬래시 커맨드 배포**: 기동 시 자동 배포되며, 커맨드 정의가 이전 배포와 같으면 등록을 건너뜁니다.
Discord 쪽 등록 상태가 어긋난 것 같으면 `pnpm run cmddeploy` 또는 대시보드 운영자 페이지의 재배포 버튼으로 강제 배포하세요.

**ffmpeg 설치**: `pnpm install`이 알아서 처리하므로 `install:ffmpeg`를 직접 칠 일은 보통 없습니다. 다운로드가 실패했거나 `vendor/bin/`의 바이너리가 없어졌을 때만 쓰세요.
내려받는 릴리스는 `src/config/index.ts`의 기본값으로 고정되어 있고 sha256으로 검증합니다. 다른 버전을 쓰려면 `.env`의 `FFMPEG_RELEASE`에 태그를 적고 `pnpm run install:ffmpeg --force`로 다시 받으세요.
**각 달의 마지막 빌드만 쓸 수 있습니다** — BtbN은 그 외 autobuild를 2주 뒤 삭제하므로, 중간 날짜로 고정하면 얼마 못 가 내려받기가 404가 됩니다(월말 빌드는 2년 보존).

**yt-dlp 버전**: 봇은 `vendor/bin/yt-dlp`의 버전을 쓰고, 기본으로 nightly 채널의 최신을 하루 한 번 확인해 새 버전이면 받아서 곧바로 바꿔 끼웁니다(재시작 불필요).
채널 · 버전 고정 · 자동 교체 여부는 `.env`의 `YTDLP_CHANNEL` · `YTDLP_VERSION` · `YTDLP_UPDATE`로 정합니다. 새 버전이 말썽이면 로그의 교체 줄에 적힌 직전 버전을 `YTDLP_VERSION`에 적으세요(받아 둔 버전이라 곧바로 돌아갑니다).
YouTube 추출이 갑자기 막히면 하루를 기다리지 말고 `pnpm run update:ytdlp`로 받으세요.

**봇이 꺼졌을 때**: 기동 로그 첫머리의 `직전 실행:` 줄이 지난번이 어떻게 끝났는지 알려 줍니다(깨끗이 끝남 · 다시 시작함 · 기동 실패 · 전역 폭주로 내림 · 기록 없이 끊김).
한 서버에서 난 오류는 그 서버만 다시 켜고 봇 전체는 계속 돕니다. 봇이 스스로 내려가는 것은 서버를 가리지 않는 오류가 쏟아질 때뿐이며, 그때도 재생 세션은 저장되어 다시 켜면 이어서 틉니다.
짧게 끊긴 실행이 연달아 두 번이면 다음 기동은 세션을 복원하지 않습니다(세션은 남으니 `/join`으로 이어 트세요).
종료 코드로 다시 켤지 정할 수 있습니다: `0` 직접 끔 · `3` 전역 폭주(다시 켜도 됨) · `75` 일시적 기동 실패(잠시 뒤 다시) · `78` 설정 · 토큰 · 설치물 문제(고친 뒤에).
`4` 는 대시보드의 다시 시작이며 실행기가 받아 바로 다시 띄우므로 바깥에는 나오지 않습니다.

> [!NOTE]
> 업데이트 내용에 따라 기능이 추가되면 `.env`파일이나 대시보드 설정의 수정이 필요할 수 있습니다.

## SponsorBlock

음악이 아닌 구간을 [SponsorBlock](https://sponsor.ajay.app/) API로 조회해 재생 중 자동으로 건너뜁니다.

- **캐싱**: 받은 구간 데이터는 SponsorBlock 서버 다운 등으로 조회가 안 될 때를 대비하여 로컬 캐싱합니다. 실시간 조회가 되지 않으면 캐싱된 데이터로 구간을 스킵합니다.
- **설정**: 기본 활성 카테고리는 비음악 구간·인트로·최종 화면 구간이며, 운영자 패널 유튜브 탭의 운영 조절값(봇 전역 기본 설정), `/sponsorblock` 명령어 또는 웹 대시보드의 서버 설정(서버별 설정/서버 관리 권한 필요)에서 사용 여부와 건너뛸 카테고리를 조정할 수 있습니다.
- **하이라이트**: `/highlight` 명령이나 대시보드 버튼으로 SponsorBlock에 등록된 하이라이트 지점으로 점프할 수 있습니다.

> [!IMPORTANT]
> https://sponsor.ajay.app/의 CC BY-NC-SA 4.0 라이선스에 따라 제공되는 SponsorBlock 데이터를 사용합니다.
>
> Uses SponsorBlock data licensed under CC BY-NC-SA 4.0 from https://sponsor.ajay.app/.

> [!WARNING]
> **상업적 이용 시 주의**: SponsorBlock 데이터는 [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/)(비상업) 라이선스입니다. 이 봇을 **상업적 목적으로 운영**하려면 운영자 패널 유튜브 탭에서 "SponsorBlock 쓰기"를 끄거나 코드를 수정하여 SponsorBlock 기능을 수정/제거해 주세요.

## 라이선스

이 저장소는 이중 라이선스 구조입니다:

> 많은 부분이 변경·추가·삭제되었으나, 본 프로젝트의 출발점은 [umutxyp/MusicBot](https://github.com/umutxyp/MusicBot) (MIT)입니다.
> 잔류한 원본 코드는 MIT, 이 저장소에서 수정·추가된 코드는 **AGPL-3.0-or-later**를 따릅니다.

- **업스트림 베이스** ([umutxyp/MusicBot](https://github.com/umutxyp/MusicBot)): Copyright (c) 2025 umutxyp - [MIT License](LICENSE-MIT)
- **이 저장소의 수정·추가분**: Copyright (C) 2026 PLeC - [GNU AGPL-3.0-or-later](LICENSE)

결합 저작물 전체에는 AGPL-3.0 조건이 적용됩니다. 이 봇을 네트워크 서비스로 운영하는 경우, 사용자에게 소스 코드를 제공해야 합니다 (`/license` 명령어가 이 역할을 합니다).
상세한 구분 기준은 [NOTICE.md](NOTICE.md)를 참조하세요.

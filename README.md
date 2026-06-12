# Discord Musicbot Project

한국어 UI 기반의 개인용 Discord 음악 봇.
[umutxyp/MusicBot](https://github.com/umutxyp/MusicBot) (MIT)을 베이스로 대폭 개조한 독립 포크입니다.

> **라이선스 요약** — 원본 베이스는 MIT, 이 저장소의 수정·추가분은 **AGPL-3.0-or-later**입니다.
> 자세한 구조는 [NOTICE.md](NOTICE.md)를 참조하세요.

## 주요 기능

- **재생 소스**: YouTube(영상/재생목록), Spotify(트랙/앨범/플레이리스트/아티스트 → YouTube 변환), SoundCloud, 직접 오디오 링크
- **Components V2 재생 UI**: 진행 바, 컨트롤 버튼, 대기열 점프 셀렉트 메뉴가 달린 now-playing 메시지 (웹훅 발송)
- **SQLite 오디오 캐시**: 재생한 곡을 opus로 로컬 캐싱, 재생 빈도·최근성·용량 기반 점수형 자동 퇴거, 디스크 여유 공간 감시
- **세션 저장/복구**: `/leave`로 대기열·재생 위치를 저장하고 `/join`으로 복구. 봇 재시작 시에도 자동 복구 (5초 주기 스냅샷)
- **웹 대시보드**: Express + Vue, Discord OAuth 로그인. 재생 제어·대기열 관리·곡 추가를 브라우저에서
- **봇 전용 채널**: `/setchannel`로 지정한 채널에 곡명/링크만 입력하면 자동 재생
- **장르 자동재생**: 대기열 소진 시 선택한 장르(K-POP, 애니, 로파이 등 18종)의 곡을 자동 탐색·재생
- **상태 메시지 로테이션**: 시간대·양력/음력 날짜 조건부 상태 메시지 (`config/status.json`)
- **음성 채널 상태 표시**: 재생 중인 곡 제목을 음성 채널 상태에 자동 반영

## 명령어

| 분류 | 명령어 |
|---|---|
| 재생 | `/play` `/playfirst` `/search` `/pause` `/seek` `/replay` `/skip` `/previous` `/stop` |
| 대기열 | `/queue` `/shuffle` `/loop` `/move` `/remove` `/clear` `/autoplay` |
| 채널 | `/join` `/leave` `/setchannel` |
| 정보 | `/nowplaying` `/help` `/ping` `/system` `/cachestatus` `/dashboard` `/license` |
| 기타 | `/volume` |

## 설치 및 실행

### 요구 사항

- Node.js >= 24.11.1
- [pnpm](https://pnpm.io/)
- Windows / Linux (FFmpeg는 `ffmpeg-static`으로 내장, yt-dlp는 설치 시 자동 갱신)

### 설정

```bash
git clone https://github.com/PLeC98/Discord-Musicbot-Project.git
cd Discord-Musicbot-Project
pnpm install
cp .env.example .env   # 후 .env 편집
```

`.env` 필수 항목:

| 변수 | 설명 |
|---|---|
| `DISCORD_TOKEN` | 봇 토큰 |
| `CLIENT_ID` / `CLIENT_SECRET` | Discord 애플리케이션 ID / 시크릿 (시크릿은 대시보드 OAuth용) |
| `GUILD_ID` | 테스트 서버 ID (즉시 커맨드 배포). 비우면 글로벌 배포 (최대 1시간 소요) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Spotify 링크 지원용 ([developer.spotify.com](https://developer.spotify.com/dashboard)) |

YouTube 봇 감지 차단이 발생하면 `COOKIES_FROM_BROWSER=chrome`(또는 firefox/edge) 혹은
브라우저 확장으로 내보낸 `cookies.txt`를 `COOKIES_FILE=./cookies.txt`로 지정하세요.

### 실행

```bash
pnpm run start    # 일반 실행
pnpm run shard    # 1000+ 서버용 샤딩 실행
```

## 대시보드

1. `.env`에 `DASHBOARD_URL`(외부 공개 주소 또는 `http://localhost:33333`), `OWNER_ID`, `SESSION_SECRET` 설정
2. [Discord Developer Portal](https://discord.com/developers/applications) → OAuth2 → Redirects에
   `{DASHBOARD_URL}/auth/callback` 추가
3. 클라이언트 빌드:

```bash
cd dashboard/client
pnpm install
pnpm build
```

봇 실행 시 대시보드 서버가 함께 시작됩니다. 리버스 프록시(HTTPS) 뒤·로컬 직접 접속 모두
별도 설정 없이 동작합니다.

## 라이선스

이 저장소는 이중 라이선스 구조입니다:

- **업스트림 베이스** ([umutxyp/MusicBot](https://github.com/umutxyp/MusicBot) 커밋 `e3c825e` 까지):
  Copyright (c) 2025 umutxyp — [MIT License](LICENSE-MIT)
- **이 저장소의 수정·추가분**: Copyright (C) 2026 PLeC — [GNU AGPL-3.0-or-later](LICENSE)

결합 저작물 전체에는 AGPL-3.0 조건이 적용됩니다. 이 봇을 네트워크 서비스로 운영하는 경우,
사용자에게 소스 코드를 제공해야 합니다 (`/license` 명령어가 이 역할을 합니다).
상세한 구분 기준은 [NOTICE.md](NOTICE.md)를 참조하세요.

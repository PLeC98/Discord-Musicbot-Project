# 대시보드 공개 설정 가이드

웹 대시보드는 디스코드 계정으로 로그인해서 쓰는 웹 화면입니다.<br>
봇 설정을 바꾸고, 봇 상태를 보고, 재생을 조작할 수 있습니다.

**봇을 실행하는 기기에서만 쓴다면** 따로 설정할 것이 없습니다.<br>
봇과 같은 기기에서 `http://localhost:33333`에 접속하세요.

다음과 같은 경우에만 이 문서대로 설정하면 됩니다.

- 휴대폰이나 다른 PC에서 대시보드를 열고 싶을 때
- 다른 사람도 대시보드로 재생을 조작하게 하고 싶을 때

> [!WARNING]
> 대시보드를 공개하면 원하지 않는 사람이나 봇도 그 주소에 접속할 수 있습니다.<br>
> 인터넷에 공개한다면 HTTPS를 사용하세요. HTTPS 없이 인터넷에 공개하도록 설정하면 봇이 대시보드를 열지 않습니다.

## 목차

1. [방법 선택](#1-방법-선택)
2. [접속 주소 설정](#2-접속-주소-설정)
3. [디스코드에 로그인 주소 등록](#3-디스코드에-로그인-주소-등록)
4. [방법별 설정](#4-방법별-설정)
5. [안 될 때](#5-안-될-때)
6. [고급 설정](#6-고급-설정)

## 1. 방법 선택

HTTPS, 프록시, 인증서, DDNS가 낯설다면 아래 표에서 내 상황에 맞는 방법을 선택하세요.<br>
이미 쓰고 있는 방식이 있다면 그대로 써도 됩니다.

| 내 상황                                                                                  | 권장안                                                                |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 도메인이 있고 80, 443 포트를 열 수 있음<br>(공유기 포트 포워딩, VPS)                     | [Caddy](#caddy)                                                       |
| 공유기가 주는 DDNS와 인증서를 씀<br>(ASUS 등)                                            | [Caddy](#caddy)<br>또는 공유기에서 내보낸 [인증서 파일](#인증서-파일) |
| 인증서가 있으나 프록시는 두고 싶지 않음<br>(certbot, CF Origin 인증서, `tailscale cert`) | [인증서 파일](#인증서-파일)                                           |
| 포트를 열 수 없거나(CGNAT) 집 IP를 숨기고 싶음                                           | [Cloudflare Tunnel](#cloudflare)                                      |
| 도메인이 없음                                                                            | 무료 DDNS(DuckDNS 등)+[Caddy](#caddy)<br>또는 Tailscale Funnel        |
| 같은 네트워크(집, 사무실)에서만 씀                                                       | [HTTPS 없이 같은 네트워크에서](#https-없이-같은-네트워크에서)         |
| 밖에서 나 혼자만 씀                                                                      | Tailscale(개발자가 테스트하지 않음)                                   |

## 2. 접속 주소 설정

`.env`의 `DASHBOARD_URL`에 브라우저에서 열 주소를 넣습니다.

```
DASHBOARD_URL=https://music.example.com
```

- 주소 뒤의 경로(`/dashboard` 같은 부분)는 빼고 적습니다.
- 포트가 기본값(`https://`는 443, `http://`는 80)이 아니면 포트도 적습니다. 예: `https://music.example.com:8443`

## 3. 디스코드에 로그인 주소 등록

1. [디스코드 개발자 포털](https://discord.com/developers/applications)에서 봇에 쓰는 앱을 엽니다.
2. **OAuth2 → 리디렉션**(Redirects)에 `DASHBOARD_URL` 주소 뒤에 `/auth/callback`을 붙인 주소를 추가하고 저장합니다.
   - 예: `DASHBOARD_URL=https://music.example.com`이면 `https://music.example.com/auth/callback`
   - 봇을 켜면 등록할 주소가 로그에 나옵니다. 그대로 복사해 넣어도 됩니다.
3. **봇 → Privileged Gateway Intents**에서 `Server Members Intent`가 켜져 있는지 확인합니다. 꺼져 있으면 운영자 패널만 쓸 수 있고 서버 화면은 쓸 수 없습니다.

## 4. 방법별 설정

### Caddy

Caddy가 인증서를 받고 갱신까지 알아서 합니다.

1. `.env`에 `DASHBOARD_URL=https://music.example.com`을 넣습니다.
2. Caddyfile에 아래 내용을 넣고 Caddy를 시작합니다.

```
music.example.com {
	reverse_proxy localhost:33333
}
```

### nginx

Caddy 대신 nginx를 쓴다면 아래처럼 설정합니다.<br>
봇이 접속한 주소와 사용자 정보를 알 수 있게 `proxy_set_header` 세 줄을 꼭 넣으세요.<br>
`client_max_body_size`가 없으면 nginx 기본값(1MB)에 걸려 백업 불러오기, 로그인 배경 올리기가 실패합니다.

```
location / {
    proxy_pass http://127.0.0.1:33333;
    client_max_body_size 16m;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 인증서 파일

프록시 없이 봇이 직접 HTTPS를 엽니다.

1. 봇 폴더의 `certs/`에 인증서 파일 두 개를 넣습니다.
   - `certs/cert.pem`: 중간 인증서까지 이어 붙인 인증서(certbot의 `fullchain.pem`)
   - `certs/key.pem`: 암호가 걸리지 않은 키(certbot의 `privkey.pem`)
2. `DASHBOARD_URL`을 `https://` 주소로 적습니다.
   - 공유기에서 바깥 443 포트를 봇 컴퓨터의 33333으로 포워딩했다면 포트 없이(`https://music.example.com`)
   - 아니라면 포트까지(`https://music.example.com:33333`)
3. 봇을 다시 시작합니다.

인증서를 `certs/`로 옮기기 싫다면 `.env`에 두 경로를 모두 적어도 됩니다.<br>
Windows 경로는 `/`로 쓰거나 작은따옴표로 감싸세요.

```
DASHBOARD_TLS_CERT=/etc/letsencrypt/live/music.example.com/fullchain.pem
DASHBOARD_TLS_KEY=/etc/letsencrypt/live/music.example.com/privkey.pem
```

> [!NOTE]
>
> - 봇은 인증서를 갱신하지 않습니다. 인증서를 갱신했다면 봇을 다시 시작하세요.<br>
>   certbot이라면 갱신 뒤 봇을 다시 시작하도록 걸어 두면 편합니다.<br>
>   예: `certbot renew --deploy-hook "systemctl restart musicbot"`(뒤의 명령은 봇을 다시 시작하는 내 명령으로)
> - 만료 14일 전부터 로그와 운영자 패널의 봇 정보 탭에서 알려 줍니다.
> - Docker라면 `certs/`를 마운트하세요. certbot의 `live/` 폴더를 쓴다면 `archive/`도 함께 마운트해야 합니다.
> - 키가 유출됐다면 새 키로 인증서를 다시 발급받아 바꿔 넣고, 옛 인증서는 폐기하세요(certbot이면 `certbot revoke --cert-path 옛인증서.pem`).

### Cloudflare

- **Tunnel**: `DASHBOARD_URL`에 Tunnel에 연결한 도메인을 넣습니다. 포트를 열 필요가 없습니다.
- **프록시(주황 구름)**:
  1. SSL 모드를 Full(strict)로 둡니다.
  2. Cloudflare Origin 인증서를 [인증서 파일](#인증서-파일)로 넣습니다.
  3. `.env`의 `DASHBOARD_PORT`를 Cloudflare가 받는 포트(443, 2053, 2083, 2087, 2096, 8443) 가운데 하나로 바꾸거나, Origin Rules로 봇 포트에 연결합니다.
  - 이 인증서는 Cloudflare를 거칠 때만 통합니다. 집 안에서도 봇 컴퓨터로 바로 가지 말고 Cloudflare를 거쳐 접속해야 합니다.

### HTTPS 없이 같은 네트워크에서

`DASHBOARD_URL`에 봇 컴퓨터의 내부 IP와 포트를 적습니다. 예: `http://192.168.0.10:33333`

봇 컴퓨터의 내부 IP는 `DASHBOARD_URL`을 비워 두고 봇을 켜면 로그에 나옵니다.

로그인 정보가 암호화되지 않고 오가므로, 공용 Wi-Fi처럼 다른 사람과 함께 쓰는 네트워크라면 HTTPS를 사용하세요.

## 5. 안 될 때

### 대시보드가 아예 열리지 않아요

봇을 켤 때 로그에 오류가 있는지 보세요.<br>
`DASHBOARD_URL`이 인터넷에서 접속되는 `http://` 주소면 봇이 대시보드를 열지 않습니다(봇과 재생은 그대로 동작합니다).<br>
이때는 [1. 방법 선택](#1-방법-선택)에서 HTTPS로 공개하는 방법을 선택하세요.

### "이 주소로는 대시보드를 열 수 없어요"가 나와요

`DASHBOARD_URL`과 다른 도메인으로 접속한 것입니다.<br>
그 도메인으로 쓰려면 `DASHBOARD_URL`을 그 주소로 바꾸고 봇을 다시 시작하세요.

### 로그인하면 다른 주소로 넘어가요, 또는 로그인이 안 돼요

로그인은 항상 `DASHBOARD_URL`의 주소에서 합니다. 다른 주소로 열었더라도 로그인할 때 그 주소로 넘어갑니다.<br>
그래서 대시보드를 여는 기기에서 `DASHBOARD_URL`의 주소로 접속할 수 있어야 합니다.

### 집 안에서만 내 도메인으로 접속이 안 돼요

공유기가 NAT 루프백을 지원하지 않는 경우입니다.<br>
공유기의 DNS 설정이나 대시보드를 여는 기기의 hosts 파일에서 그 도메인을 봇 컴퓨터의 내부 IP(`192.168.x.x` 등)로 연결하세요.<br>
Cloudflare Tunnel은 이 문제가 없습니다.

### 인증서 파일을 넣었더니 대시보드가 열리지 않아요

- `DASHBOARD_URL`이 `https://`로 시작하는 도메인인지 확인하세요.
- Caddy나 nginx로 HTTPS를 쓰고 있다면 `certs/`의 인증서 파일을 빼세요.

### HTTPS로 쓰던 도메인을 http로 바꿨더니 접속이 안 돼요

한 번 HTTPS로 연 도메인은 브라우저가 1년 동안 HTTPS로만 엽니다.<br>
브라우저에서 그 기록을 지우세요.

- Chrome, Edge: 주소창에 `chrome://net-internals/#hsts`(Edge는 `edge://net-internals/#hsts`)를 열고, **Delete domain security policies**에 도메인을 넣어 지웁니다.
- Firefox: 방문 기록(Ctrl+Shift+H)에서 그 사이트를 오른쪽 클릭하고 **Forget About This Site**를 누릅니다.

## 6. 고급 설정

보통은 넣지 않아도 됩니다.

| 설정                        | 이럴 때 넣으세요                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DASHBOARD_HOST`            | 프록시가 다른 컴퓨터나 다른 컨테이너에 있을 때, Docker를 host 네트워크로 쓸 때.<br>봇이 대시보드를 열 주소(`0.0.0.0`, 또는 봇 컴퓨터의 네트워크 인터페이스 IP)를 넣습니다 |
| `DASHBOARD_TRUST_PROXY`     | 프록시가 인터넷의 다른 서버(공인 IP)에 있을 때, 그 서버의 IP를 넣습니다.<br>봇을 운영하는 기기나 같은 네트워크, Docker, Tailscale의 프록시는 넣지 않아도 됩니다           |
| `DASHBOARD_ALLOW_PLAINTEXT` | `true`면 인터넷에서도 `http://`로 대시보드를 엽니다. <br>로그인 정보가 그대로 보일 수 있으니 위험을 감수할 경우에만 사용하세요                                            |

봇이 대시보드를 어느 주소로 열었는지는 봇을 켤 때 로그에 나옵니다.

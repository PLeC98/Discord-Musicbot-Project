# 대시보드 공개하기

대시보드는 디스코드로 로그인하는 웹 화면입니다. 이 기기에서만 쓰면 따로 설정할 것이 없고, 다른 기기나 다른 사람이 쓰게 하려면 `.env`의 `DASHBOARD_URL`에 브라우저 주소창에 입력할 주소를 넣습니다.

- 주소는 경로 없이 적습니다(예: `https://music.example.com`, `http://bot.example.com:33333`).
- 디스코드 개발자 포털의 **OAuth2 → Redirects**에 `<DASHBOARD_URL>/auth/callback`을 등록합니다. 봇을 켤 때 기동 로그에 등록할 주소가 나옵니다.
- 디스코드는 사설 IP(`http://192.168.x.x`)의 콜백을 받지 않습니다. 같은 네트워크의 다른 기기에서 쓸 때도 이 기기를 가리키는 도메인(DDNS, Tailscale의 MagicDNS 이름)이 필요합니다.

## 봇이 여는 주소

`DASHBOARD_HOST`를 비워 두면 봇이 아래 순서로 정합니다. 기동 로그에 연 주소와 그 까닭이 나옵니다.

| 상황                                 | 여는 주소                                            |
| ------------------------------------ | ---------------------------------------------------- |
| 컨테이너 안                          | 모든 주소(컨테이너 밖에 여는 범위는 `-p`가 정합니다) |
| `DASHBOARD_URL`이 없거나 `localhost` | 이 기기만(`127.0.0.1`, `::1`)                        |
| `certs/`에 인증서 파일이 있음        | 모든 주소에 HTTPS                                    |
| `DASHBOARD_URL`이 `https://`         | 이 기기만(같은 기기의 프록시가 붙는다고 봅니다)      |
| `DASHBOARD_URL`이 `http://`          | 모든 주소                                            |

프록시가 다른 기기나 다른 컨테이너에 있으면 `DASHBOARD_HOST`에 봇이 열 주소(`0.0.0.0`, 또는 그 네트워크 인터페이스의 IP)를 넣습니다. Docker를 host 네트워크로 쓸 때도 넣으세요(넣지 않으면 호스트의 모든 주소에 열립니다).

## 권하는 공개 방법

| 상황                                                                                       | 방법                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| 도메인이 있고 80, 443 포트를 열 수 있음(공유기 포트 포워딩, VPS)                           | 같은 기기의 Caddy                                                                                                         |
| 공유기가 주는 DDNS와 인증서를 씀(ASUS 등)                                                  | 같은 기기의 Caddy, 또는 공유기에서 내보낸 인증서 파일                                                                     |
| 인증서가 이미 있고 프록시를 두지 않음(certbot, Cloudflare Origin 인증서, `tailscale cert`) | 인증서 파일                                                                                                               |
| 포트를 열 수 없음(CGNAT), 집 IP를 숨기고 싶음                                              | Cloudflare Tunnel                                                                                                         |
| 도메인이 없음                                                                              | DuckDNS 같은 무료 DDNS와 Caddy, 또는 Tailscale Funnel                                                                     |
| 같은 네트워크에서만 쓰거나 혼자만 씀                                                       | 이 기기 안이면 그대로. 다른 기기면 DDNS가 이 기기의 사설 IP를 가리키게 해 `http://이름:33333`, 밖에서 혼자 쓰면 Tailscale |

### Caddy

`DASHBOARD_URL=https://music.example.com`으로 두고, Caddyfile에 두 줄을 넣으면 Caddy가 인증서를 받고 갱신합니다. 봇은 이 기기에만 열립니다.

```
music.example.com {
	reverse_proxy localhost:33333
}
```

### nginx

`proxy_pass`만 쓰면 nginx가 Host를 `127.0.0.1:33333`으로 바꿔 봇이 원래 주소를 알 수 없습니다. 아래처럼 원래 Host와 접속 정보를 넘기세요.

```
location / {
    proxy_pass http://127.0.0.1:33333;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 인증서 파일

프록시 없이 봇이 직접 HTTPS를 엽니다. 봇 폴더의 `certs/`에 두 파일을 넣고 봇을 다시 시작합니다.

- `certs/cert.pem`: 서버 인증서 다음에 중간 인증서를 이은 PEM(certbot의 `fullchain.pem`)
- `certs/key.pem`: 암호가 없는 키(certbot의 `privkey.pem`)

인증서가 다른 곳에 있으면 `.env`에 경로를 넣습니다(둘 다 넣어야 합니다). Windows 경로는 `/`로 쓰거나 작은따옴표로 감싸세요.

```
DASHBOARD_TLS_CERT=/etc/letsencrypt/live/music.example.com/fullchain.pem
DASHBOARD_TLS_KEY=/etc/letsencrypt/live/music.example.com/privkey.pem
```

- `DASHBOARD_URL`은 `https://`여야 합니다. 포트가 443이 아니면 포트를 붙여 적습니다(`https://music.example.com:33333`). 공유기에서 바깥 443을 이 기기의 33333으로 돌리면 포트 없이 적습니다.
- 봇은 인증서를 갱신하지 않습니다. 파일을 바꾸면 봇을 다시 시작하세요. certbot이면 갱신 뒤 봇을 다시 시작하도록 deploy hook을 겁니다(예: `certbot renew --deploy-hook "systemctl restart musicbot"`, 봇을 다시 시작하는 명령으로 바꾸세요).
- 기한이 14일 안으로 남으면 하루 한 번 경고 로그를 남기고, 운영자 패널의 봇 정보 탭에 남은 일수가 나옵니다.
- Docker는 `certs/`를 마운트합니다. certbot의 `live/`는 심볼릭 링크라 `archive/`까지 마운트하세요.
- 공유기에서 내보낸 `cert.tar`(ASUS)는 풀면 이름이 그대로 맞습니다. 공유기가 갱신하면 새 파일로 바꾸고 다시 시작하세요.

### Cloudflare

- **Tunnel**: 포트를 열지 않고 집 IP도 드러나지 않습니다. `DASHBOARD_URL`에 Tunnel에 연결한 도메인 주소를 넣습니다.
- **주황 구름으로 봇 포트에 직접**: SSL 모드는 Full(strict)로 두고, Cloudflare Origin 인증서를 인증서 파일로 넣습니다. Cloudflare가 받는 HTTPS 포트(443, 2053, 2083, 2087, 2096, 8443) 가운데 하나를 `DASHBOARD_PORT`로 두거나 Origin Rules로 돌립니다. Origin 인증서는 브라우저가 신뢰하지 않으므로 집 안에서도 Cloudflare를 거쳐 접속해야 합니다.
- 사용자 IP는 Cloudflare가 넘긴 `CF-Connecting-IP`를 씁니다.

### 집 안에서 자기 도메인으로 접속되지 않을 때

공유기가 NAT 루프백을 하지 않으면 집 안에서는 자기 공인 IP로 들어갈 수 없습니다. 공유기 DNS나 이 기기의 hosts 파일에 그 도메인을 이 기기의 사설 IP로 넣으세요. Cloudflare Tunnel은 이 문제가 없습니다.

## 막는 것

- **인터넷 평문**: `DASHBOARD_URL`이 `http://`이고 그 호스트가 공인 주소(공인 IP, 또는 공인 IP를 가리키는 도메인)면 대시보드를 열지 않습니다. 인터넷에서 평문으로 들어온 요청에는 안내 화면을 보입니다. 같은 네트워크(사설망, Tailscale)의 평문은 막지 않습니다. 이때 로그인 쿠키가 암호화되지 않고 오가므로 같은 망의 다른 사람이 엿볼 수 있습니다. 공용 Wi-Fi처럼 믿을 수 없는 망이면 HTTPS로 공개하세요. 공인 IP를 내부망으로 쓰는 곳처럼 위험을 감수할 때만 `.env`에 `DASHBOARD_ALLOW_PLAINTEXT=true`를 넣습니다(대시보드에서는 바꿀 수 없습니다).
- **다른 이름**: `DASHBOARD_URL`의 호스트, `localhost`, IP, 점 없는 이름, `.local`, `.lan`, `.internal`, `.home.arpa`로 들어온 요청만 받습니다. 다른 도메인으로 열려면 `DASHBOARD_URL`을 그 주소로 바꾸세요. 로그인은 늘 `DASHBOARD_URL`에서 시작합니다.
- **원격 프록시의 IP**: 이 기기, 사설망, Docker, Tailscale 주소의 프록시는 자동으로 신뢰합니다. 공인 IP에 있는 프록시만 `DASHBOARD_TRUST_PROXY`에 넣습니다.

## HTTPS로 쓰던 도메인을 평문으로 되돌릴 때

HTTPS로 쓰던 도메인은 브라우저가 1년 동안 HTTPS로만 엽니다(HSTS). `.env`를 바꿔도 풀리지 않습니다. 다른 도메인을 쓰거나, 브라우저에서 그 도메인의 HSTS를 지웁니다.

- Chrome, Edge: 주소창에 `chrome://net-internals/#hsts`(Edge는 `edge://net-internals/#hsts`)를 열고 **Delete domain security policies**에 도메인을 넣어 지웁니다.
- Firefox: 방문 기록(Ctrl+Shift+H)에서 그 사이트를 오른쪽 클릭하고 **Forget About This Site**를 누릅니다.

## 키가 유출되었을 때

1. 새 키로 인증서를 다시 발급받습니다(certbot이면 `certbot certonly --force-renewal`).
2. `certs/`의 파일이나 `.env`의 경로를 새 파일로 바꾸고 봇을 다시 시작합니다.
3. 옛 인증서를 폐기합니다(certbot이면 `certbot revoke --cert-path 옛인증서.pem`).
4. 공유기와 같은 키를 쓰고 있었다면 공유기의 인증서도 새로 발급받습니다.

## 업데이트 뒤 달라진 점

- `DASHBOARD_URL`이 `https://`면 봇이 이 기기에만 열립니다. 프록시가 이 기기의 사설 IP로 붙고 있었다면 프록시 대상을 `localhost:33333`으로 바꾸거나 `DASHBOARD_HOST`를 넣으세요.
- `DASHBOARD_URL`이 공인 주소의 `http://`면 대시보드가 열리지 않습니다. 위의 공개 방법으로 HTTPS를 쓰세요.
- `DASHBOARD_TRUST_PROXY`에 사설망 주소를 넣어 두었다면 지워도 됩니다.
- HTTPS로 쓰던 대시보드는 업데이트 뒤 한 번 다시 로그인해야 합니다.

# 키움 중계 서버 설치 안내 (1단계: 계좌 잔고 조회)

김가네 주식 앱의 **관심 종목** 탭 위쪽에 "내 키움 계좌"를 보여주기 위한 작은 서버예요.

- 키움 REST API는 키움에 등록한 **고정 IP**에서만 호출할 수 있어요. Vercel은 IP가 계속 바뀌어서, 고정 IP가 있는 **AWS Lightsail 서울** 서버에서 이 프로그램을 돌려요.
- **조회만** 해요. 이 프로그램에는 주문 기능이 없어요.
- 키움 앱키·시크릿키는 이 서버의 설정 파일에만 넣어요. **채팅, 코드, GitHub에는 절대 넣지 마세요.**
- 앱에 로그인한 계정 중 `OWNER_EMAIL` 계정만 잔고를 볼 수 있어요. 다른 가족 계정에는 계좌 칸이 보이지 않아요.

```
휴대폰 앱 ──HTTPS──▶ 이 서버 (서울 고정 IP, DuckDNS 주소) ──▶ 키움 REST API
              로그인 토큰 확인 (Supabase)
```

준비물: 키움 REST API 앱키·시크릿키 (이미 받으셨어요), AWS 계정, DuckDNS 계정. 전체 30~40분 정도 걸려요.

---

## 1. AWS Lightsail 서울 서버 만들기

1. https://aws.amazon.com/ko/ 에서 **AWS 계정 생성**으로 가입해요. (카드 등록과 휴대폰 인증이 있어요)
2. 로그인 뒤 위쪽 검색창에 **Lightsail**을 입력해 들어가요. 화면 오른쪽 위 언어를 **한국어**로 바꿀 수 있어요.
3. **인스턴스 생성**을 눌러요.
   - 위치: **서울 (ap-northeast-2)** ← 꼭 확인
     (새 AWS 계정이 "프로젝트" 방식이면 가입 때 정한 리전에서만 열릴 수 있어요. 서울이 거부되면 열리는 리전(예: 시드니)에 만들고, 5단계에서 키움이 그 IP를 받아 주는지 확인해요)
   - 플랫폼: **Linux/Unix**
   - 블루프린트: **운영 체제(OS) 전용 → Ubuntu 22.04 LTS** (또는 24.04)
   - 요금제: **"IPv4" 가 포함된 가장 작은 요금제** (월 5달러 정도). "IPv6 전용"은 고르지 마세요. 키움에는 IPv4 주소를 등록해야 해요. 요금제에 "3개월 무료" 같은 표시가 있으면 그 기간은 무료예요.
   - 인스턴스 이름: `kimga-relay`
   - **인스턴스 생성**을 눌러요. 1~2분 뒤 "실행 중"이 돼요.
4. **고정 IP 만들기**: 인스턴스를 누르고 **네트워킹** 탭 → **고정 IP 생성** → 방금 만든 인스턴스에 연결 → 생성
   - 화면에 나온 **고정 IP 주소**를 메모해요. (예: `3.38.xx.xx`)
   - 고정 IP는 인스턴스에 연결해 두면 추가 요금이 없어요. 인스턴스를 지울 때는 고정 IP도 같이 지워야 요금이 안 나가요.
5. **HTTPS 열기**: 같은 **네트워킹** 탭의 **IPv4 방화벽**에서 **규칙 추가** → 애플리케이션 **HTTPS** (TCP 443) → 생성
   - SSH(22)와 HTTP(80)는 보통 처음부터 열려 있어요. 없으면 같은 방법으로 추가해요.

> 요금이 걱정되면 AWS 콘솔 검색창에 **Budgets**를 입력해서 "월 10달러 넘으면 메일" 같은 예산 알림을 만들어 두세요.

## 2. 무료 주소(DuckDNS) 만들기

앱이 HTTPS로 서버에 접속해야 해서 주소가 필요해요.

1. https://www.duckdns.org 에 로그인해요 (구글 계정 등).
2. 원하는 이름을 넣고 **add domain** (예: `kimga-stock` → `kimga-stock.duckdns.org`)
3. 그 줄의 **current ip**에 1단계의 **고정 IP**를 넣고 **update ip**를 눌러요.

## 3. 서버에 접속해서 설치하기

Lightsail 인스턴스 화면에서 **SSH를 사용하여 연결**(터미널 모양 버튼)을 누르면 브라우저에 검은 창이 열려요. 키 파일은 필요 없어요.

검은 창에 아래를 **한 덩어리씩** 붙여 넣고 `Enter`를 눌러요. (붙여 넣기는 `Ctrl+Shift+V` 또는 마우스 오른쪽 클릭)

**① Node.js 20 설치**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git
```

**② Caddy 설치** (HTTPS 인증서를 자동으로 받아 주는 웹 서버)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

**③ 프로그램 받기**

```bash
cd ~ && git clone https://github.com/umgichukg-cmyk/kim-stock.git
```

**④ 설정 파일 만들기** - 키는 여기에만 넣어요

```bash
sudo nano /etc/kimga-relay.env
```

아래 내용을 붙여 넣고 `여기에…` 부분을 바꾼 뒤 `Ctrl+O`, `Enter`, `Ctrl+X`로 저장해요.

```
KIWOOM_APPKEY=여기에_키움_앱키
KIWOOM_SECRETKEY=여기에_키움_시크릿키
KIWOOM_MOCK=false
OWNER_EMAIL=여기에_김가네주식_로그인_이메일
SUPABASE_URL=https://kxljcwporlfzmtfgyqmr.supabase.co
SUPABASE_KEY=sb_publishable_pP-EhRkiQbLPned3NVRP9Q_Rpjut7ND
ALLOWED_ORIGINS=https://kim-stock-kimga.vercel.app,https://kim-stock-liart.vercel.app
PORT=8080
```

- `KIWOOM_MOCK`: 실전 계좌 키면 `false`, 모의투자 키면 `true` (키 종류와 다르면 키움이 거부해요)
- `OWNER_EMAIL`: 앱에서 로그인할 때 쓰는 **본인 이메일** (이 계정만 잔고를 봐요)

파일을 본인만 읽을 수 있게 해요.

```bash
sudo chmod 600 /etc/kimga-relay.env
```

**⑤ 자동 실행 등록** (서버가 재부팅돼도 다시 켜지게)

```bash
sudo tee /etc/systemd/system/kimga-relay.service > /dev/null <<'EOF'
[Unit]
Description=Kimga Kiwoom relay
After=network-online.target

[Service]
EnvironmentFile=/etc/kimga-relay.env
WorkingDirectory=/home/ubuntu/kim-stock/kiwoom-relay
ExecStart=/usr/bin/node server.js
Restart=always
User=ubuntu

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now kimga-relay
```

**⑥ HTTPS 연결** - `kimga-stock`을 2단계에서 만든 이름으로 바꿔요

```bash
echo 'kimga-stock.duckdns.org {
  reverse_proxy 127.0.0.1:8080
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 4. 키움에 서버 IP 등록

키움 REST API 포털(https://openapi.kiwoom.com) → **계좌 App Key 관리** → **IP 주소등록**에 1단계의 **고정 IP**를 추가해요.

## 5. 확인

브라우저에서 `https://kimga-stock.duckdns.org/health` 를 열어 `{"ok":true,...}`가 나오면 성공이에요. (HTTPS 인증서를 받는 데 1~2분 걸릴 수 있어요)

그다음 **이 주소(`https://kimga-stock.duckdns.org`)를 알려 주세요.** 앱 코드의 `KIWOOM_RELAY_URL`에 넣으면, 본인 계정으로 로그인했을 때 관심 종목 탭에 "내 키움 계좌"가 나와요.

## 문제가 생기면

```bash
sudo systemctl status kimga-relay      # 실행 중인지
sudo journalctl -u kimga-relay -n 50   # 최근 기록 (키는 기록에 남지 않아요)
```

| 화면·기록 | 원인 |
|---|---|
| 키움 토큰 발급 실패 … 8010 | 키움에 등록한 IP와 서버 고정 IP가 달라요 |
| 키움 토큰 발급 실패 … 8031 | 실전 키인데 `KIWOOM_MOCK=true` (또는 반대) |
| 계좌를 볼 수 있는 계정이 아니에요 | 앱 로그인 이메일과 `OWNER_EMAIL`이 달라요 |
| /health 가 안 열림 | Lightsail 방화벽의 HTTPS(443)·HTTP(80), DuckDNS의 IP를 확인해요 |

## 업데이트

```bash
cd ~/kim-stock && git pull && sudo systemctl restart kimga-relay
```

## 시험용 가짜 잔고

키움에 접속하지 않고 화면만 확인하고 싶으면 설정 파일에 `KIWOOM_FAKE=true`를 넣고 다시 시작해요. 키움 공식 문서 예시를 바꾼 가짜 잔고가 나와요. 확인이 끝나면 꼭 지워 주세요.

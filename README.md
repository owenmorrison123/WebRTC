# Campus Portal

An always-on, low-latency, 1-to-1 video + audio portal between two sites, built on WebRTC.

- **Media goes directly between the two campuses** (peer-to-peer). The server only does the initial handshake, so its location has no effect on the delay.
- **Kiosk behaviour:** it starts on page load, shows a waiting screen until the other site is online, and reconnects by itself after network drops, page reloads, camera unplugs and server restarts. A live call keeps running even if the server goes down.
- **Low-latency tuning:** the receive jitter buffer is kept as small as possible, video drops resolution instead of frame rate when bandwidth is tight, packets are marked high priority (DSCP), and echo cancellation is on so open speakers don't cause feedback.

```
 University kiosk  ◄──── video + audio (UDP, peer-to-peer) ────►  England campus kiosk
         │                                                              │
         └──────────► signaling server (this app, tiny) ◄───────────────┘
                       + optional TURN relay (for strict firewalls)
```

## What delay to expect

Transatlantic (US East Coast to UK) network round trip is usually **70–90 ms**. With this tuning the camera-to-screen delay is typically **~150–250 ms** each way, which feels like a normal conversation. Press **S** on the portal to see live numbers, including RTT, jitter buffer, encode/decode time and estimated one-way delay.

---

## 1. Run it

Requires Node.js 18 or newer.

```bash
npm install
npm start               # http://localhost:8080
```

Open `http://localhost:8080` in two browser tabs to try it. Browsers only allow camera access on **HTTPS** or `localhost`, so a real deployment must be served over HTTPS (see step 3).

## 2. Set up each site

1. Open the site with no parameters. You'll see the **setup page**.
2. Fill in the same **room name** and **key** at both sites, give each site a name (for example "Boston Campus" or "Oxford Campus"), and pick the camera, mic and speaker.
3. Click **Open portal** and bookmark that URL on the kiosk machine. You can also set it as the browser's start page.

### Kiosk machine (recommended)

Run Chrome or Edge in kiosk mode so it opens fullscreen and plays sound without a click:

```bash
# Windows
chrome.exe --kiosk --autoplay-policy=no-user-gesture-required "https://portal.example.edu/?room=..."
# macOS
open -a "Google Chrome" --args --kiosk --autoplay-policy=no-user-gesture-required "https://..."
# Linux
google-chrome --kiosk --autoplay-policy=no-user-gesture-required "https://..."
```

Allow camera and mic once ("Remember this decision") and turn off OS sleep and screensaver. Use a **wired Ethernet** connection. Wi-Fi adds jitter, which adds delay.

### Keyboard / mouse

| Key | Action |
|---|---|
| **S** | Show/hide connection stats |
| **M** | Mute/unmute mic |
| **V** | Camera on/off |
| **F** or double-click | Fullscreen |

Moving the mouse shows a toolbar. The cursor hides after 3 s.

### URL options

| Param | Default | Meaning |
|---|---|---|
| `room` | — | Room name (must match at both sites) |
| `key` | — | Room key (required if server sets `ROOM_KEY`) |
| `label` | — | This site's name, shown on the other screen |
| `res` | `720` | `540`, `720`, or `1080` |
| `fps` | `30` | Max frame rate |
| `bitrate` | 1200/2500/4500 | Max video kbps |
| `codec` | auto | `VP8`, `H264`, `VP9`, `AV1` |
| `jb` | `0` | Jitter-buffer target in ms. Raise to 50–150 if video stutters on a lossy link (smoother but more delay) |
| `cam` / `mic` / `spk` | default | Device IDs (the setup page fills these) |
| `self=0` | — | Hide self-view |
| `fit=contain` | — | Letterbox instead of crop-to-fill |
| `stats=1` | — | Show stats on start |

## 3. Deploy

The server is a single Node process with one dependency (`ws`). Any host that supports WebSockets works, including Render, Fly.io, Railway, a small VPS, or a university VM.

### Environment variables

| Var | Purpose |
|---|---|
| `PORT` | Listen port (default 8080) |
| `ROOM_KEY` | Shared secret. **Set this**, so only people with the link can join |
| `SSL_CERT`, `SSL_KEY` | Paths to cert/key if serving HTTPS directly (otherwise put it behind a reverse proxy) |
| `TURN_URLS` | e.g. `turn:turn.example.edu:3478?transport=udp,turns:turn.example.edu:443?transport=tcp` |
| `TURN_SECRET` | coturn `static-auth-secret`. Generates short-lived credentials automatically |
| `TURN_USER`, `TURN_PASS` | Static TURN credentials (alternative to `TURN_SECRET`) |
| `ICE_SERVERS` | Full JSON override, e.g. from a managed TURN provider |
| `STUN_URLS` | Override default Google STUN |

### Docker

```bash
docker build -t campus-portal .
docker run -d --restart=always -p 8080:8080 -e ROOM_KEY=change-me campus-portal
```

### Behind nginx (HTTPS)

```nginx
server {
  listen 443 ssl http2;
  server_name portal.example.edu;
  ssl_certificate     /etc/letsencrypt/live/portal.example.edu/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/portal.example.edu/privkey.pem;
  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
  }
}
```

## 4. Firewalls and TURN (important for universities)

University networks often block the peer-to-peer UDP that WebRTC prefers. Test first: press **S** and look at **Path**.

- `direct P2P` is ideal and gives the lowest latency. Nothing more is needed.
- No connection, or stuck on "Connecting…": you need a **TURN relay**.
- `TURN relay` works, but each packet takes an extra hop. **Put the TURN server close to the straight line between the sites** (for example US East or London) to keep added delay small.

**Option A: managed TURN.** Cloudflare Calls TURN, Twilio Network Traversal, or Metered.ca. Paste their ICE config into `ICE_SERVERS`.

**Option B: self-host coturn** on a small VM with a public IP:

```bash
sudo apt install coturn
```

`/etc/turnserver.conf`:

```
listening-port=3478
tls-listening-port=443
fingerprint
use-auth-secret
static-auth-secret=LONG_RANDOM_SECRET
realm=portal.example.edu
cert=/etc/letsencrypt/live/turn.example.edu/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.edu/privkey.pem
min-port=49152
max-port=65535
no-cli
```

Then run the portal with:

```
TURN_URLS=turn:turn.example.edu:3478?transport=udp,turn:turn.example.edu:3478?transport=tcp,turns:turn.example.edu:443?transport=tcp
TURN_SECRET=LONG_RANDOM_SECRET
```

**Ask both campus IT teams** to allow outbound UDP to the TURN server's ports, or better, outbound UDP in general from the kiosk machines. The `turns:…:443` entry is a fallback that works through almost any firewall, but TCP adds delay when packets are lost.

## 5. Tips for the lowest delay

1. **Wired Ethernet** at both ends, with no VPN on the kiosk machines.
2. Use **direct P2P** if at all possible. Ask IT to allow UDP.
3. Keep `jb=0` unless you see stutter.
4. Use **720p30** unless both sites have strong upload bandwidth (more than 6 Mbps). Higher resolution means more encode time and more risk of congestion.
5. If the stats show `limited by: cpu`, drop to 720p or try `codec=H264`, which is often hardware-accelerated.
6. Use a USB speakerphone or a good mic/speaker pair. Echo cancellation is on, but hardware matters.
7. Use Chrome or Edge on the kiosks. They have the most complete low-latency WebRTC controls.

## Files

```
server.js         signaling + static server + TURN credential minting
public/index.html setup page + portal UI
public/app.js     WebRTC client (perfect negotiation, auto-recovery, tuning, stats)
Dockerfile
```

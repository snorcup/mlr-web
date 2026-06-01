# Deployment

## Production Overview

| Property | Value |
|----------|-------|
| **Public URL** | `https://mlr.51fifty.io` |
| **Host** | panel (`100.126.50.30`) |
| **App path on host** | `/opt/mlr-web` |
| **Container name** | `mlr-web` |
| **Host binding** | `100.126.50.30:8088 → 8080` |
| **Image** | `snorcup/mlr-web:local` |
| **Traefik config** | `/opt/traefik/dynamic/config.yaml` |
| **Auth** | Authentik forward auth (`authentik@file`) |

## Infrastructure Topology

```
Internet
    ↓ HTTPS (443)
Traefik on panel (100.126.50.30)
    ↓ HTTP (8088)
mlr-web container on panel (127.0.0.1:8088 → 8080)
    ↓ static HTML/JS/CSS (nginx)

User's browser (snorcup-ips, 100.106.156.59)
    ↓ WebSocket (localhost:8089)
serialosc-ws-bridge on user's machine
    ↓ OSC UDP (127.0.0.1:12002)
serialosc daemon on user's machine
    ↓ libusb (raw USB)
monome classic 8x16 (USB)
```

**Key point:** The web server (nginx in Docker) runs on panel, but the serialosc bridge runs on the **user's local machine** (snorcup-ips) where the monome USB is physically connected. The browser connects to both.

## DNS

- `mlr.51fifty.io` → `172.238.160.206` (panel's public IP)
- `*.51fifty.io` wildcard resolves to the same IP via the existing DNS zone
- DNS is managed externally (not by this project)

## Docker Image Build

The Dockerfile uses a multi-stage build:

1. **`deps` stage** (`node:22-alpine`): installs npm dependencies
2. **`test` stage**: copies source, runs `npm test`, `npm run check`, `npm run build`
3. **`runtime` stage** (`nginx:1.27-alpine`): copies static assets from test stage, serves via nginx

The test stage ensures no broken code makes it into the production image.

## Cache Busting

After each deploy, the HTML references to JS/CSS are updated with a new query string (`?v=views-1`, etc.) to force browsers to fetch fresh assets. The nginx config also sets `Cache-Control: no-cache, no-store, must-revalidate` for HTML responses.

## Update Production

### Standard Update (pull from Git)

On the user's machine (agent/CI), the agent deploys via:

```bash
# On agent (this machine), build and push image
cd /root/snorcup/mlr-web
docker build -t snorcup/mlr-web:local .
docker save snorcup/mlr-web:local | ssh panel 'docker load'
```

Then on panel (or via SSH from agent):

```bash
cd /opt/mlr-web
git pull --ff-only
docker compose up -d --build mlr-web
```

**Note**: The `docker-compose.yml` in the repo binds to `127.0.0.1:8088`. On panel, it's patched to bind to `100.126.50.30:8088` so Traefik can reach the backend. The `docker compose up -d` (without `--build`) uses the already-loaded image.

### Verify Deployment

```bash
# Container healthy
docker ps --filter name=mlr-web --format "{{.Names}} {{.Status}}"

# Direct backend check
curl -fsS http://100.126.50.30:8088/ | grep 'MLR Web'

# External endpoint (unauthenticated → 302 to Authentik)
curl -skI https://mlr.51fifty.io
```

Expected: `HTTP/2 302` redirect to `https://auth.51fifty.io/...`

## Traefik Route

The route in `/opt/traefik/dynamic/config.yaml`:

```yaml
http:
  routers:
    mlr-web:
      rule: "Host(`mlr.51fifty.io`)"
      entryPoints: [websecure]
      tls:
        certResolver: letsencrypt
      service: mlr-web
      middlewares:
        - authentik@file

  services:
    mlr-web:
      loadBalancer:
        servers:
          - url: "http://100.126.50.30:8088"
```

Traefik watches this file automatically — no restart required after changes.

## Authentik

The deployment uses Authentik forward auth. The existing production setup:

- **Provider name**: `MLR Web`
- **External host**: `https://mlr.51fifty.io`
- **Mode**: `forward_single`
- **Cookie domain**: `51fifty.io`
- **App slug**: `mlr-web`
- **Outpost**: `authentik Embedded Outpost`
- **Auth flow**: `default-provider-authorization-implicit-consent`

If rebuilding from scratch, create the provider/application via Authentik UI or Django shell, matching patterns used by other `*.51fifty.io` services.

## serialosc Bridge (User's Machine)

The bridge is not part of the Docker deployment — it runs on the user's local machine (snorcup-ips) and is **not managed by this repo's deployment process**.

If the bridge stops working after a reboot:

```bash
# Check services
systemctl --user status serialosc
systemctl --user status serialosc-ws-bridge

# Restart if needed
systemctl --user restart serialosc
systemctl --user restart serialosc-ws-bridge

# Verify WS bridge is listening
ss -tlnp | grep 8089

# Check bridge logs
journalctl --user -u serialosc-ws-bridge --no-pager -n 20
```

## Monitoring

Key health indicators:

| Check | Command | Expected |
|-------|---------|----------|
| Container running | `docker ps --filter name=mlr-web` | `Up (healthy)` |
| Backend serving | `curl -fsS http://100.126.50.30:8088/` | Contains `MLR Web` |
| External HTTPS | `curl -skI https://mlr.51fifty.io` | `HTTP/2 302` |
| Traefik route active | Check Traefik dashboard | Router `mlr-web` listed |
| Bridge running (user machine) | `ss -tlnp \| grep 8089` | `LISTEN` on 8089 |
| serialosc running (user machine) | `systemctl --user status serialosc` | `active (running)` |

## Rollback

If a new deployment has issues:

```bash
cd /opt/mlr-web
git revert HEAD      # or: git checkout <previous-commit>
docker compose up -d --build mlr-web
```

Or manually load a previous image that's still in Docker's local cache:
```bash
docker images | grep mlr-web
docker tag snorcup/mlr-web:local snorcup/mlr-web:backup  # before updating
# To rollback:
docker tag snorcup/mlr-web:backup snorcup/mlr-web:local
docker compose up -d mlr-web
```

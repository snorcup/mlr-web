# Deployment

## Current production deployment

MLR Web is deployed on the panel host and routed through the central Traefik instance.

- Public URL: `https://mlr.51fifty.io`
- Host: panel (`100.126.50.30`)
- App path on host: `/opt/mlr-web`
- Container: `mlr-web`
- Host binding: `100.126.50.30:8088 -> 8080`
- Traefik dynamic config: `/opt/traefik/dynamic/config.yaml`
- Auth: Authentik forward auth (`authentik@file`), with an Authentik proxy provider/application named `MLR Web`

> Note: `51firty.io` does not currently resolve in DNS. The live deployment uses the existing `51fifty.io` zone.

## Update production

On panel:

```bash
cd /opt/mlr-web
git pull --ff-only
python3 - <<'PY'
from pathlib import Path
p = Path('docker-compose.yml')
s = p.read_text()
s = s.replace('127.0.0.1:8088:8080', '100.126.50.30:8088:8080')
p.write_text(s)
PY
docker compose up --build -d
```

Verify:

```bash
curl -fsS http://100.126.50.30:8088/ | grep 'MLR Web'
docker inspect --format='{{.State.Health.Status}}' mlr-web
curl -skI https://mlr.51fifty.io
```

Expected external response when unauthenticated: `HTTP/2 302` to `https://auth.51fifty.io/...`.

## Traefik route

The route added to `/opt/traefik/dynamic/config.yaml` is:

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

Traefik watches this file, so no restart is normally required.

## Authentik

The deployment requires a matching Authentik proxy provider assigned to the embedded outpost. The existing production provider is:

- Provider: `MLR Web`
- External host: `https://mlr.51fifty.io`
- Mode: `forward_single`
- App slug: `mlr-web`
- Outpost: `authentik Embedded Outpost`

If rebuilding from scratch, create the provider/application using the Authentik UI or Django shell, matching the patterns used by the other `*.51fifty.io` services.

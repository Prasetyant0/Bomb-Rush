# BOMB RUSH — deployment smoke test

- **Target:** `bombbrush.my.id` → `129.226.203.243`
- **Probed from:** Windows dev machine (public internet), 2026-10-24 ~08:14–08:17 UTC
- **Method:** read-only HTTP/DNS probes from outside. No SSH was used, nothing on the server was modified.

Expected end state per [`deploy/setup.sh`](./setup.sh): Node 20, service user `bomb`,
repo at `/opt/bomb-rush`, systemd unit `bomb-rush` on `127.0.0.1:3000`, nginx serving
`apps/web` statically on port 80 with `/api/` and `/socket.io/` proxied to the app.

---

## Verdict

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | DNS — `bombbrush.my.id` resolves | **FAIL** | NXDOMAIN from system, Google (`8.8.8.8`) and Cloudflare (`1.1.1.1`) resolvers |
| 2 | DNS — delegated to `ns1.sumopod.com` | **FAIL** | Authoritative query refused; domain does not exist at the zone |
| 3 | Frontend at `http://129.226.203.243/` | **FAIL** | HTTP 404, 162-byte nginx error page — not BOMB RUSH |
| 4 | Frontend at `https://129.226.203.243/` | **FAIL (wrong app)** | HTTP 200, but serves **NEMOS**, not BOMB RUSH |
| 5 | `/app.js` loads (module entrypoint) | **FAIL** | 404 on :80; on :443/:3000 returns `text/html` SPA fallback, not JS |
| 6 | API `/api/` proxied | **FAIL** | 404 on :80 and :443; `:3000/api/health` is NEMOS Backend API |
| 7 | `/socket.io/` proxied | **FAIL** | 404 on :80; 200 on :443/:3000, but that is NEMOS's Socket.IO |
| 8 | `/health` | **FAIL** | 404 on :80; `https://…/health` returns `NEMOS AI Microservice` |
| 9 | Settlement (settler key) | **UNKNOWN** | Cannot be inspected remotely; `setup.sh` defaults to DISABLED when no `/tmp/bomb-deploy.env` |

**One-line reason:** DNS for `bombbrush.my.id` is not delegated (NXDOMAIN everywhere),
and the VPS at `129.226.203.243` is currently serving a **different application**
(NEMOS) on ports 443 and 3000 — BOMB RUSH is not deployed on this host.

---

## Raw output

### 1–2. DNS

```
$ nslookup bombbrush.my.id
*** UnKnown can't find bombbrush.my.id: Non-existent domain
Server:  UnKnown
Address:  192.168.34.1

$ nslookup bombbrush.my.id ns1.sumopod.com
*** UnKnown can't find bombbrush.my.id: Query refused
Server:  UnKnown
Address:  103.229.72.219

$ nslookup bombbrush.my.id 8.8.8.8
*** dns.google can't find bombbrush.my.id: Non-existent domain
Server:  dns.google
Address:  8.8.8.8

$ nslookup bombbrush.my.id 1.1.1.1
*** one.one.one.one can't find bombbrush.my.id: Non-existent domain
Server:  one.one.one.one
Address:  1.1.1.1

$ nslookup -type=ns bombbrush.my.id 8.8.8.8
*** dns.google can't find bombbrush.my.id: Non-existent domain

$ curl -sS -m 10 -I http://bombbrush.my.id/
curl: (6) Could not resolve host: bombbrush.my.id
```

Notes: `ns1.sumopod.com` itself does resolve (`103.229.72.219`), so the nameserver host
is alive — but it answers **REFUSED** for `bombbrush.my.id`, meaning the zone is not
delegated from the `my.id` registry to it (or the record was never created). The parent
zone resolves normally (`my.id NS = a/b/c/d/e/f.dns.id`), so this is not a general
resolver outage.

### 3. Frontend over plain HTTP

```
$ curl -sS -m 10 -o /dev/null -w '%{http_code}' http://129.226.203.243/
404

$ curl -sS -m 10 -D - http://129.226.203.243/
HTTP/1.1 404 Not Found
Server: nginx/1.24.0 (Ubuntu)
Date: Sat, 24 Oct 2026 08:14:53 GMT
Content-Type: text/html
Content-Length: 162
Connection: keep-alive

<html>
<head><title>404 Not Found</title></head>
<body>
<center><h1>404 Not Found</h1></center>
<hr><center>nginx/1.24.0 (Ubuntu)</center>
</body>
</html>
```

`/index.html` and `/styles.css` are also 404 on port 80, and the response is identical
whether `Host:` is absent, `bombbrush.my.id`, or `localhost` — nginx on :80 has no
matching `server` block serving a docroot, so it falls through to the default 404.

### 4. What the host is actually serving

```
$ curl -sS -m 10 -k https://129.226.203.243/
<!doctype html>
<html lang="en">
<head>
  <title>NEMOS | Revenue Based Financing untuk UMKM</title>
  <script type="module" crossorigin src="/assets/index-DfSxZqHk.js"></script>
```

```
$ curl -sS -m 10 -k -D - -o /dev/null https://129.226.203.243/
HTTP/1.1 200 OK
Server: nginx/1.24.0 (Ubuntu)
Content-Type: text/html
Content-Length: 751
Last-Modified: Tue, 08 Sep 2026 09:36:28 GMT
```

```
$ curl -sS -m 10 -k https://129.226.203.243/health
{"status":"ok","service":"NEMOS AI Microservice","model":"meta/llama-3.2-11b-vision-instruct","provider":"NVIDIA NIM"}

$ curl -sS -m 10 http://129.226.203.243:3000/api/health
{"status":"ok","service":"NEMOS Backend API","demoMode":false,"timestamp":"2026-10-24T08:17:04.161Z"}
```

```
$ openssl s_client -connect 129.226.203.243:443 -servername bombbrush.my.id | openssl x509 -noout -subject -dates
subject=CN=nemos.web.id
notBefore=Sep  3 10:53:07 2026 GMT
notAfter=Dec  2 10:53:06 2026 GMT
```

The TLS certificate is for **`nemos.web.id`**, and `--resolve bombbrush.my.id:443:...`
still lands on the NEMOS page (the vhost is the default catch-all). Port 3000 is also
occupied: it answers with `Server: nginx/1.31.5`, i.e. a container/reverse proxy fronting
NEMOS — not the Node/Fastify process `setup.sh` expects on `127.0.0.1:3000`.

### 5. Module entrypoint `/app.js`

```
$ curl -sS -m 10 -o /dev/null -w 'code=%{http_code}' http://129.226.203.243/app.js
code=404

$ curl -sS -m 10 http://129.226.203.243:3000/app.js -w 'type=%{content_type} bytes=%{size_download}'
code=200 type=text/html bytes=751
first-line: <!doctype html><html lang="en"><head>  <meta charset="UT

$ curl -sS -m 10 -k https://129.226.203.243/app.js -w 'type=%{content_type}'
code=200 type=text/html bytes=751
```

The 200s are misleading: the content type is `text/html` and the body is the NEMOS
`index.html` SPA fallback. No JavaScript was served. `/app.js` does not exist for
BOMB RUSH on this host.

`grep -ci bomb` against both the :443 root and the :3000 root returns **0 matches** —
no BOMB RUSH content is served anywhere reachable.

### 6–7. API and Socket.IO

```
$ curl -sS -m 10 -o /dev/null -w '%{http_code}' http://129.226.203.243/api/
404
$ curl -sS -m 10 -k -o /dev/null -w '%{http_code}' https://129.226.203.243/api/
404
$ curl -sS -m 10 -o /dev/null -w '%{http_code}' 'http://129.226.203.243/socket.io/?EIO=4&transport=polling'
404
$ curl -sS -m 10 -k -o /dev/null -w '%{http_code}' 'https://129.226.203.243/socket.io/?EIO=4&transport=polling'
200
$ curl -sS -m 10 -o /dev/null -w '%{http_code}' http://129.226.203.243:3000/api/rooms
404
```

The nginx config in `setup.sh` proxies `/api/` and `/socket.io/` to `127.0.0.1:3000`.
Neither route reaches a BOMB RUSH server: `/api/` is 404 everywhere, and the
`/socket.io/` 200 on :443/:3000 belongs to the NEMOS stack.

### 8. `/health`

```
$ curl -sS -m 10 -o /dev/null -w '%{http_code}' http://129.226.203.243/health
404
$ curl -sS -m 10 -o /dev/null -w '%{http_code}' http://129.226.203.243:3000/health
200
$ curl -sS -m 10 http://129.226.203.243:3000/health | head -3
<!doctype html>
<html lang="en">
  ...<title>NEMOS | Revenue Based Financing untuk UMKM</title>
```

`/health` is 404 over the port-80 path the nginx config defines. The 200 on :3000 is
the SPA fallback (HTML), not a Fastify JSON health check.

### 9. Settlement (chain module) — not verifiable remotely

No endpoint exposes whether `SERVER_SETTLER_PRIVATE_KEY` is set, and `/health` (the one
route that would report it) is not reachable for this app. Per `setup.sh` lines 127–129,
the default when no `/tmp/bomb-deploy.env` is staged is:

```
chain module DISABLED (no settler key) — settlement will be skipped
```

Status: **UNKNOWN / presumed DISABLED**. Confirming it requires reading
`/opt/bomb-rush/.env` on the host, which this smoke test deliberately did not do.

---

## What this means

1. **DNS is the first blocker.** `bombbrush.my.id` does not exist — not "propagating",
   but absent. Public resolvers return NXDOMAIN and the `sumopod` nameserver returns
   REFUSED. There is no A record to propagate. The record must be created at the
   registrar / DNS provider and the zone delegated before anything else matters.
2. **`129.226.203.243` is the wrong host, or is already occupied.** It is running a
   production NEMOS stack (nginx 1.24 serving `nemos.web.id` on :443, nginx 1.31.5 on
   :3000, NVIDIA NIM AI microservice). BOMB RUSH's `setup.sh` would have replaced
   `/etc/nginx/sites-enabled/default` and bound :3000 — neither happened, and nothing
   BOMB RUSH-related is served. Deploying here as-is would collide with a live service.
3. **`setup.sh` has not been run on this host.** The failure modes above are all
   "never executed", not "executed and broke": no `bomb-rush` server block on :80, no
   Fastify JSON on :3000, no BOMB RUSH static docroot.

## Suggested next steps (not performed)

- Create the DNS zone/records for `bombbrush.my.id` and delegate to `ns1.sumopod.com`;
  verify with `nslookup -type=ns bombbrush.my.id 8.8.8.8` before proceeding.
- Confirm with the VPS owner that `129.226.203.243` is intended for BOMB RUSH — it is
  currently live-serving NEMOS. If so, provision a different host, or coordinate
  port/vhost changes so both can coexist (`bomb-rush` needs :3000 and the `server_name`).
- Once on the right host, run `DOMAIN=bombbrush.my.id REPO_URL=<repo> sudo bash setup.sh`
  and re-run the commands in this document.

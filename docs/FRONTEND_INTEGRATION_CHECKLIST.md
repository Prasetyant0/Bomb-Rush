# FRONTEND_INTEGRATION_CHECKLIST.md — dev A/C integration guide

**Tanggal:** 24 Oktober 2026 · **Status backend:** v0.3.2, 43/43 tests, smoke E2E penuh hijau.
**Semua field/event di bawah diverifikasi terhadap kode, bukan ditebak.** Pelengkap: `docs/BACKEND_INTEGRATION.md` (ringkasan), `API_CONTRACT.md` (spesifikasi v0.3), `docs/BACKEND_AUDIT.md` (risiko).

## 0. Cepat mulai

```powershell
npm install
npm run dev --workspace @bomb-rush/server     # server di http://localhost:3000
# smoke E2E tanpa frontend (butuh server jalan):
npx tsx test/frontend-smoke.ts                # atau set SMOKE_URL=http://127.0.0.1:3000
```

## 1. HTTP endpoints — persis seperti kode

| # | Method/Path | Body request | Response 2xx | Errors |
|---|---|---|---|---|
| H1 | `GET /health` | — | `{ok:true, version:"0.3.1", time, rules:"bomb-rush-v0.3"}` | — |
| H2 | `GET /api/rooms?status=WAITING` | — | `{rooms:[{roomId, code, status, players, maxPlayers, allowDemoBot, virtualDemoEntryWei, visibility}]}` — **PUBLIC saja** | 400 BAD_PAYLOAD bila query aneh |
| H3 | `POST /api/rooms` | `{visibility?:"PUBLIC"\|"PRIVATE", virtualDemoEntryWei: wei-string 1e16–1e19, allowDemoBot?:bool}` | 201 `{roomId, code, participantId, sessionToken, status:"WAITING", visibility, hostSessionId}` | 400 BAD_PAYLOAD (detail array) |
| H4 | `POST /api/rooms/:roomId/join` | `{kind?: "HUMAN"\|"DEMO_BOT"}` | 200 `{participantId, sessionToken, room: RoomPublicState}` | 403 ROOM_FULL · 409 ROOM_NOT_JOINABLE (status≠WAITING/id tak ada) |
| H5 | `GET /api/rooms/:roomId` | — | `{room: RoomPublicState}` | 404 ROOM_NOT_JOINABLE |
| H6 | `POST /api/rooms/:roomId/cancel` | `{participantId, sessionToken}` (host keduanya) | 200 `{canceled:true}` → status CANCELED. | 400 BAD_PAYLOAD · 403 NOT_HOST (id/tokon salah) · 409 BAD_STATE (sudah LIVE) |
| H7 | `GET /api/matches/:matchId/result` | — | `{matchId, status:"FINISHED", winnerId, virtualPool, chainRecord:{state:"PENDING", explorerUrl:null}}` | 404 BAD_STATE |

**Catatan host cancel:** butuh KEDUA `participantId` host + `sessionToken` host (kduanya dikembalikan di H3). participantId saja = 400/403 (audit fix).

`RoomPublicState` (exact): `{roomId, code, status: 'WAITING'|'COUNTDOWN'|'LIVE'|'FINISHED'|'CANCELED'|'ABORTED', minPlayers:3, maxPlayers:4, virtualDemoEntryWei: string, allowDemoBot: bool, startAtMs: number|null, participants: [{participantId, ready, kind:'HUMAN'|'DEMO_BOT'}]}`.

## 2. Socket.IO — persis seperti kode

**Koneksi:** `io('http://localhost:3000', { auth: { eventVersion: '0.3' } })`. Versi lain → `game:error {code:'PROTOCOL_VERSION_MISMATCH'}` lalu server memutus koneksi. Tidak ada ack-acknowledged event (fire-and-forget).

Client → server (semua tervalidasi; RATE_LIMITED bila spam; budget keyed participant-id, TIDAK reset via reconnect):

| Event | Payload persis | Error khas |
|---|---|---|
| `room:subscribe` | `{roomId: uuid, sessionToken: string≤128}` bila `readyLimiter` ok; 1 socket/participant | `SUBSCRIBE_AUTH_FAILED` (token salah/room salah/socket dobel) |
| `room:set_ready` | `{ready: boolean}` | `NOT_IN_ROOM` (belum subscribe), `BAD_STATE` (bukan WAITING) |
| `player:input` | `{sequence: int≥0 strictly rising, moveX∈[-1,1], moveZ∈[-1,1], sprint: bool}` — `.strict()` (field ekstra ditolak) | senyap (silently dropped) bila malformed/早/limit |
| `bomb:pass_intent` | `{sequence: int}` `.strict()` | `NOT_BOMB_HOLDER` · `NO_PASS_TARGET` · `PASS_COOLDOWN` · `NOT_IN_ROOM` |
| `match:request_snapshot` | `{matchId: uuid}` | `NOT_IN_ROOM` (bukan match room-mu) |

Server → client:

| Event | Payload persis | Kapan |
|---|---|---|
| `room:state` | `RoomPublicState` | subscribe any, siap toggle, disconnect, countdown cancel, dll. |
| `room:countdown` | `{startAtMs, serverTimeMs}` | HOST ready yang terakhir memicu broadcast ke semua |
| `match:started` | `{matchId: uuid, startedAtMs}` | quorum valid di end countdown (15 s) |
| `match:snapshot` | `{matchId, tick, serverTimeMs, players:[{participantId, kind, position:{x,y,z}, velocity:{x,z}=0, facingYaw, alive, stamina, isSprinting, disconnected}], bombHolderId, bombExpiresAtMs, livingCount, status}` | ~10 Hz selama LIVE + subscribe LIVE + setelah pass |
| `bomb:pass_accepted` | `{fromId, toId, tick}` | valid pass |
| `match:event` | `{type:'ELIMINATE'\|'RECONNECT', actorId?, tick}` | eliminasi holder; saat FINISHED (RECONNECT, kosong actorId) |
| `match:finished` | `{matchId, winnerId, resultHash:'0xplaceholder'}` | single survivor (HANYA jika ada winner; ABORTED tidak kirim ini) |
| `room:state` juga terkirim tanpa `room:finished` bila ABORTED/CANCELED (status field mengubah UI) | | |
| `game:error` | `{code, message}` | semua kondisi bermasalah (lihat §3) |

## 3. Error codes lengkap (dibaca dari `packages/shared/src/index.ts` ERROR_CODES)

`PROTOCOL_VERSION_MISMATCH`, `SUBSCRIBE_AUTH_FAILED`, `NOT_IN_ROOM`, `ROOM_FULL`, `ROOM_ALREADY_STARTED`, `ROOM_NOT_JOINABLE`, `NOT_HOST`, `BAD_STATE`, `BAD_PAYLOAD`, `RATE_LIMITED`, `NOT_BOMB_HOLDER`, `NO_PASS_TARGET`, `PASS_COOLDOWN`, `PASS_LOCKBACK`. `ALREADY_READY` didefinisikan tapi tidak diterapkan saat ini — jangan tangani.

## 4. Identitas & reconnect — persis seperti kode

- **Dapatkan identity:** `H3` untuk host / `H4` untuk joiner → `(participantId, sessionToken)` — persisted di browser `sessionStorage` (server in-memory; hilang saat process restart).
- **Subscribe:** pakai `room:subscribe`; server match token via internal map, jangan hardcode `participantId` client — server ambil dari token.
- **Reconnect:** disconnect socket → server Graphics `store.disconnect` pada participant; seat LIVE bertahan 3 s (`RECONNECT_GRACE_MS`) lalu eliminasi otomatis; seat lobby langsung bebas. Subscribe ulang dengan token sama + `match:request_snapshot` → kembali LIVE.
- **1 socket per participant**: koneksi kedua dengan sesi aktif → `SUBSCRIBE_AUTH_FAILED: 'Another connection is already active for this participant.'`. Stale socket (dropped w/o disconnect event) di-evict otomatis saat subscribe ulang.
- **Rate limit budget keyed participantId** — reconnect tidak me-reset; share `room:subscribe`⇔`room:set_ready` budget.

## 5. Field-by-field Access matrix

| Field | Siapa melihat | Catatan |
|---|---|---|
| `sessionToken` | HANYA participant itu sendiri (via REST response, bukan broadcast) | jangan pernah render/log |
| `hostSessionId` | host (H3 response) | gunakan dalam cancel auth; tidak dipakai lagi oleh server |
| `participants[].ready/kind` | semua public (room:state) | by API_CONTRACT design |
| `players[].position/stamina/...` | semua dalam room (match:snapshot broadcast) | server-authoritative; TIDAK ada privat field per-player |
| `bombExpiresAtMs`, `bombHolderId` | semua dalam room | timer authoritative |
| chain state | public via H7 | `chainRecord.state === 'PENDING'` = belum on-chain, jangan tampilkan "confirmed" |

## 6. Game loop alur (persis implementasi)

1. **Create (H3)** → simpan tokens → **subscribe** semua.
2. **Join (H4)** hingga `roomState.players.length >= 3` (maks 4). Room FULL → 403 ROOM_FULL.
3. **Ready (set_ready true)** per klien; saat √3 all-ready → `room:countdown {startAtMs}` (15 s).
4. Quorum hilang di mid-countdown → `room:state` WAITING (ready reset false, per SYS).
5. 15 s lewat + quorum valid → `match:started` + snapshot segera LIVE.
6. **In-game:** kirim `player:input` 20 kali/dtk; server-authoritative movement: dt ≤ 2s per tick, speed walk 4.5 / sprint 7.0, stamina 5 bar (drain 1/s saat sprint+move; regen 1.5 s delay lalu 1/s; at 0: walk).
7. **Pass:** server pilih target terdekat ≤1.8 unit; cooldown 0.7 s; anti-return 1 s; TIDAK reset bomb (10 s terus).
8. **Explosion 10 s** → `match:event ELIMINATE` + snapshot `alive:false`; bila pasaran besar, cycle baru mulai otomatis.
9. **Winner:** satu loket sisanya → `match:finished` + `room:state FINISHED`; result via `H7` (PENDING chain).
10. **Disconnect:** lobby = seat bebas; LIVE = 3-s grace; reconnect subscribe ulang.

## 7. Yang TIDAK dilakukan client (server-reject / silent-drop)

- Tidak menentukan target pass, winner, spawn posisi, stamina, timer, chain state, participantId.
- Tidak memutasi `matchSnapshot` objects untuk mengubah game state (copies are non-authoritative).
- Tidak meng-churn `room:subscribe` (share budget dengan set_ready; churn = RATE_LIMITED).
- Tidak mengasumsikan pass sukses sebelum `bomb:pass_accepted` (animasi lokal ≠ state).

## 8. Verification status (jujur)

**Verified in automated tests (43 vitest, hijau):**
- Semua constants murni = TRD §13 (walk 4.5, sprint 7.0, stamina 5/1/1.5/1, bomb 10 s, pass 1.8/0.7/1, grace 3 s, arena 10).
- Movement authority: dt-clamp 2 s anti-teleport, diagonal clamp GS-04, sprint cap GS-10 (exact 7.0).
- Pass: cooldown, anti-return, no-reset-of-timer, nearest-target, nearest-and-eliminated rejected.
- Explosion: single-winner, no fabricated winner (ABORTED), explode-after-FINISHED no-op.
- Room lifecycle: 3–4 seat, join ditolak saat COUNTDOWN/FULL, ready→COUNTDOWN, quorum-loss batal (bukan paksa mulai), 10-min expiry, host-only cancel (token+id), double game-end idempotent.
- Rate limits & auth: budget participant-keyed, socket dobel rejected, token salah rejected, private rooms di-exclude public listing, cancel butuh token.
- REST contracts: H1–H7 surface shape (fastify inject).

**Verified through HTTP/Socket.IO smoke tests (test/frontend-smoke.ts, 100% pass, real 15 s countdown):**
- Full round: create→join 3→subscribe→ready→countdown→match:started→snapshot agreement→NOT_BOMB_HOLDER rejection→valid pass via converging inputs→disconnect+rejoin into LIVE seat→bomb cycles→`match:finished` semua klien setuju winner→H7 result agrees + chainRecord PENDING.

**Requires real frontend verification** (backend cannot emulate):
- Render & interpolation 60 FPS, kamera third-person, multitouch joystick+swipe, RENDER visual bomb/stamina.
- `match:snapshot` posisi digunakan untuk RENDER, bukan untuk logika client.
- UX pembuka wallet / reconnect banner / rotate prompt — tidak bisa diuji server-side.
- Safari/iOS web socket stability (polling fallback vs websocket).

**Requires production configuration (belum berubah sejak audit, dipakai oleh user):**
- `ALLOWED_ORIGINS` env untuk REST + socket cors (dev default allow-all). Atur sebelum deploy publik — sudah terkode di `index.ts`/`cors.ts` tapi nilainya belum dikonfigurasi.
- HTTPS + secure websocket via reverse proxy (implementasi infra).
- Restore-after-restartPublic data: id in-memory hilang saat restart; datachain nya `PENDING` permanen hingga cuplikan blockchain adapter (besok).
- `resultHash` in `match:finished` masih `'0xplaceholder'` — JANGAN render sebagai tx hash sampai recorder hidup; tampilkan text "hash menyusul".
- Tidak ada rate limit per-IP (harga: MVP guest-only) dan tidak ada anti-abuse deposit spesifik; terakui di BACKEND_AUDIT §risiko.

## 9. Setelah testnet tersedia — ruang tunggu

- Chain recorder implementasi akan menambahkan `chain:status` events (S→C) dan mengisi `chainRecord` dan `resultHash`. Frontend hanya menunggu event `chain:status` ini — tidak perlu perubahan kontrak di sisi klien.

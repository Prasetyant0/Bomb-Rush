# BACKEND_AUDIT.md — Verifikasi & Hardening backend BOMB RUSH 3D

**Tanggal:** 24 Oktober 2026 · **Ruang lingkup:** review kode saham sebelum integrasi frontend.
**Basis:** baca ulang seluruh source (`apps/server`, `packages/shared`), bandingkan ke API_CONTRACT/SYS/DECISIONS/GAMEPLAY_CONTROLS/QA_CROSSPLAY Tanpa menambah Postgres/chain/fitur.

## Commands yang benar-benar dijalankan (hasil asli)

| Command | Hasil |
|---|---|
| `npm run typecheck --workspaces` | exit 0 (awal & akhir) |
| `npm test --workspace @bomb-rush/server` | 17/17 awal → **40/40** akhir, 3× berulang stabil |
| `npm run build --workspace @bomb-rush/server` | exit 0 |
| Smoke: `node dist/index.js` + GET /health + POST rooms + POST cancel + GET list | HEALTH ok; CREATE 201; CANCEL(host) 200 `{canceled:true}`; LIST menunjukkan status CANCELED (host-cancel path valid ke produksi) |
| Git status | `not a git repository` — folder belum di-init; tidak ada perubah­an yang bisa terhapus; dokumen v0.3 utuh |

---

## Verified (cocok dengan dokumen)

1. **Constants** = TRD §13 satu-satu (walk 4.5, sprint 7.0, stamina 5/1/1.5/1, bomb 10 s, pass 1.8/0.7/1.0, countdown 15 s, grace 3 s, room 10 min, arena radius 10, tick 20 Hz).
2. **Room status** 6 satuan = API_CONTRACT §1 (FUNDING/REFUND/SETTLEMENT ditahan P2).
3. **REST** semua endpoint API_CONTRACT §2: `/health`, list rooms (WAITING filter), create, join, get room, cancel, match result. Payload shape sesuai.
4. **Socket events** 5 C→S + 8 S→C persis API_CONTRACT §3/§4, semua payload tervalidasi Zod `.strict()` pada `player:input`/`pass_intent`.
5. **Movement authority** (API_CONTRACT §3 + GS-01..04): server clamp |v|≤1, drain sprint hanya saat sprint+stamina>0+bergerak, regen 1.5 s delay + 1/s, teleport dt clamp 2 s, speed = eksklusif konstanta server; TEST baru membuktikan dist = 7.0 exact untuk 1 s sprint, dan (1,1) diagonal → 4.5 bukan 6.36.
6. **Bomb pass**: passBomb validasi holder (identitas dari session server), cooldown global, anti-return target-lama 1 s, deadline tidak reset saat pass.
7. **Explosion & winner**: holder Eliminati; 1 survivor → FINISHED 1×; 0 survivor → ABORTED tanpa winner; explode setelah FINISHED no-op (idempotent) — reg-ex tests.
8. **Lobby quorum**: countdown cancel saat ≤2/lepas ready/leave; tidak pernah force start; joins ditolak saat COUNTDOWN + FULL; bot gating ≥2 human.
9. **Socket identity**: token = partisipan binding di-build server-side; salah token → SUBSCRIBE_AUTH_FAILED; socket kedua per partisipan ditolak (SYS §5); pemilihan `participantId` oleh client TIDAK mungkin (token→participantId mapping reveal di server saja).
10. **Error codes**: konsisten API_CONTRACT; tidak ada stack trace atau field internal yang dikirim (msg statis).
11. **Match result API**: hanya FINISHED yang punya result; `chainRecord` selalu PENDING/null explorer (jujur, tidak meng-klaim tx).
12. **No 主chain/wallet/DB dependency** untuk run: hanya Node 22, in-memory room.

## Confirmed bug → fix diterapkan (regression test ditambahkan)

1. **Ghost rooms di lobby** — peserta disconnect socket di WAITING/COUNTDOWN tidak pernah dihapus; `hardKick` menyetel `connected=false` pada yang sudah false (no-op). Sekarang lobby disconnect drop participant (quorum logic tetap); room kosong → CANCELED; LIVE disconnect tetap grace-eliminasi. *Test: `audit-regression` lobby-disconnect, lapsed-empty-room.*
2. **Reconnect tidak mengembalikan status koneksi** — `onReconnect` domain dipanggil dari store tapi tidak ada socket adapter path yang memanggilnya; bahkan `reconnect()` store di-expose dan tidak digunakan. Bahaya: peserta reconnect via subscribe baru tidak memulihkan `connected=true`, grace berjalan → eliminasi palsu. **Peredress:** `room:subscribe` yang sah sekarang mengembalikan seat via `sessions.authenticate` → `store.disconnect` saat habis — reconnect path tested via subscribe pada integration test (klien asli re-subscribe memungkinkan; grace tidak jika mereka balik dalam 3 s). *Semua test mengecek `onReconnect` di domain; socket flow path = subscribe (dipakai).*
3. **Host cancel mustahil via REST** — cancel butuh `hostSessionId` yang tidak pernah dikembalikan ke client. Sekarang create mengembalikan `hostSessionId` + cancel memvalidasi `participantId` vs `room.hostParticipantId`. *Test: rest.routes cancel (403 stranger → 200 host).*
4. **Snapshot aliasing** — `matchSnapshot` dikirim referensi posisi LIVE per partisipan; mutasi snapshot object merusak authority (socket serializer tidak mutasi, tapi API contract-nya rapuh). Sekarang coordinate disalin. *Test: audit-regression snapshot.* `serverTimeMs` juga `Date.now()` hard-coded — sekarang menerima `Clock` injection (store passes dep).
5. **Rate limit bypass via reconnect** — semua bucket keyed pada `socket.id`; drop+new socket = bucket baru. Sekarang keyed pada `participantId` dari session; `room:subscribe` juga berbagi bucket dengan `set_ready`, menghentikan subscribe churn. *Noted: bucket lifetime masih in-memory per server, per-IP not attempted (MVP appropriate).*
6. **VISIBILITY breach** — `listRooms` memaparkan SEMUA room (termasuk PRIVATE) ke browser; API_CONTRACT menspesifikasikan public summary saja. Sekarang GET /api/rooms memfilter `visibility=PUBLIC`. *Test: rest.routes private-excluded.*
7. **finishRoom removed from flow** — `RoomStore.finishRoom`/`endedMatches` set pernah ditulis tapi live-loop tidak memanggil match-end guard; double game-end in-memory guard sekarang lebih jelas: loop case default untuk jangkar status final (`endedAtMs`), plus domain-level idempotency tested (explode-setelah-FINISHED = no-op ×2). *Tests: audit-regression double game-end; sweep after 30 s.*
8. **`joinRoom` store result condition** — `'errors' in res && res.errors.length > 0 && !('sessionToken' in res)` bisa pass-through ke `res as {...}` setelah error jika TS narrowing off — sekarang bercabang bersih `if (!('sessionToken' in res))`. (Runtime akhirnya baik sebab errors selalu return-first, tapi tipe/cast-nya menyesatkan.)
9. **Expiration CANCELED tidak berhenti di COUNTDOWN** — `maybeExpire`/loop meng-handle WAITING only; countdown room hidup melewati expired 10 min. Sekarang kedua statuslobby expire. *Test: rest + domain around expiry.*

## Potential bug (diperbaiki atau documented, tanpa regression test)

1. **`subscribe` domain function tidak dipakai adapter** — net/session `authenticate` melakukan pekerjaan yang sama langsung. Dead code + risk of divergence. Ditandai `ponytail:` remove at cleanup.
2. **`tokenFor` in `reconnect` store path** not exercised (store.reconnect is dead code too). Ditandai sama.
3. **Rate limiter `lastTick` via Date.now()** — tokens refill even when clock is injected slow; harmless (limits are heuristic).

## Not tested (dari daftar tugas §3)

- **Dua pass bersamaan lintas klien nyata** (dalam event-loop hanya dilakukan via pass-idempotency test; socket integration menguji pass serialize implicit — hanya satu broadcast yang terlihat).
- **Host disconnect mid-match dengan 3 humans + reconnect in grace** (domain tested; full socket multi-client disconnect cycle belum).
- **`chain:status` events** — selalu PENDING oleh design P0; adapter belum ada (blocked by environment, testnet besok).
- **Postgres/Drizzle persistence** — tidak ditambah, sesuai batasan.

## Blocked by environment

1. **Monad testnet (10143)** — belum tersedia; chain recorder/adapter adalah placeholder yang di-dokumentasikan.
2. **Postgres** — tidak di-install; engine tetap dapat diuji tanpa DB (sudah terbukti seluruh suite).

## Risiko terbuka (dipertahankan, tidak disembunyikan)

- **Private cancel via raw participantId**: siapa pun yang mengetahui participantId host bisa cancel. MVP-guest-model; cancel saya anggap low-stakes (PRD FR-08) tapi flutter prod harus menautkan dari session header/token. Di-dokumentasi di BACKEND_INTEGRATION.
- **room:state broadcast leaks participants' read/ kind field** (tanpa token) — dirancang untuk lobby screens, tidak berisi data privat → ok per API_CONTRACT RoomPublicState.
- **RoomStore loop adalah satu-titik-failure** — single process dasar; sharding didefer (per DECISIONS).
- **Bot**: kind gating ok, tapi bot AI tidak ada (stub), tidak ada seed commitment.
- **CORS**: `origin: true` semua asal diizinkan — dev-menyenangkan; prod-gate perlu env list (dipisahkan: `PROD_ORIGIN` tidak dikode; tiinggal untuk deploy tomorrow).

## Verdict siap integrasi frontend besok?

**Ya** untuk P0 virtual-point mode dengan `docs/BACKEND_INTEGRATION.md` sebagai kontrak: create/join/ready/countdown/live/pass/eliminate/reconnect sudah end-to-end diuji melalui transport nyata; chain status jujur PENDING. Risklist di atas harus dibaca Dev C sebelum deploy publik.

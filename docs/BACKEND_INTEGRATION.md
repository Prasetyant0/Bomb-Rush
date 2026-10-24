# BACKEND_INTEGRATION.md — untuk tim frontend (Dev A / Dev C)

Backend berjalan lokal di `http://localhost:3000` (`npm run dev --workspace @bomb-rush/server`). Semua nilai aturan ada di `packages/shared/src/index.ts` (import dari `@bomb-rush/shared`). Semua event ATURANNYA — jangan membaca dokumen lain untuk payload.

## 1. Alur singkat

1. `POST /api/rooms` `{visibility: "PUBLIC"|"PRIVATE", virtualDemoEntryWei, allowDemoBot}` → `{roomId, code, participantId, sessionToken, status, visibility, hostSessionId}`. Simpan `participantId` + `sessionToken` di `sessionStorage`.
2. Teman join: `POST /api/rooms/:roomId/join` `{kind:"HUMAN"}` → `{participantId, sessionToken}`. Room penuh → 403 `ROOM_FULL`.
3. Socket.IO: `io(url, { auth: { eventVersion: "0.3" } })` — versi lain ditolak dengan `game:error PROTOCOL_VERSION_MISMATCH`.
4. `room:subscribe {roomId, sessionToken}` → insid `room:state` (broadcast ke seluruh room) + `match:snapshot` jika MATCH LIVE. Token salah → `SUBSCRIBE_AUTH_FAILED`.
5. Lobby: `room:set_ready {ready}`. ≥3 ready semua → server memulai COUNTDOWN 15 s: broadcast `room:countdown {startAtMs, serverTimeMs}`. Quorum hilang → `room:state` kembali ke WAITING; countdown tidak dipaksa jalan.
6. Countdown selesai → `match:started {matchId, startedAtMs}`, lalu `match:snapshot` ±10 Hz + `room:state` LIVE.
7. In-game: `player:input {sequence, moveX, moveZ, sprint}` 20–30/s (sequence naik ketat; server clamp |v|≤1, menolak sprint saat stamina 0); pass: `bomb:pass_intent {sequence}` (tanpa target, server pilih nearest ≤1.8 u; cooldown 0.7 s; anti-return 1 s). Server membalas dengan `bomb:pass_accepted` / `match:event ELIMINATE` / `match:finished {matchId, winnerId, resultHash}`.
8. Reconnect: `room:subscribe` ulang memakai token LAMA — seat bertahan; grace 3 s saat LIVE sebelum eliminasi otomatis. Hampir selalu tak perlu event baru.
9. `GET /api/matches/:matchId/result` → `{matchId, status, winnerId, virtualPool, chainRecord:{state:"PENDING", explorerUrl:null}}`. `chainRecord` PENDING sampai chain recorder benar implementasi; JANGAN menampilkan 'confirmed' untuk PENDING.
10. Cancel by host: `POST /api/rooms/:roomId/cancel {participantId}` — hanya `room.hostParticipantId` (dikembalikan di create sebagai `participantId`) yang boleh; lain → 403 NOT_HOST.

## 2. Events

Client → server (semua Zod tervalidasi; RATE_LIMITED bila spam; rate limit keyed per participant — reconnect TIDAK me-reset budget):

| Event | Payload |
|---|---|
| `room:subscribe` | `{roomId: uuid, sessionToken}` (share budget dgn `set_ready`; jangan churn) |
| `room:set_ready` | `{ready: boolean}` |
| `player:input` | `{sequence: int ≥0, moveX: [-1,1], moveZ: [-1,1], sprint: bool}` (malformed di-drop senyap) |
| `bomb:pass_intent` | `{sequence: int ≥0}` |
| `match:request_snapshot` | `{matchId: uuid}` |

Server → client:

| Event | Payload | Catatan |
|---|---|---|
| `room:state` | `RoomPublicState` | broadcast setiap perubahan lobby, termasuk `participants[] {participantId, ready, kind}` |
| `room:countdown` | `{startAtMs, serverTimeMs}` | hitung mundur lokal dari startAtMs |
| `match:started` | `{matchId, startedAtMs}` | |
| `match:snapshot` | `MatchSnapshot` (+`status`) | ±10 Hz; posisi berasal dari objek server baru (client tak boleh memutasi) |
| `bomb:pass_accepted` | `{fromId, toId, tick}` | timer 10 s TIDAK reset |
| `match:event` | `{type:'ELIMINATE'|'RECONNECT', actorId?, tick}` | |
| `match:finished` | `{matchId, winnerId, resultHash}` | resultHash placeholder P0 |
| `game:error` | `{code, message}` | lihat di bawah |

## 3. Error codes (game:error / REST body error)

`PROTOCOL_VERSION_MISMATCH, SUBSCRIBE_AUTH_FAILED, NOT_IN_ROOM, ROOM_FULL, ROOM_ALREADY_STARTED, ROOM_NOT_JOINABLE, NOT_HOST, BAD_STATE, BAD_PAYLOAD, RATE_LIMITED, NOT_BOMB_HOLDER, NO_TARGET(=NO_PASS_TARGET), PASS_COOLDOWN, PASS_LOCKBACK`. REST: 403 ROOM_FULL/NOT_HOST, 409 ROOM_NOT_JOINABLE/ROOM_ALREADY_STARTED, 400 BAD_PAYLOAD, 404 tidak ditemukan.

## 4. Identitas & reconnect

- Identitas HANYA pasangan `(participantId, sessionToken)` yang di-mint server. Client tidak memilih participantId.
- 1 participant = 1 koneksi aktif. Koneksi kedua → `SUBSCRIBE_AUTH_FAILED: 'Another connection is already active...'`. Stale socket (sudah tidak hidup di server) otomatis di-evict saat subscribe ulang.
- Token TIDAK expire selama server hidup; hilang saat proses restart (in-memory). Frontend harus punya fallback "session expired → kembali ke /rooms".
- Disconnect LIVE: seat bertahan 3 s (RECONNECT_GRACE_MS) lalu eliminasi otomatis; lobby: seat langsung bebas.

## 5. Yang TIDAK boleh dilakukan client

Menentukan target pass/winner/stamina/bomb-holder; memutasi snapshot untuk mengubah state; menyakiti rate-limit dengan reconnect churn ( бюджет participant-keyed); asumsikan animasi pass sukses sebelum `bomb:pass_accepted`.

## 6. Status platform & sisa risiko (jujur)

- Postgres/Drizzle: belum. Monad testnet: belum dipanggil; `chainRecord` selalu PENDING. Kill: room state in-memory hilang saat restart.
- `resultHash` untuk `match:finished` adalah string placeholder `'0xplaceholder'` sampai chain recorder hidup — tampilkan sebagai "hash menyusul", jangan display sebagai tx.
- CORS saat ini allow-all (dev). Sebelum deploy publik: tambah origin list env (belum oktet hardcode).
- List audit penuh + residual risks: `docs/BACKEND_AUDIT.md` (termasuk `NOT_BOMB_HOLDER` vs `NO_PASS_TARGET` mapping).

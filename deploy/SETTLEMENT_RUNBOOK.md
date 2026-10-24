# Settlement Runbook — enabling the on-chain settler

Status as of 2026-10-24: **chain module disabled in production.** The game runs,
the contract is deployed and healthy, but no match is ever settled on chain.

This document was produced by remote, read-only verification. Nothing here was
executed against the server. No private key was read, printed, or transmitted.

- Service: `bomb-rush` (systemd), Fastify + Socket.IO on `127.0.0.1:3200`
- VPS: `129.226.203.243`, nginx in front (`/api`, `/health`, `/socket.io` proxied)
- Domain: `https://bombrush.my.id`
- Escrow: `0x8c839fab937a08177c2779eef36c15d8999be8fe` on Monad Testnet `10143`
- SETTLER address (address only, public): `0x3419163ffE7D12Dc3b08187B3fBC2E622e1D29aD`
- Key material lives **only** at `D:\LOMBA ABYAN\Monad\wallets.local.txt` on the
  operator's machine. Never copy it into this repo, a commit, a log, or a ticket.

---

## 1. What is live right now (verified output)

Raw responses, recorded verbatim.

### `curl -s https://bombrush.my.id/health`

```json
{"ok":true,"version":"bomb-rush-v0.5","time":"2026-10-24T08:55:54.710Z","rules":"bomb-rush-v0.5","chain":{"enabled":false,"detail":"SERVER_SETTLER_PRIVATE_KEY is unset","selfCheck":null}}
```

`chain.selfCheck` is `null` because the self-check block in
`apps/server/src/index.ts:65` only runs when `chain.enabled` is true.

### Static / route status

| Path | HTTP | Content-Type | Bytes |
|---|---|---|---|
| `/` | 200 | `text/html` | 18297 |
| `/app.js` | 200 | `application/javascript` | 53827 |
| `/src/game/sim.js` | 200 | `application/javascript` | 10315 |

Both JS paths return real files (`// BOMB RUSH — single-page flow…` and
`// BOMB RUSH sim — authoritative gameplay engine…`), not the SPA fallback. A
control request to `/src/main.js` returns `404`, confirming nginx is not
masking missing files.

`GET https://bombrush.my.id/api/rooms` → `{"rooms":[]}` (server reachable, no
rooms in memory at the time of the check).

### Contract reads (RPC, no key involved)

```
$ cast code 0x8c839fab937a08177c2779eef36c15d8999be8fe --rpc-url https://testnet-rpc.monad.xyz | head -c 20
0x6080604052600436106

$ cast chain-id --rpc-url https://testnet-rpc.monad.xyz
10143

$ cast call 0x8c839fab937a08177c2779eef36c15d8999be8fe "entryBounds()(uint256,uint256)" --rpc-url https://testnet-rpc.monad.xyz
1000000000000000 [1e15]
10000000000000000 [1e16]

$ cast keccak "SETTLER_ROLE"
0x6666bf5bfee463d10a7fc50448047f8a53b7762d7e28fbc5c643182785f3fd3f

$ cast call 0x8c839fab937a08177c2779eef36c15d8999be8fe "SETTLER_ROLE()(bytes32)" --rpc-url https://testnet-rpc.monad.xyz
0x6666bf5bfee463d10a7fc50448047f8a53b7762d7e28fbc5c643182785f3fd3f

$ cast call 0x8c839fab937a08177c2779eef36c15d8999be8fe "hasRole(bytes32,address)(bool)" \
    0x6666bf5bfee463d10a7fc50448047f8a53b7762d7e28fbc5c643182785f3fd3f \
    0x3419163ffE7D12Dc3b08187B3fBC2E622e1D29aD --rpc-url https://testnet-rpc.monad.xyz
true

$ cast call 0x8c839fab937a08177c2779eef36c15d8999be8fe "hasRole(bytes32,address)(bool)" \
    0x6666bf5bfee463d10a7fc50448047f8a53b7762d7e28fbc5c643182785f3fd3f \
    0xAf836EfF9F9bC39E00576ec4af36053dfeF6ABf2 --rpc-url https://testnet-rpc.monad.xyz
false

$ cast balance 0x3419163ffE7D12Dc3b08187B3fBC2E622e1D29aD --rpc-url https://testnet-rpc.monad.xyz
5000000000000000000        # 5 test-MON, sufficient for settle + payout gas
$ cast nonce 0x3419163ffE7D12Dc3b08187B3fBC2E622e1D29aD --rpc-url https://testnet-rpc.monad.xyz
0                           # key has never sent a transaction
```

`owner()` and `paused()` both revert with empty data — the contract is not
Ownable/Pausable; access is role-based only. That is expected and not a fault.

**Conclusion:** the contract the server is configured to use
(`ESCROW_ADDRESS=0x8c839fab937a08177c2779eef36c15d8999be8fe`, per
`.env.example` and `deploy/setup.sh`) is deployed, live on 10143, and the
settler address already holds `SETTLER_ROLE` with gas funded. The **only**
missing piece is the environment variable on the server.

> Unverified assumption (no SSH was used): the production file is
> `/opt/bomb-rush/.env` owned by `bomb:bomb`, mode 0600, per `deploy/setup.sh`.
> The pre-flight in §2 confirms this before anything is changed.

---

## 2. Pre-flight (run first, changes nothing)

From your Windows machine:

```powershell
ssh root@129.226.203.243 "systemctl is-active bomb-rush; \
  ls -l /opt/bomb-rush/.env; \
  grep -c '^SERVER_SETTLER_PRIVATE_KEY=' /opt/bomb-rush/.env; \
  grep -c '^ESCROW_ADDRESS=0x8c839fab937a08177c2779eef36c15d8999be8fe' /opt/bomb-rush/.env; \
  grep -c '^MONAD_RPC_URL=https://testnet-rpc.monad.xyz' /opt/bomb-rush/.env"
```

Expected: `active`, `-rw------- 1 bomb bomb`, and `1` for each `grep -c`.

`MONAD_RPC_URL` matters: `apps/server/src/chain/config.ts` **throws** when the
key is set but the RPC URL is empty, and `getChainConfig()` runs at module load
(`index.ts:23`). A missing RPC URL turns "chain off" into a crash-restart loop.
Likewise a malformed key (not exactly `0x` + 64 hex chars) throws. The current
`/health` reason proves the key line exists and is empty — it says nothing about
the other two variables, so check them here.

---

## 3. Enable settlement (the step you run; this runbook does not)

The key is staged on the host through stdin so it never appears in shell
history, process argv, or a log file.

### 3a. Stage the key on the host (mode 0600)

Open `D:\LOMBA ABYAN\Monad\wallets.local.txt`, copy **only** the settler entry
for `0x3419163ffE7D12Dc3b08187B3fBC2E622e1D29aD` (not the admin key), then:

```powershell
ssh root@129.226.203.243 "umask 077; cat > /tmp/settler.key; chmod 600 /tmp/settler.key"
```

Paste the key (`0x…`, 66 characters), press Enter, then `Ctrl-D` to close stdin.
Do not echo it back to check; §3b validates it by result.

### 3b. Rewrite `.env`, restart, shred the staged copy

```powershell
ssh root@129.226.203.243 "set -euo pipefail; \
  ENVF=/opt/bomb-rush/.env; \
  cp -a \$ENVF /root/bomb-rush.env.bak.\$(date +%Y%m%d%H%M%S); \
  K=\$(cat /tmp/settler.key) awk '{ \
      if (\$0 ~ /^SERVER_SETTLER_PRIVATE_KEY=/) { print \"SERVER_SETTLER_PRIVATE_KEY=\" ENVIRON[\"K\"]; seen=1; next } \
      { print } \
      END { if (!seen) print \"SERVER_SETTLER_PRIVATE_KEY=\" ENVIRON[\"K\"] } \
    }' \$ENVF > \$ENVF.new; \
  mv \$ENVF.new \$ENVF; \
  chown bomb:bomb \$ENVF; chmod 600 \$ENVF; \
  shred -u /tmp/settler.key 2>/dev/null || rm -f /tmp/settler.key; \
  systemctl restart bomb-rush; sleep 3; systemctl is-active bomb-rush"
```

The key is passed through the environment (`ENVIRON["K"]`), not through awk's
argv. `/proc/PID/environ` is root-only.

Expected last line: `active`.

### 3c. Confirm it took (from your machine)

```powershell
curl.exe -s https://bombrush.my.id/health
```

Success requires **both**:

```json
"chain":{"enabled":true,"detail":"escrow 0x8c839fab937a08177c2779eef36c15d8999be8fe on chain 10143",
         "selfCheck":{"ok":true,"chainId":10143,"hasSettlerRole":true}}
```

- `chain.enabled: true` — the key parsed and the module booted.
- `chain.selfCheck` **not null** — the boot self-check ran. `ok:true` /
  `hasSettlerRole:true` means the configured key really holds `SETTLER_ROLE`.
  `selfCheck:{"ok":false,...}` means the key is valid hex but the wrong key;
  fix it and restart before any funded room is opened.

`selfCheck` is set asynchronously after `listen`, so allow a second or two.

Also check the boot log for one of:

```powershell
ssh root@129.226.203.243 "journalctl -u bomb-rush -n 40 --no-pager | grep -Ei 'chain|settler'"
```

`chain self-check ok` (good) vs `CHAIN SELF-CHECK FAILED` (stop and re-check).

Then a real end-to-end proof: the next match played in a room created with an
on-chain `roomKey` emits a `chain:status` event with a `txHash`, and
`GET /api/matches/<matchId>/result` reports `chainRecord.state: "SETTLED"` with
`escrowStatus: "SETTLED"` instead of `PENDING`/`NONE`.

---

## 4. Roll back

Fastest, exact reversal:

```powershell
ssh root@129.226.203.243 "set -euo pipefail; \
  ENVF=/opt/bomb-rush/.env; \
  sed -i 's|^SERVER_SETTLER_PRIVATE_KEY=.*|SERVER_SETTLER_PRIVATE_KEY=|' \$ENVF; \
  systemctl restart bomb-rush; sleep 3; systemctl is-active bomb-rush"
```

Then:

```powershell
curl.exe -s https://bombrush.my.id/health
```

must return to:

```json
"chain":{"enabled":false,"detail":"SERVER_SETTLER_PRIVATE_KEY is unset","selfCheck":null}
```

A full file restore also works — §3b wrote `/root/bomb-rush.env.bak.<timestamp>`:

```powershell
ssh root@129.226.203.243 "ls -l /root/bomb-rush.env.bak.*"
ssh root@129.226.203.243 "cp -a /root/bomb-rush.env.bak.YYYYMMDDHHMMSS /opt/bomb-rush/.env && \
  chown bomb:bomb /opt/bomb-rush/.env && chmod 600 /opt/bomb-rush/.env && systemctl restart bomb-rush"
```

Rollback is safe at any time: disabling the module stops future settlement but
does not touch funds already settled. Rooms already `FUNDED` and never settled
remain recoverable only through the contract's own cancel/refund path.

Do **not** re-run `deploy/setup.sh` to make this change: it also rewrites
`PORT`/`HOST`, rebuilds, and reinstalls the unit. Edit `.env` and restart.

---

## 5. What settlement does NOT prove

Once enabled, a settled match only records that **the game server asserted a
winner and the escrow contract accepted that assertion**. It is a trusted-oracle
record, not proof of fair play.

- The winner is decided entirely by the off-chain server
  (`apps/server/src/game/domain.ts`). The contract never validates gameplay.
- The `resultHash` is `keccak256(abi.encode("BOMB_RUSH_V05", roomKey, matchId,
  sortedParticipantIds, winner, "0.5"))`, computed by the server
  (`apps/server/src/chain/resultHash.ts`). It is a commitment *by* the settler,
  not evidence that the match was honest. A dishonest server can settle any
  depositor as the winner of any `FUNDED` room.
- `matchId` and `participantIds` come from in-memory server state and are not
  published anywhere. `/api/matches/:id/result` returns `winnerId`,
  `virtualPool` and `roomKey` but not the participant list, so a third party
  cannot currently recompute the hash from published data and check it.
- The contract enforces that the winner is a depositor and that all seats are
  funded (`assertSettleable`, `apps/server/src/chain/escrow.ts`). It does not
  enforce that the winner earned it.
- Settlement does not make room state durable. Rooms are in memory; a restart
  loses them. The escrow contract is the only durable record.
- A failed `payout` leg leaves the prize `CLAIMABLE`, not `PAID`
  (`settlement.ts` emits `CONFIRMED … payoutState:"CLAIMABLE"`). That state is
  honest and needs a permissionless `payout(roomKey)` to finish.
- One hot key holds `SETTLER_ROLE` and can settle any funded room. Compromise of
  that key is compromise of every unsettled pot. `SETTLER_ROLE` is revoked /
  rotated only by the admin key (`0xAf836EfF…`), which is a different address.

---

## 6. What a user experiences today, with the chain off

Read from `apps/server/src/api/routes.ts`, `apps/server/src/game/store.ts`, and
`apps/server/src/net/socketAdapter.ts`.

**`POST /api/rooms` does not require `roomKey`.** In `routes.ts:29-30` both
`hostWalletAddress` and `roomKey` are `.optional()`. `virtualDemoEntryWei` is
required and must be a decimal string in **1e16..1e19 wei** (0.01–10 MON of
virtual credit), `visibility` defaults to `PUBLIC`, `allowDemoBot` to `false`.

With the chain module off, `defaultEscrowGateway()` returns `null`
(`apps/server/src/escrow/gateway.ts`), so `store.createRoom` skips the on-chain
verification block entirely (`store.ts:163-201`).

What that produces:

1. **Normal path (no `roomKey`)** — the browser's demo flow sends only
   `virtualDemoEntryWei` and `allowDemoBot` (`apps/web/app.js:863-864`). The
   server returns `201` with `roomId`, 6-char `code`, `participantId`,
   `sessionToken`, and `roomKey: null`. The room works fully: lobby, join,
   server-authoritative match. `escrowStatus` stays `NONE` forever, so
   `GET /api/matches/:id/result` shows
   `chainRecord: { state: "PENDING", escrowStatus: "NONE", explorerUrl: null }`,
   and matches finish with `resultHash: null` (no roomKey ⇒ no commitment).
   This is exactly what a visitor sees right now.

2. **Unverified `roomKey` path** — if a client sends `roomKey`, it is
   syntactically validated, must be unique across rooms, and must be accompanied
   by a valid `hostWalletAddress`, but with no gateway it is **accepted without
   any chain check** and stored with `escrowStatus: "NONE"` (`store.ts:199-210`).
   The byte-identical response shape means a caller cannot tell a verified key
   from an unverified one except via `escrowStatus`/`result` reads.

3. **Funded path breaks visibly.** The frontend's funded flow
   (`app.js:705`, `createFundedRoom`) connects a wallet, sends a real
   `createRoom` deposit to the contract on chain 10143, then calls
   `POST /api/rooms` with the key (201, unverified), then
   `POST /api/rooms/:roomId/deposit-confirm`. That last call fails with
   `400 {"error":"BAD_STATE","message":"Chain module is disabled; deposits cannot be verified."}`
   (`store.ts:274-277`). The UI shows
   "Deposit terkirim tetapi BELUM terverifikasi server." and moves to the lobby
   with `depositConfirmed:false`. **Real test-MON has left the wallet, the
   server will never settle the room, and no `chain:status` event will ever be
   emitted for it.** Recovery is only via the contract's refund/cancel path
   after the funding deadline. Do not run a funded demo while `/health` says
   `enabled:false`.

4. **Entry-amount mismatch worth knowing.** The contract accepts
   `entryBounds() = 1e15..1e16` wei, but `routes.ts:21` accepts
   `1e16..1e19`. The overlap is exactly `1e16` = 0.01 test-MON — the only entry
   a funded room can use today. The frontend encodes this as
   `SERVER_MIN_ENTRY_WEI = 10n ** 16n` (`app.js:700`). Enabling settlement does
   not change this constraint.

5. **No endpoint currently tells a user the chain is off except `/health`.**
   `chain.enabled` is not in any room or match response, and the frontend only
   renders a chain banner from wallet state, not from `/health`.

### One-line summary

Today `https://bombrush.my.id` is fully playable, but every match is a
server-local scoreboard: rooms have no on-chain identity, results carry a `null`
hash, `/api/matches/:id/result` is permanently `PENDING`, and any attempt to
attach a funded escrow room ends with the deposit confirmed in the wallet and
rejected by the server.

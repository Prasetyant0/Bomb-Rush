# Frontend funded-flow audit

Read-only audit of `apps/web` against the server contract in `apps/server/src/api/routes.ts`
and `contracts/src/TestnetPoolEscrow.sol`. Nothing in the source tree was modified.
Unit-level web3 tests were run and pass (`node apps/web/src/web3/escrow.test.js` → `ALL PASS`);
those cover encoding/decoding only, not the browser flow.

## Verdict table

| # | Question | Verdict | Evidence |
|---|----------|---------|----------|
| 1 | Create path: browser roomKey → `createRoom` (uint64 seconds) → POST `/api/rooms` matching `routes.ts` | **partial** — order, payload and units are right; the server round-trip happens before the create tx is mined | `app.js:716`, `app.js:721-729`, `app.js:733-750`, `escrow.js:119-126`, `routes.ts:12-31`, `store.ts:168-198` |
| 2 | Join path: `joinRoom(roomKey, entryWei)` exactly → POST `{txHash, walletAddress}` to `deposit-confirm`; entryWei from contract | **broken** — the call shape and contract-read amount are right, but the funded-join UI is gated off for exactly the guests who hold a wallet, and is unreachable from normal navigation | `app.js:828`, `app.js:833-838`, `app.js:276-282`, `app.js:223-233`, `app.js:1017-1052`, `escrow.js:129-149` |
| 3 | Amounts are bigint / decimal strings; no float math on wei | **partial** — every value that is signed or POSTed is a bigint or decimal string; two display-only conversions go through `Number` | `app.js:659`, `app.js:790`, `app.js:99-103`, `app.js:721`, `escrow.js:115`, `escrow.js:132-146`, `room.js:97` |
| 4 | Wrong network blocks the deposit | **complete** for writes; reads are unguarded | `app.js:672-687`, `app.js:702`, `app.js:1022`, `escrow.js:91-101`, `app.js:261-273` |
| 5 | No "paid"/"funded" without a verified receipt; no fake explorer link; `resultHash: null` handled | **partial** — no fabricated payment, `resultHash: null` handled honestly, but the result headline bypasses the downgrade projection and the result POOL number contradicts its own unit | `app.js:194-211`, `app.js:242-258`, `app.js:772-788`, `app.js:954-968`, `app.js:899-908`, `escrow.js:261-283` |
| 6 | `?net=0` still runs the local sim; no wallet does not break the demo | **complete** | `net/index.js:42-47`, `app.js:348-356`, `app.js:528-538`, `app.js:629-650` |
| 7 | `computeDeadlines` margin and seconds-vs-ms conversion | **complete** — conversion is correct, but the production create path does not use `computeDeadlines`; it duplicates the logic inline | `escrow.js:59-73`, `escrow.js:221-225`, `app.js:718-729` |

## Detailed findings

### Q1 — Create path

The order is correct and the payload matches the schema.

```js
// app.js:716
const { roomKey } = esc.js.makeRoomKey(addr);
```
```js
// app.js:721-729
const nowSec = BigInt(Math.floor(Date.now() / 1000));
...
const fundingDeadline = nowSec + (540n < fundingCap ? 540n : fundingCap);
let resolutionDeadline = nowSec + (1140n < resolutionCap ? 1140n : resolutionCap);
```
```js
// app.js:744-750
created = await api.createRoom({
  virtualDemoEntryWei: String(amount),
  allowDemoBot: state.bot,
  visibility: "PUBLIC",
  hostWalletAddress: addr,
  roomKey,
});
```

`routes.ts:12-31` accepts exactly these five keys; `virtualDemoEntryWei` must match
`/^[0-9]{1,22}$/` and be `1e16..1e19` — `String(10n ** 16n)` satisfies both.
`roomKey` matches `/^0x[0-9a-fA-F]{64}$/`. `seats` is encoded as uint8 and validated 3–4
(`abi.js:63-76`), deadlines go through `encodeUint64` (`escrow.js:113-127`).

**The break:** `escrow.createRoom` returns as soon as the provider yields a hash, with no
receipt wait:

```js
// escrow.js:119-126
const txHash = await request("eth_sendTransaction", [{ from, to: escrowAddress, value: ..., data }]);
if (!isTxHash(txHash)) throw new Error("BAD_TX_HASH: provider returned " + String(txHash));
return { txHash, roomKey, entryWei: amount };
```

`app.js:733` then immediately POSTs to `/api/rooms`. The server verifies by reading chain
state, not the receipt:

```ts
// store.ts:169-171
const chainRoom = await gateway.readRoom(key as Hex);
if (chainRoom.status === 'NONE') {
  return { errors: [{ code: 'BAD_PAYLOAD', message: 'roomKey does not exist on the escrow contract.' }] };
}
```

`getRoom` on an unmined key returns a zero struct → `status: 'NONE'` → HTTP 400. The POST
happens milliseconds after `eth_sendTransaction`; the block lands later. On a normal wallet,
this fails on the first attempt. The failure path is at least honest: `app.js:754-757` keeps
the roomKey on screen and says the deposit is already on-chain.

### Q2 — Join path

The contract call itself is right — amount read from the chain, exact wei, correct proof:

```js
// app.js:1036-1044
const esc = await ensureEscrow();
const onChain = await esc.readRoom(roomKey);
const entryWei = onChain.entryWei;
if (!entryWei || entryWei <= 0n) throw new Error("ENTRY_MISSING");
const sent = await esc.joinRoom(roomKey, entryWei);
```
```js
// app.js:1046-1049
const res = await fetch(`${serverUrl()}/api/rooms/${encodeURIComponent(roomId)}/deposit-confirm`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ txHash: sent.txHash, walletAddress: addr }),
});
```

`escrow.joinRoom` sends `value: amount` and `data: encodeJoinRoom(roomKey)` (`escrow.js:141-146`),
matching `joinRoom(bytes32)` payable and `msg.value != room.entryWei → WrongValue`
(`TestnetPoolEscrow.sol:189-196`). The POST body matches `routes.ts:120-131`.

**The break is the gate that creates `state.funded` for a guest:**

```js
// app.js:828-838
const res = await api.joinRoom(joinId, "HUMAN", w.getAddress() || null);
...
const me = (res.room?.participants || []).find((p) => p.participantId === res.participantId);
if (state.escrowAddress && roomKey && me && !me.walletAddress) {
  state.funded = { txHash: null, entryWei: null, roomKey, depositConfirmed: false };
  state.netMode = true;
}
```

The join on the line above has just bound the wallet to that seat, so `me.walletAddress` is
truthy for every guest who owns a wallet. The `!me.walletAddress` condition therefore hides
the funded path from the only guests who can deposit. `localSeatUnfunded`, which decides
whether the join button renders, encodes the same inversion:

```js
// app.js:276-282
function localSeatUnfunded() {
  if (!state.funded || state.funded.depositConfirmed) return false;
  ...
  return !me || !me.walletAddress;
}
```

A walletless guest (who cannot deposit) is the one who would see the button.
`app.js:223-233` renders `lbJoinRow` only from `localSeatUnfunded()`.

Two more reachability problems:

- `prepareNetRoom` — the only place that sets the guest's `state.funded` — is called from
  `startNetworkedArena` (`app.js:362`), i.e. only after the guest presses "SKIP KE MATCH"
  and is already in the arena. The join row only exists on the lobby screen, so the guest
  must enter the arena, then press "KELUAR KE LOBI" (`index.html:227`).
- Nothing in the UI produces a shareable `?net=1&room=<roomId>` link. `copy-code`
  (`app.js:1093-1097`) copies the 6-char code, and `room.js:22-24` states room lookup is by
  roomId, not code. A guest cannot reach the join path from a shared link without hand-editing
  the URL, and the link must also carry `?net=1` or `state.netMode` stays false.

### Q3 — Amount handling

Signed/POSTed values are clean:

- presets parse from a decimal string (`app.js:99-103`), not `Number`.
- `entryWei` is `BigInt` (`app.js:654-657`, `app.js:709-710`).
- POST body is `String(amount)` (`app.js:745`) and `room.js:97` rejects anything not a decimal string.
- `escrow.js:115`, `escrow.js:133`, `abi.js:26-31` all coerce with `BigInt` and encode via `toString(16)`.
- `fmtMon` is pure bigint (`app.js:39-45`).
- `entryWei * BigInt(seats)` (`app.js:187`, `app.js:663`, `app.js:906`) stays bigint.

No `parseFloat` anywhere in `apps/web`. Two violations remain, both display-only:

```js
// app.js:659 — BigInt(Math.round(Number(b.dataset.mono) * 1e6)) * 10n ** 12n
```
Float multiply on a MON value to decide which preset chip is highlighted. It never reaches a
transaction, but it is the kind of math the file's own comment (`app.js:99-100`) says to avoid.
Compare against `setEntryWei`'s stored bigint directly instead.

```js
// app.js:790 — state.credits = Number(amount / 10n ** 14n);
```
Wei → demo-credit display. Documented as cosmetic, but it is also the value that later leaks
into the result screen's POOL number (see Q5).

`app.js:112` (`const n = +e.target.value`) and `abi.js:64` (`Number(seats)`) are demo-credit and
seat-count conversions, not wei.

### Q4 — Chain guard

Complete for anything that signs:

```js
// app.js:672-676
const chainOk = w.chainId === MONAD_TESTNET.chainId;
...
const ok = !!addr && chainOk && boundsOk && serverOk && !!state.escrowAddress && !state.creating;
btn.disabled = !ok;
```
```js
// app.js:702
if (w.chainId !== MONAD_TESTNET.chainId) { toast("Chain salah — deposit diblokir."); renderChainBanner(); return; }
```
```js
// app.js:1022
if (w.chainId !== MONAD_TESTNET.chainId) { toast("Chain salah — deposit diblokir."); renderChainBanner(); return; }
```

And the guard does not trust the cached value — every write re-reads `eth_chainId`:

```js
// escrow.js:91-101 assertChain(), called by createRoom (:114) and joinRoom (:130)
const live = typeof hex === "number" ? hex : parseInt(String(hex), 16);
if (live !== chainId) { ... err.code = "CHAIN_MISMATCH"; throw err; }
```

Gap: reads (`readBounds`, `readRoom`, `readDepositors` — `escrow.js:109-111`, `161-184`) never
call `assertChain`, and they go through the wallet provider. On a wrong-chain wallet they are
issued against the wrong chain; an `EMPTY_RETURN` is swallowed by `app.js:269-272`, so the
lobby keeps the previous list. It cannot show a false FUNDED, but it can show a permanent
"UNFUNDED" while the wallet sits on the wrong chain, and the contract-bounds line can be read
from a different deployment at the same address. Read through a fixed Monad RPC or call
`assertChain` first.

### Q5 — Honesty

Good:

- Lobby "FUNDED" comes from the chain depositor list, not the server roster
  (`app.js:242-252`), and unknown reads render "MEMBACA CHAIN…" rather than a guess
  (`app.js:245-248`).
- The lobby explorer link is gated on a server-confirmed deposit:
  `const url = state.funded.depositConfirmed ? explorerTxUrl(dep) : null;` (`app.js:208`).
- `explorerTxUrl` returns null for a non-32-byte hash (`escrow.js:240-243`).
- `resultHash: null` is rendered as a fact, not replaced:
  `"Result not yet recorded on-chain (server mengirim resultHash: null)."` (`app.js:954-956`);
  the server genuinely sends null when it cannot commit (`socketAdapter.ts:204-209`).
- `settlementState` downgrades CONFIRMED-without-a-settle-hash to PENDING (`escrow.js:274`).

Two inconsistencies:

```js
// app.js:936-938 — computed from the RAW server word...
const confirmed = raw === "CONFIRMED";
...
// app.js:968 — ...and used for the headline, bypassing `proj` from settlementState
$("rChain").textContent = failed ? "FAILED" : confirmed ? "CONFIRMED" : settling ? "SETTLING" : "PENDING";
$("rChainSub").textContent = ... confirmed ? "SETTLEMENT TERVERIFIKASI · BELUM DIBAYAR" ...;
```
`proj.state` (the downgraded value) is only consulted for the step list and the note. If the
server ever sends `CONFIRMED` without `txHash`, the headline says verified while the note says
the status was downgraded. Use `proj.state` for both lines.

```js
// app.js:899 and app.js:905-906
$("rPool").textContent = String(r.credits * r.seatCount);
$("rPoolUnit").textContent = verified ? `${fmtMon(state.funded.entryWei * BigInt(r.seatCount))} MON TESTNET · NO REAL VALUE` : ...
```
In a funded match the number is demo credits (`state.credits` was set from wei at
`app.js:790`) while the unit says MON. A 0.01 MON × 3 room renders "300 0.03 MON TESTNET".
The number should be `fmtMon(entryWei * seats)` when `verified`, matching the unit.

Also note `state.chainRecord` / `state.chainTerminal` are never reset between matches
(`app.js:36`, `app.js:447-455`), so a second match can inherit `CONFIRMED` from the first.

### Q6 — Fallback

```js
// net/index.js:42-47 — ?net=0 wins over localStorage and the default is local
if (q === "0" || q === "false") return false;
```
`enterArena` only takes the networked branch when `state.net || state.netMode`
(`app.js:348`); with `?net=0` both are false, so `ensureGame().newMatch(...)` runs unchanged
(`app.js:349-354`).

Missing wallet: `createWallet()` never throws (`wallet.js:70-74`, `134-161`), `walletPill`
handles a null address (`app.js:547-565`), `loadBounds` catches `NO_PROVIDER` and disables
only the funded button (`app.js:645-650`), and `hasWallet()` is true whenever the default
escrow address is set, so `w.restore()` runs silently and resolves `{ok:false}` with no
provider (`app.js:1110-1114`). The local demo never blocks on a wallet.

### Q7 — Deadlines

```js
// escrow.js:68-73
export function computeDeadlines(nowMs = Date.now(), fundingSec = FUNDING_WINDOW_SEC, resolutionSec = RESOLUTION_WINDOW_SEC) {
  const nowSec = BigInt(Math.floor(nowMs / 1000));
  const fundingDeadline = nowSec + BigInt(fundingSec);
  ...
```
Correct: one `ms / 1000` → `floor` → `BigInt` conversion, margin already subtracted in the
`540`/`1140` constants (`escrow.js:59-61`). The contract wants UNIX seconds
(`TestnetPoolEscrow.sol:157-162`) and `encodeUint64` preserves the integer.

But `computeDeadlines` is only called from `escrow.createRoomNow` (`escrow.js:221-225`), which
nothing in `app.js` calls. The live path re-implements it at `app.js:718-729`. Both are
correct today; they will drift. Note also `app.js:718-719`'s comment says
"now + 600 / now + 1200" while the code computes 540/1140.

## Concrete gaps and fixes

1. **No receipt wait before `POST /api/rooms` — host create fails on the race.**
   `apps/web/src/web3/escrow.js`, `createRoom` (lines 113-127): after `eth_sendTransaction`,
   poll `eth_getTransactionReceipt` until `status === "0x1"` (bounded, e.g. 30 s) and throw a
   named error on revert/timeout before returning. `joinRoom` (129-149) needs the same so
   `deposit-confirm` is not posted for an unmined tx (the server's `getTransactionReceipt`
   would throw and Fastify would answer 500).
   *Alternative:* leave `escrow.js` alone and add the wait in
   `apps/web/app.js` `createFundedRoom` between line 736 and line 740.

2. **Guest funded path is inverted and unreachable.**
   `apps/web/app.js`, `prepareNetRoom` line 835: change
   `if (state.escrowAddress && roomKey && me && !me.walletAddress)` to gate on the room having
   a roomKey and the escrow being configured, not on the seat lacking a wallet
   (`if (state.escrowAddress && roomKey && me)`).
   `apps/web/app.js`, `localSeatUnfunded` (276-282): replace the roster check with an on-chain
   check — `state.depositors` (already read by `refreshDepositors`) must not contain
   `w.getAddress()` — so a wallet-bound, undeposited seat still offers "IKUT & DEPOSIT".

3. **Guest cannot reach the lobby join flow.**
   `apps/web/app.js`: call `prepareNetRoom()` on lobby entry for a `?room=` guest (in
   `navigate("lobby")`, or from `confirm-create` when `location.search` has `room`), instead
   of only inside `startNetworkedArena` (line 362).

4. **No shareable room link.**
   `apps/web/app.js` `ACTIONS["copy-code"]` (1093-1097) + `apps/web/index.html` lobby
   `.codetile`: add a copy action for
   `${location.origin}${location.pathname}?net=1&room=${state.netRoom.roomId}` and render it
   next to the code. The server has no code-based join route (`room.js:22-24`), so the 6-char
   code alone is not joinable.

5. **Result headline bypasses the settlement downgrade.**
   `apps/web/app.js`, `renderResultChain` (936-973): derive `confirmed`/`failed`/`settling`
   from `proj.state` instead of `raw`, so a hashless `CONFIRMED` cannot print
   "SETTLEMENT TERVERIFIKASI".

6. **Result POOL number contradicts its unit.**
   `apps/web/app.js`, `renderResult` line 899: when `verified`, set `rPool` to
   `fmtMon(state.funded.entryWei * BigInt(r.seatCount))`; keep the credit number only for the
   demo/funded-unverified cases.

7. **Stale chain state between matches.**
   `apps/web/app.js`, `enterArena` (341-345) or `createFundedRoom` success path: reset
   `state.chainRecord = null; state.chainTerminal = false;` before a new match.

8. **Reads are not chain-guarded.**
   `apps/web/src/web3/escrow.js`: call `assertChain()` (or read through a fixed Monad RPC)
   in `readBounds`, `readRoom` and `readDepositors` (109-111, 161-184) so lobby badges and
   bounds cannot come from another chain.

9. **Float math on a MON preset (cosmetic).**
   `apps/web/app.js` line 659: compare against a bigint derived from the dataset string the
   same way as `app.js:99-103`, instead of `BigInt(Math.round(Number(...) * 1e6))`.

10. **Deadline logic duplicated.**
    `apps/web/app.js` lines 718-729: replace the inline computation with
    `computeDeadlines(Date.now(), Number(fundingCap), Number(resolutionCap))` from
    `escrow.js`, or delete `computeDeadlines`/`createRoomNow` so there is one implementation.
    Also fix the "now + 600 / now + 1200" comment on line 718.

11. **`state` fields used before declaration (latent).**
    `apps/web/app.js` `state` (21-37) lacks `creating`, `depositors`, `roomKey`, `result`,
    `chainTerminal`, all of which are assigned later. Not a runtime bug today (`refreshFunded`
    reads `undefined` as falsy), but it hides typos; declare them in the literal.

## Can a host create and fund a room tonight?

**No, not reliably.** The host's own create-and-deposit will usually fail at the
`POST /api/rooms` step because the browser never waits for the `createRoom` receipt before the
server reads `getRoom` (`escrow.js:119-126` → `app.js:733-750` → `store.ts:169-171`). Even
with that fixed, no guest can join and fund a seat through the UI: `app.js:835` hides the
funded path from wallet-connected guests, the join button is only reachable after detouring
through the arena, and no shareable `?net=1&room=<roomId>` link is generated. Without funded
guests the escrow never reaches `FUNDED`, so settlement cannot run. Fixes 1–4 are the
minimum for a working demo.

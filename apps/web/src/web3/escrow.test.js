// web3 escrow tests — run with: node apps/web/src/web3/escrow.test.js
// Same no-framework style as apps/web/src/net/adapter.test.js.
//
// What this covers: everything that can be proven without a browser or a chain.
// Wallet connect (window.ethereum), wallet_switchEthereumChain and the actual
// eth_sendTransaction prompt are NOT covered here — see the report.
import { keccak256Utf8, keccak256Bytes, toHex } from "./keccak.js";
import {
  SELECTORS,
  encodeCreateRoom,
  encodeJoinRoom,
  decodeEntryBounds,
  decodeRoom,
  decodeAddressArray,
  decodeBool,
  deriveRoomKey,
} from "./abi.js";
import {
  createEscrow, explorerTxUrl, settlementState, computeDeadlines,
  escrowAddressFromEnv, DEFAULT_ESCROW_ADDRESS, deriveRoomKey as deriveKeyFromEscrow,
  randomNonce, shortKey,
} from "./escrow.js";
import { createWallet, truncateAddress } from "./wallet.js";

let failed = 0;
function eq(actual, expected, label) {
  const ok = String(actual) === String(expected);
  if (!ok) { failed++; console.error(`FAIL ${label}: got ${actual}, want ${expected}`); }
  else console.log(`  ok  ${label}`);
}
function assert(ok, label) {
  if (!ok) { failed++; console.error(`FAIL ${label}`); }
  else console.log(`  ok  ${label}`);
}
async function rejects(fn, codeOrText, label) {
  try {
    await fn();
    failed++; console.error(`FAIL ${label}: did not throw`);
  } catch (err) {
    const hit = codeOrText ? String(err.code ?? "") === codeOrText || String(err.message).includes(codeOrText) : true;
    if (hit) console.log(`  ok  ${label}`);
    else { failed++; console.error(`FAIL ${label}: threw ${err.code} ${err.message}`); }
  }
}

const ROOM_KEY = "0x" + "11".repeat(32);
const ESCROW = "0x" + "ab".repeat(20);
const ACCOUNT = "0x" + "cd".repeat(20);

// ---- keccak (selectors depend on it) ----
console.log("\nkeccak256");
eq(keccak256Utf8(""), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", "keccak('') vector");
eq(keccak256Utf8("abc"), "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45", "keccak('abc') vector");
// 135 bytes is the block-boundary case that a naive padder gets wrong
// (0x01 + 0x80 collapse into 0x81). Vector from viem.
eq(
  keccak256Utf8("0123456789".repeat(13) + "abcde").slice(0, 10),
  toHex(keccak256Bytes(new Uint8Array(135).map((_, i) => ("0123456789".repeat(13) + "abcde").charCodeAt(i)))).slice(0, 10),
  "135-byte message self-consistent",
);
eq(
  keccak256Utf8("createRoom(bytes32,uint8,uint256,uint64,uint64)").slice(0, 10),
  "0x391702ce",
  "selector derived from signature",
);

// ---- calldata ----
console.log("\ncreateRoom calldata");
const cd = encodeCreateRoom({
  roomKey: ROOM_KEY, seats: 3, entryWei: 10n ** 15n,
  fundingDeadline: 1900000000n, resolutionDeadline: 1900000600n,
});
eq(cd.slice(0, 10), "0x391702ce", "selector is 0x391702ce");
eq(cd.length, 2 + 8 + 64 * 5, "4-byte selector + 5 words");
eq("0x" + cd.slice(10, 74), ROOM_KEY, "word 0 = roomKey");
eq(BigInt("0x" + cd.slice(74, 138)), 3n, "word 1 = seats");
eq(BigInt("0x" + cd.slice(138, 202)), 10n ** 15n, "word 2 = entryWei");
eq(BigInt("0x" + cd.slice(202, 266)), 1900000000n, "word 3 = fundingDeadline");
eq(BigInt("0x" + cd.slice(266, 330)), 1900000600n, "word 4 = resolutionDeadline");

// Pinned against `cast calldata "createRoom(...)" 0x1111… 3 1000000000000000 1900000000 1900000600`
eq(
  cd,
  "0x391702ce" +
  "11".repeat(32) +
  "0".repeat(63) + "3" +
  "0".repeat(51) + "38d7ea4c68000" +
  "0".repeat(56) + "713fb300" +
  "0".repeat(56) + "713fb558",
  "full calldata matches cast",
);

rejects(() => encodeCreateRoom({ roomKey: ROOM_KEY, seats: 2, entryWei: 1n, fundingDeadline: 1n, resolutionDeadline: 2n }), "seats must be 3 or 4", "rejects 2 seats");
rejects(() => encodeCreateRoom({ roomKey: "0x1234", seats: 3, entryWei: 1n, fundingDeadline: 1n, resolutionDeadline: 2n }), "bytes32", "rejects short roomKey");
rejects(() => encodeCreateRoom({ roomKey: ROOM_KEY, seats: 3, entryWei: 1n << 256n, fundingDeadline: 1n, resolutionDeadline: 2n }), "uint256", "rejects >uint256 entry");

console.log("\njoinRoom calldata");
eq(encodeJoinRoom(ROOM_KEY), "0x4b29b4c4" + "11".repeat(32), "joinRoom selector + roomKey");
eq(encodeJoinRoom(ROOM_KEY).slice(0, 10), "0x4b29b4c4", "selector is 0x4b29b4c4");

// ---- decoders ----
console.log("\ndecoders");
const bounds = decodeEntryBounds("0x" + (10n ** 15n).toString(16).padStart(64, "0") + (10n ** 16n).toString(16).padStart(64, "0"));
eq(bounds.minWei, 10n ** 15n, "entryBounds min");
eq(bounds.maxWei, 10n ** 16n, "entryBounds max");

const roomWords = [
  "0".repeat(24) + "11".repeat(20), // host
  "0".repeat(63) + "4", // maxSeats
  "0".repeat(63) + "3", // depositCount
  (10n ** 15n).toString(16).padStart(64, "0"),
  (3n * 10n ** 15n).toString(16).padStart(64, "0"),
  "0".repeat(56) + "713fb300",
  "0".repeat(56) + "713fb558",
  "0".repeat(63) + "2", // FUNDED
  "0".repeat(24) + "22".repeat(20),
  "33".repeat(32),
  "0".repeat(64),
  "0".repeat(63) + "1",
];
const room = decodeRoom("0x" + roomWords.join(""));
eq(room.maxSeats, 4, "room.maxSeats");
eq(room.depositCount, 3, "room.depositCount");
eq(room.entryWei, 10n ** 15n, "room.entryWei");
eq(room.potWei, 3n * 10n ** 15n, "room.potWei");
eq(room.status, 2, "room.status FUNDED");
eq(room.host, "0x" + "11".repeat(20), "room.host");
eq(room.prizePaid, true, "room.prizePaid");

const depositors = decodeAddressArray(
  "0x" + "0".repeat(62) + "20" + "0".repeat(63) + "2" + "0".repeat(24) + "aa".repeat(20) + "0".repeat(24) + "bb".repeat(20),
);
eq(depositors.length, 2, "depositor array length");
eq(depositors[1], "0x" + "bb".repeat(20), "depositor array item");

eq(decodeBool("0x" + "0".repeat(64)), false, "decodeBool false");
eq(decodeBool("0x" + "0".repeat(63) + "1"), true, "decodeBool true");

console.log("\nderiveRoomKey (must equal apps/server/src/escrow/roomKey.ts)");
// Vector produced by viem's encodePacked + keccak256, the exact call the server makes:
//   encodePacked(['string','uint256','uint256','address'],
//                ['BOMB_RUSH_V05', 10143n, 0x1234567890abcdefn, host])
const NONCE = 0x1234567890abcdefn;
const HOST = "0x00000000000000000000000000000000000000cd";
const VIEM_ROOM_KEY = "0xd7aee55c82d66ef5096cd371173a31e4c43dd824dee5f91be36a0158042530d0";
eq(deriveRoomKey({ nonce: NONCE, host: HOST }), VIEM_ROOM_KEY, "roomKey matches viem/server derivation");
eq(deriveRoomKey({ nonce: NONCE, host: HOST }), deriveRoomKey({ nonce: NONCE, host: HOST }), "roomKey deterministic");
assert(
  deriveRoomKey({ nonce: NONCE, host: HOST }) !== deriveRoomKey({ nonce: NONCE + 1n, host: HOST }),
  "roomKey depends on the nonce",
);
assert(/^0x[0-9a-f]{64}$/.test(deriveRoomKey({ nonce: NONCE, host: HOST })), "roomKey is bytes32 hex");

// ---- escrow: chain guard + amount validation ----
console.log("\nroomKey + deadlines (host-owned)");
eq(deriveKeyFromEscrow({ nonce: NONCE, host: HOST }), VIEM_ROOM_KEY, "escrow.deriveRoomKey matches the viem vector");
const n1 = randomNonce();
const n2 = randomNonce();
assert(n1 > 0n && n1 < 1n << 256n, "randomNonce is a valid uint256");
assert(n1 !== n2, "randomNonce does not repeat");
eq(deriveKeyFromEscrow({ nonce: n1, host: HOST }) !== deriveKeyFromEscrow({ nonce: n2, host: HOST }), true, "distinct nonces -> distinct keys");
eq(shortKey(VIEM_ROOM_KEY), "0xd7aee55c…2530d0", "shortKey is display-only");

const fixedNow = 1_700_000_000_000; // ms
const d = computeDeadlines(fixedNow);
eq(d.nowSec, 1700000000n, "ms -> seconds floored");
eq(d.fundingDeadline, 1700000540n, "fundingDeadline = now + 540 s (60 s under the 600 s cap)");
eq(d.resolutionDeadline, 1700001140n, "resolutionDeadline = now + 1140 s (60 s under the 1200 s cap)");
eq(computeDeadlines(fixedNow + 999).nowSec, 1700000000n, "sub-second remainder is dropped, not rounded up");
eq(d.resolutionDeadline > d.fundingDeadline, true, "resolution after funding");
eq(typeof d.fundingDeadline, "bigint", "deadlines stay integer (uint64-safe)");
// The deployed contract's caps are exactly 600/1200 s and it compares against
// block.timestamp, which is ahead of the browser clock. Staying under matters.
eq(d.fundingDeadline - d.nowSec <= 600n, true, "funding stays within the 600 s contract cap");
eq(d.resolutionDeadline - d.nowSec <= 1200n, true, "resolution stays within the 1200 s contract cap");
eq(d.fundingDeadline - d.nowSec < 600n, true, "funding leaves block-time slack (now+600 would revert)");

console.log("\nescrow configuration");
eq(escrowAddressFromEnv({}), DEFAULT_ESCROW_ADDRESS, "defaults to the deployed escrow");
eq(DEFAULT_ESCROW_ADDRESS, "0x8c839fab937a08177c2779eef36c15d8999be8fe", "deployed address pinned");
eq(escrowAddressFromEnv({ ESCROW_ADDRESS: "0xNOTHEX" }), null, "malformed override is rejected, not used");
eq(escrowAddressFromEnv({ ESCROW_ADDRESS: "0x" + "12".repeat(20) }), "0x" + "12".repeat(20), "valid override honoured");

console.log("\nescrow chain guard");
// A chain fake that behaves like a provider after a real send: every hash it
// issued gets a mined receipt (blockNumber set, status 0x1) on the next poll.
// createRoom/joinRoom now wait for that receipt, so a provider that returns
// null forever is no longer a valid stand-in for "the tx went through".
// `receiptStatus` flips the mined receipt to a revert ("0x0"); `mine: false`
// models a tx that never gets included. `receiptCalls` records every
// eth_getTransactionReceipt poll so tests can prove the wait happened.
function fakeWallet({ chainId = "0x279f", calls = {}, onSend, receiptStatus = "0x1", mine = true } = {}) {
  const issued = new Set();
  const receiptCalls = [];
  return {
    receiptCalls,
    request: async (method, params) => {
      if (method === "eth_chainId") return typeof chainId === "function" ? chainId() : chainId;
      if (method === "eth_call") {
        const sel = params?.[0]?.data?.slice(0, 10);
        if (calls[sel]) return calls[sel];
        return "0x" + "0".repeat(64);
      }
      if (method === "eth_sendTransaction") {
        const hash = onSend ? onSend(params[0]) : "0x" + "aa".repeat(32);
        if (typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash)) issued.add(hash.toLowerCase());
        return hash;
      }
      if (method === "eth_getTransactionReceipt") {
        const hash = String(params?.[0] ?? "");
        receiptCalls.push(hash);
        if (!mine || !issued.has(hash.toLowerCase())) return null; // not mined (yet)
        return { blockNumber: "0x1", status: receiptStatus, transactionHash: hash };
      }
      if (method === "eth_accounts") return [ACCOUNT];
      throw new Error("unexpected " + method);
    },
  };
}

const boundsCall = {
  [SELECTORS.entryBounds]:
    "0x" + (10n ** 15n).toString(16).padStart(64, "0") + (10n ** 16n).toString(16).padStart(64, "0"),
};

const good = createEscrow({ wallet: fakeWallet({ calls: boundsCall }), escrowAddress: ESCROW });
const vOk = await good.validateEntry(5n * 10n ** 15n);
eq(vOk.ok, true, "0.005 MON accepted against live bounds");
const vLow = await good.validateEntry(10n ** 14n);
eq(vLow.ok, false, "below min rejected");
eq(vLow.reason, "AMOUNT_BELOW_MIN", "below min reason");
const vHigh = await good.validateEntry(2n * 10n ** 16n);
eq(vHigh.ok, false, "above max rejected");
eq(vHigh.reason, "AMOUNT_ABOVE_MAX", "above max reason");
const vZero = await good.validateEntry(0n);
eq(vZero.reason, "AMOUNT_ZERO", "zero rejected");

// bounds are read, not hardcoded: a contract with a different window must move the verdict
const wide = createEscrow({
  wallet: fakeWallet({
    calls: {
      [SELECTORS.entryBounds]:
        "0x" + (10n ** 14n).toString(16).padStart(64, "0") + (10n ** 18n).toString(16).padStart(64, "0"),
    },
  }),
  escrowAddress: ESCROW,
});
eq((await wide.validateEntry(10n ** 14n)).ok, true, "same amount accepted when contract min is lower");
eq((await wide.validateEntry(2n * 10n ** 16n)).ok, true, "same amount accepted when contract max is higher");

// bounds unavailable must not silently pass
const noContract = createEscrow({
  wallet: { request: async (m) => { if (m === "eth_chainId") return "0x279f"; return "0x"; } },
  escrowAddress: ESCROW,
});
const vNo = await noContract.validateEntry(10n ** 15n);
eq(vNo.ok, false, "unreadable bounds block the deposit");
eq(vNo.reason, "BOUNDS_UNAVAILABLE", "bounds unavailable reason");

// wrong chain blocks writes, before a tx is ever built
const wrongChain = createEscrow({
  wallet: fakeWallet({ chainId: "0x1", calls: boundsCall }),
  escrowAddress: ESCROW,
});
await rejects(
  () => wrongChain.createRoom({ roomKey: ROOM_KEY, seats: 3, entryWei: 10n ** 15n, fundingDeadline: 1900000000n, resolutionDeadline: 1900000600n }),
  "CHAIN_MISMATCH", "createRoom rejected on chain 1",
);
await rejects(() => wrongChain.joinRoom(ROOM_KEY, 10n ** 15n), "CHAIN_MISMATCH", "joinRoom rejected on chain 1");

// correct chain sends exactly entryWei as msg.value
let seen = null;
const rightChain = createEscrow({
  wallet: fakeWallet({ calls: boundsCall, onSend: (tx) => { seen = tx; return "0x" + "ab".repeat(32); } }),
  escrowAddress: ESCROW,
});
const sent = await rightChain.createRoom({
  roomKey: ROOM_KEY, seats: 4, entryWei: 5n * 10n ** 15n,
  fundingDeadline: 1900000000n, resolutionDeadline: 1900000600n,
});
eq(sent.txHash, "0x" + "ab".repeat(32), "tx hash passed through verbatim");
eq(seen.value, "0x" + (5n * 10n ** 15n).toString(16), "msg.value == entryWei exactly");
eq(seen.to, ESCROW, "tx target is the escrow address");
eq(seen.data.slice(0, 10), "0x391702ce", "tx calldata is createRoom");

// joinRoom with no explicit amount reads entryWei from the contract room
const roomForJoin = "0x" + [
  "0".repeat(24) + "11".repeat(20),
  "0".repeat(63) + "3",
  "0".repeat(63) + "1",
  (10n ** 15n).toString(16).padStart(64, "0"),
  (10n ** 15n).toString(16).padStart(64, "0"),
  "0".repeat(56) + "713fb300",
  "0".repeat(56) + "713fb558",
  "0".repeat(63) + "1",
  "0".repeat(64), "0".repeat(64), "0".repeat(64), "0".repeat(64),
].join("");
let joinTx = null;
const joinEscrow = createEscrow({
  wallet: fakeWallet({
    calls: { ...boundsCall, [SELECTORS.getRoom]: roomForJoin },
    onSend: (tx) => { joinTx = tx; return "0x" + "cd".repeat(32); },
  }),
  escrowAddress: ESCROW,
});
await joinEscrow.joinRoom(ROOM_KEY);
eq(joinTx.value, "0x" + (10n ** 15n).toString(16), "joinRoom value read from getRoom().entryWei");
eq(joinTx.data, encodeJoinRoom(ROOM_KEY), "joinRoom calldata");

// ---- receipt gate: a tx hash alone is not a confirmed deposit ----
console.log("\nreceipt gate");
{
  const createWalletFake = fakeWallet({
    calls: boundsCall,
    onSend: () => "0x" + "ab".repeat(32),
  });
  const escrow = createEscrow({ wallet: createWalletFake, escrowAddress: ESCROW });
  const res = await escrow.createRoom({
    roomKey: ROOM_KEY, seats: 4, entryWei: 5n * 10n ** 15n,
    fundingDeadline: 1900000000n, resolutionDeadline: 1900000600n,
  });
  eq(res.txHash, "0x" + "ab".repeat(32), "createRoom still returns the tx hash");
  assert(createWalletFake.receiptCalls.length >= 1, "createRoom polled eth_getTransactionReceipt at least once");
  eq(createWalletFake.receiptCalls[0], "0x" + "ab".repeat(32), "receipt polled for the hash the provider issued");
}

// A reverted tx still mines and still has a hash: treating it as confirmed
// would report a failed deposit as funded.
{
  const reverted = fakeWallet({
    calls: boundsCall,
    onSend: () => "0x" + "ef".repeat(32),
    receiptStatus: "0x0",
  });
  const escrow = createEscrow({ wallet: reverted, escrowAddress: ESCROW });
  await rejects(
    () => escrow.createRoom({ roomKey: ROOM_KEY, seats: 4, entryWei: 5n * 10n ** 15n, fundingDeadline: 1900000000n, resolutionDeadline: 1900000600n }),
    "TX_REVERTED", "createRoom rejects a mined receipt with status 0x0",
  );
  assert(reverted.receiptCalls.length >= 1, "revert was detected from the receipt, not guessed");
}

// joinRoom has the same hazard as createRoom.
{
  const joinFake = fakeWallet({
    calls: { ...boundsCall, [SELECTORS.getRoom]: roomForJoin },
    onSend: () => "0x" + "cd".repeat(32),
  });
  const escrow = createEscrow({ wallet: joinFake, escrowAddress: ESCROW });
  await escrow.joinRoom(ROOM_KEY);
  assert(joinFake.receiptCalls.length >= 1, "joinRoom polled eth_getTransactionReceipt at least once");
  eq(joinFake.receiptCalls[0], "0x" + "cd".repeat(32), "joinRoom polled the receipt for its own tx");
}

// A provider that never includes the tx must surface TX_TIMEOUT, not hang.
// Short timeout via the waitForReceipt option so the suite stays fast.
{
  const neverMines = createEscrow({
    wallet: fakeWallet({ calls: boundsCall, onSend: () => "0x" + "77".repeat(32), mine: false }),
    escrowAddress: ESCROW,
  });
  await rejects(
    () => neverMines._waitForReceipt("0x" + "77".repeat(32), { timeoutMs: 50, intervalMs: 10 }),
    "TX_TIMEOUT", "a never-mined tx times out",
  );
}

// a bad provider return is not accepted as a tx hash
const lyingProvider = createEscrow({
  wallet: fakeWallet({ calls: boundsCall, onSend: () => "0xdeadbeef" }),
  escrowAddress: ESCROW,
});
await rejects(
  () => lyingProvider.createRoom({ roomKey: ROOM_KEY, seats: 3, entryWei: 10n ** 15n, fundingDeadline: 1900000000n, resolutionDeadline: 1900000600n }),
  "BAD_TX_HASH", "short provider hash rejected",
);

// ---- result honesty ----
console.log("\nsettlement state");
eq(explorerTxUrl(null), null, "no hash -> no explorer link");
eq(explorerTxUrl("0x1234"), null, "short hash -> no explorer link");
eq(explorerTxUrl("0x" + "aa".repeat(32)), "https://testnet.monadscan.com/tx/0x" + "aa".repeat(32), "real hash -> monadscan explorer link");
eq(explorerTxUrl("0x" + "aa".repeat(32), "https://testnet.monadscan.com/tx"), "https://testnet.monadscan.com/tx/0x" + "aa".repeat(32), "trailing slash handled");
eq(settlementState({}).state, "PENDING", "no record -> PENDING");
eq(settlementState({ chainRecord: { state: "SETTLING" } }).state, "PENDING", "SETTLING -> PENDING (nothing recorded)");
eq(settlementState({ chainRecord: { state: "CONFIRMED" } }).state, "PENDING", "CONFIRMED without settle hash downgraded to PENDING");
eq(settlementState({ chainRecord: { state: "CONFIRMED" } }).mismatch, true, "downgrade is flagged");
eq(
  settlementState({ chainRecord: { state: "CONFIRMED", txHash: "0x" + "aa".repeat(32) } }).state,
  "CONFIRMED", "CONFIRMED with a settle hash stays CONFIRMED",
);
eq(
  settlementState({ chainRecord: { state: "PAID", txHash: "0x" + "aa".repeat(32) } }).state,
  "CONFIRMED", "PAID without a PrizePaid receipt downgraded to CONFIRMED",
);
eq(
  settlementState({ chainRecord: { state: "PAID", txHash: "0x" + "aa".repeat(32), payoutTxHash: "0x" + "bb".repeat(32) } }).state,
  "PAID", "PAID with both receipts stays PAID",
);
eq(settlementState({ chainRecord: { state: "FAILED", reason: "settle: revert" } }).state, "FAILED", "FAILED is passed through");
eq(settlementState({ chainRecord: { state: "SOMETHING_NEW", txHash: "0x" + "aa".repeat(32) } }).state, "PENDING", "unknown state is PENDING, never paid");
eq(
  settlementState({ chainRecord: { state: "PAID", txHash: "0x" + "aa".repeat(32), payoutTxHash: "not-a-hash" } }).payoutTxHash,
  null, "a malformed payout hash never becomes an explorer link",
);

// ---- wallet (pure parts only; no window.ethereum in node) ----
console.log("\nwallet (headless)");
const noProvider = createWallet({ provider: undefined });
eq(noProvider.isAvailable, false, "no provider detected");
const conn = await noProvider.connect();
eq(conn.ok, false, "connect fails without a provider");
eq(conn.error, "NO_WALLET", "NO_WALLET error");
eq(noProvider.getAddress(), null, "no address without provider");
eq(truncateAddress("0x1234567890abcdef1234567890abcdef12345678"), "0x1234…5678", "truncateAddress");

function mockProvider({ chain = "0x279f", accounts = [ACCOUNT], rejectSwitch = false } = {}) {
  const handlers = {};
  return {
    request: async ({ method }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return accounts;
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") {
        if (rejectSwitch) throw Object.assign(new Error("User rejected"), { code: 4001 });
        return null;
      }
      if (method === "wallet_addEthereumChain") return null;
      throw Object.assign(new Error("unsupported " + method), { code: 4200 });
    },
    on: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
    emit: (ev, v) => (handlers[ev] || []).forEach((f) => f(v)),
  };
}

const prov = mockProvider();
const w = createWallet({ provider: prov });
const c = await w.connect();
eq(c.ok, true, "connect with a provider");
eq(w.getAddress(), ACCOUNT, "getAddress after connect");
eq(w.isReady, true, "isReady on 10143");
eq(w.getChainId !== undefined, true, "getChainId exposed");
const safe = await w.ensureChain();
eq(safe.ok, true, "ensureChain no-op when already on 10143");

let changed = null;
w.onAccountChange((s) => { changed = s.address; });
prov.emit("accountsChanged", ["0x" + "99".repeat(20)]);
eq(changed, "0x" + "99".repeat(20), "onAccountChange fires");

const wrong = createWallet({ provider: mockProvider({ chain: "0x1" }) });
await wrong.connect();
eq(wrong.isReady, false, "isReady false on chain 1");
const switched = await wrong.ensureChain();
eq(switched.ok, false, "ensureChain reports wallet staying on chain 1");
// mockProvider keeps returning 0x1 even after switch, so the check is honest
const rejecting = createWallet({ provider: mockProvider({ chain: "0x1", rejectSwitch: true }) });
await rejecting.connect();
const rej = await rejecting.ensureChain();
eq(rej.ok, false, "user-rejected switch is reported, not swallowed");
eq(rej.error, "Permintaan ditolak di wallet.", "rejection message is actionable");

// ---- finish ----
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

// Room store: owns in-memory rooms and ONE global authoritative loop.
// ponytail: single in-memory room server for the demo (DECISIONS.md Persistence);
// sharding/replication deferred until there is more than one server process.
import type { Clock, GameEvents, GameError, RoomSession, PlayerInput } from './domain.js';
import {
  createRoom as domCreateRoom,
  joinRoom as domJoinRoom,
  setReady as domSetReady,
  leaveRoom as domLeaveRoom,
  onDisconnect as domOnDisconnect,
  onReconnect as domOnReconnect,
  tickRoom as domTickRoom,
  startMatch as domStartMatch,
  applyInput as domApplyInput,
  passBomb as domPassBomb,
  explode as domExplode,
  cancelRoom as domCancelRoom,
  roomPublicState,
  matchSnapshot,
} from './domain.js';
import { GAME_RULES } from '@bomb-rush/shared';
import { normalizeWallet } from '../escrow/roomKey.js';
import type { EscrowGateway } from '../escrow/gateway.js';
import type { Hex } from 'viem';

const ROOM_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

/** bytes32 roomKey from the client, normalized lowercase; null if invalid. */
export function normalizeRoomKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!ROOM_KEY_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

const TICK_MS = 1000 / GAME_RULES.SERVER_TICK_HZ; // 50 ms

export interface RoomStoreDeps {
  clock: Clock;
  /** setInterval-like abstraction (real timers in prod, fake in tests). */
  timers: { set(cb: () => void, ms: number): unknown; clear(handle: unknown): void };
  /**
   * Chain boundary. Null/omitted = chain module disabled: every on-chain
   * operation answers CHAIN_DISABLED instead of guessing a status.
   */
  escrowGateway?: EscrowGateway | null;
  /** Fired when escrowStatus changes so the adapter can emit chain:status. */
  onChainStatus?: (roomId: string, status: { state: string; txHash?: string; reason?: string }) => void;
}

export interface DepositConfirmResult {
  errors: GameError[];
  escrowStatus?: string;
  /** True when this exact tx was already confirmed (no chain re-read). */
  idempotent?: boolean;
}

export interface JoinResult {
  errors: GameError[];
  participantId?: string;
  sessionToken?: string;
}

export interface CreateRoomResult {
  errors: GameError[];
  roomId?: string;
  code?: string;
  participantId?: string;
  sessionToken?: string;
  hostSessionId?: string;
  visibility?: 'PUBLIC' | 'PRIVATE';
  roomKey?: string | null;
}

export class RoomStore {
  private rooms = new Map<string, RoomSession>();
  private roomsByCode = new Map<string, RoomSession>();
  private sessionTokens = new Map<string, string>(); // participantId -> token
  private tokenIndex = new Map<string, string>(); // token -> participantId
  private participantRoom = new Map<string, string>(); // participantId -> roomId
  /** roomKey -> room: one escrow room can back exactly one game room. */
  private roomsByRoomKey = new Map<string, RoomSession>();
  private loopHandle: unknown;
  private eventCallback: ((roomId: string, events: GameEvents) => void) | null = null;
  /** txHash (lowercase) -> roomId: deposit-confirm is idempotent per tx. */
  private confirmedDeposits = new Map<string, string>();

  constructor(private deps: RoomStoreDeps) {
    // setInterval semantics implemented with re-arming setTimeout (timers are
    // injectable for tests). BUG FIX: prior version scheduled once and never
    // re-armed — the authoritative loop only ever ticked once (~50 ms) after
    // boot, which no unit test caught because tests drive tickNow() directly.
    const rearm = () => {
      this.loop();
      this.loopHandle = deps.timers.set(rearm, TICK_MS);
    };
    this.loopHandle = deps.timers.set(rearm, TICK_MS);
  }

  stop() {
    if (this.loopHandle != null) this.deps.timers.clear(this.loopHandle);
  }

  setEventCallback(cb: (roomId: string, events: GameEvents) => void) {
    this.eventCallback = cb;
  }

  /** Deposit-confirm status mirror; wired by the adapter to `chain:status`. */
  setChainStatusCallback(cb: (roomId: string, status: { state: string; txHash?: string; reason?: string }) => void) {
    this.deps.onChainStatus = cb;
  }

  emit(roomId: string, events: GameEvents) {
    if (this.eventCallback) this.eventCallback(roomId, events);
  }

  allRooms(): RoomSession[] {
    return [...this.rooms.values()];
  }

  findParticipantByToken(token: string): { roomId: string; participantId: string } | null {
    const participantId = this.tokenIndex.get(token);
    if (!participantId) return null;
    const roomId = this.participantRoom.get(participantId);
    if (!roomId) return null;
    return { roomId, participantId };
  }

  // -------------------------------------------------------------------------
  // Room lifecycle
  // -------------------------------------------------------------------------

  /**
   * Creates the game room. `roomKey` is CLIENT-SUPPLIED: the host's wallet
   * creates the escrow room on-chain, so the contract's key is whatever the
   * host sent. The server never derives it — it verifies it.
   */
  async createRoom(
    hostSessionId: string,
    virtualDemoEntryWei: string,
    allowDemoBot: boolean,
    visibility: 'PUBLIC' | 'PRIVATE' = 'PUBLIC',
    hostWallet: unknown = null,
    suppliedRoomKey: unknown = null,
  ): Promise<CreateRoomResult> {
    const wallet = normalizeWallet(hostWallet);
    const key = normalizeRoomKey(suppliedRoomKey);
    /** Chain-reported status when verified; NONE when unverified/disabled. */
    let verifiedStatus: RoomSession['escrowStatus'] = 'NONE';
    if (suppliedRoomKey != null && suppliedRoomKey !== '' && key === null) {
      return { errors: [{ code: 'BAD_PAYLOAD', message: 'roomKey must be a 32-byte 0x-prefixed hex string.' }] };
    }
    // A roomKey without a host wallet cannot be attributed, and a wallet
    // without a roomKey has nothing to escrow against.
    if (key !== null && wallet === null) {
      return { errors: [{ code: 'BAD_PAYLOAD', message: 'roomKey requires a valid hostWalletAddress.' }] };
    }
    if (key !== null) {
      const bound = this.roomsByRoomKey.get(key);
      if (bound != null) {
        return { errors: [{ code: 'BAD_PAYLOAD', message: 'That roomKey is already bound to another room.' }] };
      }
      const gateway = this.deps.escrowGateway ?? null;
      if (gateway) {
        // Verify against the contract, never trust the client. Three checks:
        // the key exists (status != NONE), the host matches the claimed wallet,
        // and the entry is inside the contract's own bounds.
        try {
          const chainRoom = await gateway.readRoom(key as Hex);
          if (chainRoom.status === 'NONE') {
            return { errors: [{ code: 'BAD_PAYLOAD', message: 'roomKey does not exist on the escrow contract.' }] };
          }
          if (chainRoom.host.toLowerCase() !== wallet) {
            return {
              errors: [{ code: 'BAD_PAYLOAD', message: `roomKey host is ${chainRoom.host}, not the supplied host wallet.` }],
            };
          }
          if (chainRoom.status !== 'FUNDING' && chainRoom.status !== 'FUNDED') {
            return {
              errors: [{ code: 'BAD_PAYLOAD', message: `Escrow room is ${chainRoom.status}; a new game room needs a fundable room.` }],
            };
          }
          const bounds = await gateway.entryBounds();
          const entry = BigInt(virtualDemoEntryWei);
          if (entry !== chainRoom.entryWei || entry < bounds.minWei || entry > bounds.maxWei) {
            return {
              errors: [{
                code: 'BAD_PAYLOAD',
                message: `Entry ${entry} wei does not match the escrow room's ${chainRoom.entryWei} wei (bounds ${bounds.minWei}..${bounds.maxWei}).`,
              }],
            };
          }
          verifiedStatus = chainRoom.status;
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          return { errors: [{ code: 'BAD_STATE', message: `Could not verify roomKey on chain: ${reason}` }] };
        }
      }
      // Chain disabled or gateway absent: store the key as UNVERIFIED (NONE).
      // We do not pretend it was checked.
    }
    const roomId = crypto.randomUUID();
    const code = crypto.randomUUID().slice(0, 6).toUpperCase();
    // host participant id minted up front so budget/cancel checks have an anchor
    // before the join token exists (they're the same participant once joined).
    const room = domCreateRoom(this.deps.clock, roomId, code, crypto.randomUUID(), visibility, virtualDemoEntryWei, allowDemoBot, key);
    if (key !== null) {
      // Only a verified key reflects the chain; an unverified one stays NONE.
      room.escrowStatus = this.deps.escrowGateway ? verifiedStatus : 'NONE';
      this.roomsByRoomKey.set(key, room);
    }
    this.rooms.set(roomId, room);
    this.roomsByCode.set(code, room);
    // host joins as first participant, receiving the first session token
    const join = domJoinRoom(room, 'HUMAN', this.deps.clock, wallet);
    if (!('sessionToken' in join)) throw new Error('host join must succeed');
    this.sessionTokens.set(join.participant.participantId, join.sessionToken);
    this.tokenIndex.set(join.sessionToken, join.participant.participantId);
    this.participantRoom.set(join.participant.participantId, roomId);
    // host ownership keyed by participant id (cancel-room check)
    room.hostParticipantId = join.participant.participantId;
    return { errors: [], roomId, code, participantId: join.participant.participantId, sessionToken: join.sessionToken, hostSessionId, visibility, roomKey: key };
  }

  joinRoom(roomId: string, kind: 'HUMAN' | 'DEMO_BOT', walletAddress: unknown = null): JoinResult {
    const room = this.rooms.get(roomId);
    if (!room) return { errors: [{ code: 'ROOM_NOT_JOINABLE', message: 'Room not found.' }] };
    // An address that is present but malformed must be rejected, not dropped:
    // silently seating a guest would lock that player out of the pot later.
    const wallet = normalizeWallet(walletAddress);
    if (walletAddress != null && walletAddress !== '' && wallet === null) {
      return { errors: [{ code: 'BAD_PAYLOAD', message: 'walletAddress is not a valid address.' }] };
    }
    const res = domJoinRoom(room, kind, this.deps.clock, wallet);
    if (!('sessionToken' in res)) return { errors: res.errors };
    this.sessionTokens.set(res.participant.participantId, res.sessionToken);
    this.tokenIndex.set(res.sessionToken, res.participant.participantId);
    this.participantRoom.set(res.participant.participantId, roomId);
    return { errors: [], participantId: res.participant.participantId, sessionToken: res.sessionToken };
  }

  getRoom(roomId: string) {
    return this.rooms.get(roomId);
  }

  /**
   * POST /api/rooms/:roomId/deposit-confirm. Verifies the receipt against the
   * room's OWN roomKey and its own entry amount, then mirrors the chain's room
   * status. Idempotent: replaying the same txHash returns the stored answer
   * without another receipt read.
   */
  async confirmDeposit(roomId: string, input: { txHash: string; walletAddress: string }): Promise<DepositConfirmResult> {
    const room = this.rooms.get(roomId);
    if (!room) return { errors: [{ code: 'ROOM_NOT_JOINABLE', message: 'Room not found.' }] };
    if (room.roomKey == null) {
      return { errors: [{ code: 'BAD_STATE', message: 'Room has no roomKey (demo mode); nothing to deposit against.' }] };
    }
    const txKey = input.txHash.toLowerCase();
    const seenRoom = this.confirmedDeposits.get(txKey);
    if (seenRoom != null) {
      if (seenRoom !== roomId) {
        return { errors: [{ code: 'BAD_PAYLOAD', message: 'That transaction belongs to another room.' }] };
      }
      return { errors: [], escrowStatus: room.escrowStatus, idempotent: true };
    }
    const wallet = normalizeWallet(input.walletAddress);
    if (wallet === null) {
      return { errors: [{ code: 'BAD_PAYLOAD', message: 'walletAddress is not a valid address.' }] };
    }
    const seat = room.participants.find((p) => p.walletAddress === wallet);
    if (!seat) {
      return { errors: [{ code: 'NOT_IN_ROOM', message: 'That wallet does not hold a seat in this room.' }] };
    }
    const gateway = this.deps.escrowGateway ?? null;
    if (!gateway) {
      return { errors: [{ code: 'BAD_STATE', message: 'Chain module is disabled; deposits cannot be verified.' }] };
    }
    const result = await gateway.verifyDeposit(input.txHash as Hex, {
      roomKey: room.roomKey as Hex,
      player: wallet as `0x${string}`,
      amountWei: BigInt(room.virtualDemoEntryWei),
    });
    if (!result.ok) {
      return { errors: [{ code: 'BAD_PAYLOAD', message: `Deposit rejected: ${result.reason} — ${result.detail}` }] };
    }
    // Mirror the chain, never assume: a verified deposit does not imply FUNDED.
    try {
      const chainRoom = await gateway.readRoom(room.roomKey as Hex);
      room.escrowStatus = chainRoom.status;
    } catch {
      // Receipt verified but the follow-up read failed: leave the previous
      // status rather than guessing. The deposit itself is proven.
    }
    this.confirmedDeposits.set(txKey, roomId);
    this.deps.onChainStatus?.(roomId, { state: room.escrowStatus, txHash: input.txHash });
    return { errors: [], escrowStatus: room.escrowStatus };
  }

  getRoomByCode(code: string) {
    return this.roomsByCode.get(code);
  }

  listRooms() {
    return [...this.rooms.values()].map((r) => ({
      roomId: r.roomId,
      code: r.code,
      status: r.roomStatus,
      players: r.participants.length,
      maxPlayers: GAME_RULES.MAX_PLAYERS,
      allowDemoBot: r.allowDemoBot,
      virtualDemoEntryWei: r.virtualDemoEntryWei,
      visibility: r.visibility,
    }));
  }

  roomState(roomId: string) {
    const room = this.rooms.get(roomId);
    return room ? roomPublicState(room) : null;
  }

  roomSnapshot(roomId: string) {
    const room = this.rooms.get(roomId);
    return room ? matchSnapshot(room, this.deps.clock) : null;
  }

  setReady(roomId: string, participantId: string, ready: boolean) {
    const room = this.rooms.get(roomId);
    if (!room) return { events: {}, errors: [{ code: 'NOT_IN_ROOM' as const, message: 'Room not found.' }] };
    return touch(roomId, domSetReady(room, participantId, ready, this.deps.clock), room, this);
  }

  leaveRoom(roomId: string, participantId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    domLeaveRoom(room, participantId, this.deps.clock);
    this.forgetParticipant(participantId);
    this.maybeSweepRoom(room);
  }

  disconnect(roomId: string, participantId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    domOnDisconnect(room, participantId, this.deps.clock);
  }

  reconnect(roomId: string, participantId: string, sessionToken: string) {
    const room = this.rooms.get(roomId);
    if (!room) return { events: {}, errors: [{ code: 'NOT_IN_ROOM' as const, message: 'Room not found.' }] };
    return touch(roomId, domOnReconnect(room, participantId, () => this.sessionTokens.get(participantId), sessionToken, this.deps.clock), room, this);
  }

  tokenFor(participantId: string): string | undefined {
    return this.sessionTokens.get(participantId);
  }

  applyInput(roomId: string, participantId: string, input: PlayerInput) {
    const room = this.rooms.get(roomId);
    if (!room) return { errors: [{ code: 'NOT_IN_ROOM', message: 'Room not found.' }] };
    return domApplyInput(room, participantId, input, this.deps.clock);
  }

  passBomb(roomId: string, participantId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return { events: {}, errors: [{ code: 'NOT_IN_ROOM', message: 'Room not found.' }] };
    return touch(roomId, domPassBomb(room, participantId, this.deps.clock), room, this);
  }

  cancelRoom(roomId: string, byParticipantId: string, sessionToken?: string) {
    const room = this.rooms.get(roomId);
    if (!room) return { events: {}, errors: [{ code: 'NOT_IN_ROOM' as const, message: 'Room not found.' }] };
    // token handshake: knowing the participantId alone is not authorization
    if (sessionToken != null) {
      const expected = this.tokenFor(byParticipantId);
      if (!expected || expected !== sessionToken) {
        return { events: {}, errors: [{ code: 'NOT_HOST' as const, message: 'Invalid host session token.' }] };
      }
    }
    const out = domCancelRoom(room, byParticipantId, this.deps.clock);
    this.emit(roomId, out.events);
    return out;
  }

  private forgetParticipant(participantId: string) {
    this.participantRoom.delete(participantId);
    const token = this.sessionTokens.get(participantId);
    if (token) {
      this.tokenIndex.delete(token);
      this.sessionTokens.delete(participantId);
    }
  }

  private maybeSweepRoom(room: RoomSession) {
    // Cleanup when the lobby is empty — no match state to preserve.
    if (room.participants.length === 0 && room.roomStatus !== 'LIVE') {
      this.rooms.delete(room.roomId);
      this.roomsByCode.delete(room.code);
      if (room.roomKey) this.roomsByRoomKey.delete(room.roomKey);
    }
  }  /** True setReady → COUNTDOWN needs a quorum recheck for a leave/disconnect edge. */
  private quorumHold(room: RoomSession): boolean {
    return room.participants.length >= GAME_RULES.MIN_PLAYERS && room.participants.every((p) => p.ready);
  }

  // -------------------------------------------------------------------------
  // THE single 20 Hz authoritative loop. Owns:
  //  - lobby countdown completion (revalidates quorum, no forced start)
  //  - LIVE simulation (movement/stamina integration + live input)
  //  - bomb expiry / explosion check (no separate bomb timers → no double end)
  //  - room expiry sweep + final-state memory reclaim
  // -------------------------------------------------------------------------
  private loop() {
    const now = this.deps.clock.now();
    for (const room of [...this.rooms.values()]) {
      // PRD FR-08: lobby rooms expire at 10 min
      const expired = now >= room.expiresAt;
      switch (room.roomStatus) {
        case 'COUNTDOWN': {
          if (expired) {
            this.emit(room.roomId, { roomLapsed: { status: 'CANCELED' } });
            room.roomStatus = 'CANCELED';
            room.endedAtMs = now;
            break;
          }
          if (room.countdownStartsAt != null && now >= room.countdownStartsAt + GAME_RULES.LOBBY_COUNTDOWN_MS) {
            // Quorum still valid? (FLOWCHART §A) — never force a start
            if (!this.quorumHold(room)) {
              room.roomStatus = 'WAITING';
              room.countdownStartsAt = null;
              room.participants.forEach((p) => { p.ready = false; });
              this.emit(room.roomId, { roomCountdownCanceled: { status: 'WAITING' } });
              break;
            }
            const out = domStartMatch(room, this.deps.clock);
            this.emit(room.roomId, out.events);
          }
          break;
        }
        case 'LIVE': {
          const out = domTickRoom(room, this.deps.clock);
          this.emit(room.roomId, out.events);
          // bomb expiry decided here — one owner, race-free after FINISHED/ABORTED
          if (room.roomStatus === 'LIVE' && room.bombExpiresAt != null && now >= room.bombExpiresAt) {
            const ex = domExplode(room, this.deps.clock);
            this.emit(room.roomId, ex.events);
          }
          break;
        }
        case 'WAITING': {
          if (expired) {
            this.emit(room.roomId, { roomLapsed: { status: 'CANCELED' } });
            room.roomStatus = 'CANCELED';
            room.endedAtMs = now;
          }
          break;
        }
        default:
          // FINISHED / CANCELED / ABORTED: swept 30 s after end so late clients
          // can still read the result; then memory reclaim.
          if (room.endedAtMs != null && now >= room.endedAtMs + 30_000) {
            this.rooms.delete(room.roomId);
            this.roomsByCode.delete(room.code);
            if (room.roomKey) this.roomsByRoomKey.delete(room.roomKey);
          }
          break;
      }
    }
  }

  /** Drives one authoritative loop pass (also used as the 20 Hz entry point). */
  tickNow() {
    this.loop();
  }
}

// Broadcast room:state on any event the lobby UI cares about.
function touch(roomId: string, out: { events: GameEvents }, room: RoomSession, store: RoomStore) {
  store.emit(roomId, out.events);
  return out;
}

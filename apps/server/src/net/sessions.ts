// Session identity mapping: ties socket connections to server-minted
// participants. Client-supplied identity is never trusted (Phase C).
import { RoomStore } from '../game/store.js';

export interface SessionRecord {
  roomId: string;
  participantId: string;
  connected: boolean;
}

export class SessionRegistry {
  /** socketId -> session. */

  private bySocket = new Map<string, SessionRecord>();
  private byParticipant = new Map<string, Set<string>>(); // participantId -> socketIds
  /** A socket is considered dead if Socket.IO no longer tracks it; verified
   * via the predicate injected at construction (real server checks io.of(
   * ...).sockets, tests return true to allow takeover). */

  constructor(
    private store: RoomStore,
    private socketAlive: (socketId: string) => boolean = () => true,
  ) {}

  authenticate(socketId: string, roomId: string, participantId: string, sessionToken: string): { errors: { code: string; message: string }[] } {
    const expectedToken = this.store.tokenFor(participantId);
    if (!expectedToken || expectedToken !== sessionToken) {
      return { errors: [{ code: 'SUBSCRIBE_AUTH', message: 'Invalid room membership or session token.' }] };
    }
    // One active socket per participant (SYS.md §5). Stale socket entries from
    // a dropped connection without disconnect event are evicted (reconnect path).
    const existing = this.byParticipant.get(participantId);
    if (existing) {
      for (const sid of [...existing]) {
        if (sid !== socketId && !this.socketAlive(sid)) {
          evict(this.bySocket, existing, sid);
        }
      }
      if (existing.size > 0 && !existing.has(socketId)) {
        return { errors: [{ code: 'SUBSCRIBE_AUTH', message: 'Another connection is already active for this participant.' }] };
      }
    }
    this.bySocket.set(socketId, { roomId, participantId, connected: true });
    const set = this.byParticipant.get(participantId) ?? new Set<string>();
    set.add(socketId);
    this.byParticipant.set(participantId, set);
    return { errors: [] };
  }

  get(socketId: string): SessionRecord | undefined {
    return this.bySocket.get(socketId);
  }

  disconnect(socketId: string) {
    const rec = this.bySocket.get(socketId);
    if (!rec) return;
    rec.connected = false;
    this.bySocket.delete(socketId);
    const set = this.byParticipant.get(rec.participantId);
    if (set) {
      set.delete(socketId);
      if (set.size === 0) {
        this.byParticipant.delete(rec.participantId);
        this.store.disconnect(rec.roomId, rec.participantId);
      }
    }
  }
}

function evict(bySocket: Map<string, SessionRecord>, set: Set<string>, socketId: string) {
  bySocket.delete(socketId);
  set.delete(socketId);
}

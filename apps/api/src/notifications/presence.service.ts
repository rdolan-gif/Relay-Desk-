import { Injectable } from '@nestjs/common';

interface Seen {
  userId: string;
  name: string;
  editing: boolean;
  at: number;
}

const TTL = 30_000;

/**
 * Who else has a ticket open (spec 13, "Presence"). Each open ticket screen sends a
 * heartbeat every few seconds; viewers drop off 30 seconds after their last one.
 */
@Injectable()
export class PresenceService {
  private readonly tickets = new Map<number, Map<string, Seen>>();

  beat(ticketId: number, user: { id: string; name: string }, editing: boolean, now = Date.now()) {
    let m = this.tickets.get(ticketId);
    if (!m) {
      m = new Map();
      this.tickets.set(ticketId, m);
    }
    m.set(user.id, { userId: user.id, name: user.name, editing, at: now });
    return this.others(ticketId, user.id, now);
  }

  leave(ticketId: number, userId: string) {
    this.tickets.get(ticketId)?.delete(userId);
  }

  others(ticketId: number, userId: string, now = Date.now()) {
    const m = this.tickets.get(ticketId);
    if (!m) return [];
    for (const [id, s] of m) if (now - s.at > TTL) m.delete(id);
    return [...m.values()]
      .filter((s) => s.userId !== userId)
      .map(({ userId: id, name, editing }) => ({ userId: id, name, editing }))
      .sort((a, b) => Number(b.editing) - Number(a.editing) || a.name.localeCompare(b.name));
  }
}

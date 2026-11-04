import { Injectable } from '@nestjs/common';
import { interval, map, merge, Observable, Subject } from 'rxjs';

export interface RealtimeMessage {
  type: 'notification' | 'unread';
  data: unknown;
}

/**
 * Pushes events to a user's open browser tabs (spec 13, "Real-time push"). Uses Server-Sent
 * Events over the existing session cookie; one API process, so an in-memory hub is enough.
 */
@Injectable()
export class RealtimeService {
  private readonly hubs = new Map<string, Subject<RealtimeMessage>>();

  private hub(userId: string) {
    let h = this.hubs.get(userId);
    if (!h) {
      h = new Subject<RealtimeMessage>();
      this.hubs.set(userId, h);
    }
    return h;
  }

  push(userId: string, msg: RealtimeMessage) {
    this.hubs.get(userId)?.next(msg);
  }

  /** The stream for one browser tab, with a keep-alive so proxies don't drop it. */
  stream(userId: string): Observable<{ type?: string; data: unknown }> {
    return merge(
      this.hub(userId).pipe(map((m) => ({ type: m.type, data: m.data }))),
      interval(25_000).pipe(map(() => ({ type: 'ping', data: {} }))),
    );
  }
}

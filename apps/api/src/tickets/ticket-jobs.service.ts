import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config';
import { TicketsService } from './tickets.service';

/**
 * Minute-by-minute ticket housekeeping: re-open due tickets and auto-archive (spec 6.3).
 * A simple in-process timer for now; it moves to the BullMQ worker when the job queue
 * arrives with email (Phase 3). Disabled in tests, which call the methods directly.
 */
@Injectable()
export class TicketJobsService implements OnModuleInit, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private readonly log = new Logger('TicketJobs');

  constructor(
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), 60_000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    try {
      const reopened = await this.tickets.reopenDue(now);
      const archived = await this.tickets.autoArchive(now);
      if (reopened.length || archived.length) this.log.log(`reopened ${reopened.length}, archived ${archived.length}`);
    } catch (err) {
      this.log.error(err);
    }
  }
}

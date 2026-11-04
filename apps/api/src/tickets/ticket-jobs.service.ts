import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config';
import { NotificationsService } from '../notifications/notifications.service';
import { DistributionService } from '../sla/distribution.service';
import { SlaService } from '../sla/sla.service';
import { TicketsService } from './tickets.service';

/**
 * Minute-by-minute ticket housekeeping: re-open due tickets and auto-archive (spec 6.3),
 * decide SLA outcomes whose deadline passed (spec 8) and retry the distribution backlog (spec 9).
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
    @Inject(SlaService) private readonly sla: SlaService,
    @Inject(DistributionService) private readonly distribution: DistributionService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
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
      const decided = await this.sla.decideDue(now);
      // Safety net for distribution (spec 9); runs are cheap when there is no backlog.
      const assigned = await this.distribution.run(undefined, now);
      await this.notifications.slaSweep(now);
      if (reopened.length || archived.length || assigned.length)
        this.log.log(
          `reopened ${reopened.length}, archived ${archived.length}, distributed ${assigned.length}, SLA checked ${decided}`,
        );
    } catch (err) {
      this.log.error(err);
    }
  }
}

import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { CONFIG, type AppConfig } from '../config/config';
import { InboundService } from './inbound.service';

/** Checks every connected mailbox every MAIL_POLL_SECONDS (spec 11.1: 60 s default). Off in tests. */
@Injectable()
export class MailJobsService implements OnModuleInit, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly log = new Logger('MailJobs');

  constructor(
    @Inject(InboundService) private readonly inbound: InboundService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  onModuleInit() {
    if (this.config.NODE_ENV === 'test') return;
    this.timer = setInterval(() => void this.tick(), this.config.MAIL_POLL_SECONDS * 1000);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.inbound.syncAll();
    } catch (err) {
      this.log.error(err);
    } finally {
      this.running = false;
    }
  }
}

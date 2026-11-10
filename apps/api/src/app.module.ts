import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Pool } from 'pg';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { GoogleSignInService } from './auth/google-signin.service';
import { PasswordService } from './auth/password.service';
import { PermissionsService } from './auth/permissions.service';
import { SessionService } from './auth/session.service';
import { SECRET_BOX, SecretBox } from './common/crypto';
import { CONFIG, type AppConfig } from './config/config';
import { DB, PG_POOL, createDb, createPool } from './db/db';
import { HealthController } from './health/health.controller';
import { AccessProfilesController, RightsProfilesController } from './profiles/profiles.controller';
import { ProfilesService } from './profiles/profiles.service';
import { UserDirectoryController, UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { AccountsService } from './crm/accounts.service';
import { ContactsService } from './crm/contacts.service';
import {
  AccountsController,
  ContactsController,
  CrmMetaController,
  ListSettingsController,
  RecordsController,
} from './crm/crm.controller';
import { CrmDatabasesController, CustomFieldsController, RecordTypesController } from './crm/crm-settings.controller';
import { CrmSettingsService } from './crm/crm-settings.service';
import { CustomFieldsService } from './crm/custom-fields.service';
import { ListSettingsService } from './crm/list-settings.service';
import { RecordsService } from './crm/records.service';
import { HistoryService } from './history/history.service';
import { SearchController } from './search/search.controller';
import { SearchService } from './search/search.service';
import { ActivitiesService } from './tickets/activities.service';
import { TicketJobsService } from './tickets/ticket-jobs.service';
import { TicketSettingsService } from './tickets/ticket-settings.service';
import {
  CategoriesController,
  StatusesController,
  TeamViewsController,
  TicketMetaController,
  TicketsController,
  TicketViewsController,
} from './tickets/tickets.controller';
import { TicketsService } from './tickets/tickets.service';
import { ViewsService } from './tickets/views.service';
import {
  EmailController,
  GoogleCallbackController,
  MailboxSettingsController,
  RoutingRulesController,
  TemplatesController,
} from './email/email.controller';
import { GmailProvider } from './email/gmail.provider';
import { GoogleOAuthService } from './email/google-oauth.service';
import { InboundService } from './email/inbound.service';
import { MailJobsService } from './email/mail-jobs.service';
import { MailboxesService } from './email/mailboxes.service';
import { OutboundService } from './email/outbound.service';
import { FakeMailProvider, MAIL_PROVIDERS, type MailProviders } from './email/providers';
import { RoutingRulesService } from './email/routing-rules.service';
import { TemplatesService } from './email/templates.service';
import { StorageService } from './storage/storage.service';
import { DistributionService } from './sla/distribution.service';
import { QueueLoginController, SlaController, SlaOptionsController, TimeGroupsController } from './sla/sla.controller';
import { SlaService } from './sla/sla.service';
import { SlaSettingsService } from './sla/sla-settings.service';
import { MacrosController, TicketMacrosController } from './macros/macros.controller';
import { MacrosService } from './macros/macros.service';
import { NotificationsController, PresenceController } from './notifications/notifications.controller';
import { NotificationsService } from './notifications/notifications.service';
import { PresenceService } from './notifications/presence.service';
import { RealtimeService } from './notifications/realtime.service';
import { DataController } from './data/data.controller';
import { DataService } from './data/data.service';
import { BulkService } from './data/deleted.service';
import { MergeService } from './data/merge.service';
import { GdprService } from './gdpr/gdpr.service';
import { JobsController } from './jobs/jobs.controller';
import { JobsService } from './jobs/jobs.service';
import { KbController } from './kb/kb.controller';
import { KbService } from './kb/kb.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';

class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

/**
 * Modular monolith root. Phase 0 keeps the foundation modules in one Nest module;
 * later phases add one module per spec area (tickets, crm, email, ...).
 */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        UsersController,
        UserDirectoryController,
        AccessProfilesController,
        RightsProfilesController,
        AuditController,
        CustomFieldsController,
        CrmDatabasesController,
        RecordTypesController,
        CrmMetaController,
        ContactsController,
        AccountsController,
        RecordsController,
        ListSettingsController,
        SearchController,
        StatusesController,
        CategoriesController,
        TeamViewsController,
        // Static ticket paths before /tickets/:id
        TicketMetaController,
        TicketViewsController,
        TicketsController,
        MailboxSettingsController,
        GoogleCallbackController,
        RoutingRulesController,
        TemplatesController,
        EmailController,
        SlaController,
        TimeGroupsController,
        QueueLoginController,
        SlaOptionsController,
        NotificationsController,
        PresenceController,
        MacrosController,
        TicketMacrosController,
        JobsController,
        DataController,
        ReportsController,
        KbController,
      ],
      providers: [
        ReportsService,
        KbService,
        JobsService,
        GdprService,
        DataService,
        MergeService,
        BulkService,
        RealtimeService,
        PresenceService,
        NotificationsService,
        MacrosService,
        SlaService,
        SlaSettingsService,
        DistributionService,
        { provide: CONFIG, useValue: config },
        { provide: PG_POOL, useFactory: () => createPool(config.DATABASE_URL) },
        { provide: DB, useFactory: (pool: Pool) => createDb(pool), inject: [PG_POOL] },
        { provide: SECRET_BOX, useFactory: () => new SecretBox(config.ENCRYPTION_KEY) },
        PoolCloser,
        AuditService,
        PasswordService,
        SessionService,
        PermissionsService,
        AuthService,
        GoogleSignInService,
        ProfilesService,
        UsersService,
        HistoryService,
        CustomFieldsService,
        CrmSettingsService,
        ContactsService,
        AccountsService,
        RecordsService,
        ListSettingsService,
        SearchService,
        TicketSettingsService,
        TicketsService,
        ActivitiesService,
        ViewsService,
        TicketJobsService,
        StorageService,
        GoogleOAuthService,
        MailboxesService,
        RoutingRulesService,
        TemplatesService,
        OutboundService,
        InboundService,
        MailJobsService,
        FakeMailProvider,
        {
          provide: MAIL_PROVIDERS,
          useFactory: (fake: FakeMailProvider): MailProviders => ({
            gmail: new GmailProvider(() => ({
              clientId: config.GOOGLE_CLIENT_ID,
              clientSecret: config.GOOGLE_CLIENT_SECRET,
            })),
            fake,
          }),
          inject: [FakeMailProvider],
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}

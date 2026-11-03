import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { Pool } from 'pg';
import { AuditController } from './audit/audit.controller';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { AuthService } from './auth/auth.service';
import { PasswordService } from './auth/password.service';
import { PermissionsService } from './auth/permissions.service';
import { SessionService } from './auth/session.service';
import { SECRET_BOX, SecretBox } from './common/crypto';
import { CONFIG, type AppConfig } from './config/config';
import { DB, PG_POOL, createDb, createPool } from './db/db';
import { HealthController } from './health/health.controller';
import { AccessProfilesController, RightsProfilesController } from './profiles/profiles.controller';
import { ProfilesService } from './profiles/profiles.service';
import { UsersController } from './users/users.controller';
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
      ],
      providers: [
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
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}

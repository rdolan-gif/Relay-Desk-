import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import type { z } from 'zod';
import { Auth, AuthenticatedOnly, RequireAccess } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthContext } from '../common/request-context';
import { crmRecords } from '../db/schema';
import { AccountsService } from './accounts.service';
import { ContactsService } from './contacts.service';
import { filterFields, listQuerySchema, type ListQuery } from './crm-common';
import { CrmSettingsService } from './crm-settings.service';
import { CustomFieldsService } from './custom-fields.service';
import { ListSettingsService } from './list-settings.service';
import { RecordsService } from './records.service';
import {
  accountCreateSchema,
  accountUpdateSchema,
  columnsSchema,
  contactCreateSchema,
  contactUpdateSchema,
  duplicateCheckSchema,
  filterSchemeSchema,
  listNameSchema,
  recordCreateSchema,
  recordUpdateSchema,
  snapshotQuerySchema,
} from './schemas';

const listPipe = new ZodPipe(listQuerySchema);
const snapPipe = new ZodPipe(snapshotQuerySchema);

/** What agents need to render CRM forms and filters: visible databases/types and the field pool. */
@ApiTags('crm')
@Controller('crm/meta')
export class CrmMetaController {
  constructor(
    @Inject(CrmSettingsService) private readonly settings: CrmSettingsService,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
  ) {}

  @AuthenticatedOnly()
  @Get()
  async meta(@Auth() auth: AuthContext) {
    const customFields = await this.fields.list();
    return {
      databases: await this.settings.listDatabases(auth),
      recordTypes: await this.settings.listRecordTypes(auth),
      customFields,
      filterFields: Object.fromEntries(
        (['contacts', 'accounts', 'records'] as const).map((l) => [l, filterFields(l, customFields)]),
      ),
    };
  }
}

@ApiTags('crm')
@Controller('crm/contacts')
export class ContactsController {
  constructor(
    @Inject(ContactsService) private readonly contacts: ContactsService,
    @Inject(RecordsService) private readonly records: RecordsService,
  ) {}

  @RequireAccess('crm_contacts', 'read')
  @Get()
  list(@Auth() auth: AuthContext, @Query(listPipe) q: ListQuery) {
    return this.contacts.list(auth, q);
  }

  @RequireAccess('crm_contacts', 'read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.get(auth, id);
  }

  @RequireAccess('crm_contacts', 'read')
  @Get(':id/history')
  history(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.contacts.historyOf(auth, id);
  }

  @RequireAccess('crm_contacts', 'read')
  @Get(':id/snapshot')
  snapshot(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query(snapPipe) q: { at: Date }) {
    return this.contacts.snapshot(auth, id, q.at);
  }

  @RequireAccess('crm_records', 'read')
  @Get(':id/records')
  async recordsOf(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query(listPipe) q: ListQuery) {
    await this.contacts.find(auth, id);
    return this.records.list(auth, q, [eq(crmRecords.contactId, id)]);
  }

  @RequireAccess('crm_contacts', 'read')
  @Post('duplicate-check')
  @HttpCode(200)
  duplicates(
    @Auth() auth: AuthContext,
    @Body(new ZodPipe(duplicateCheckSchema)) body: z.infer<typeof duplicateCheckSchema>,
  ) {
    return this.contacts.findDuplicates(auth, body);
  }

  @RequireAccess('crm_contacts', 'create')
  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(contactCreateSchema)) body: z.infer<typeof contactCreateSchema>) {
    return this.contacts.create(auth, body);
  }

  @RequireAccess('crm_contacts', 'update')
  @Patch(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(contactUpdateSchema)) body: z.infer<typeof contactUpdateSchema>,
  ) {
    return this.contacts.update(auth, id, body);
  }

  @RequireAccess('crm_contacts', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.contacts.remove(auth, id);
  }
}

@ApiTags('crm')
@Controller('crm/accounts')
export class AccountsController {
  constructor(
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(RecordsService) private readonly records: RecordsService,
  ) {}

  @RequireAccess('crm_accounts', 'read')
  @Get()
  list(@Auth() auth: AuthContext, @Query(listPipe) q: ListQuery) {
    return this.accounts.list(auth, q);
  }

  @RequireAccess('crm_accounts', 'read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.get(auth, id);
  }

  @RequireAccess('crm_accounts', 'read')
  @Get(':id/contacts')
  contactsOf(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.contactsOf(auth, id);
  }

  @RequireAccess('crm_records', 'read')
  @Get(':id/records')
  async recordsOf(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query(listPipe) q: ListQuery) {
    await this.accounts.find(auth, id);
    return this.records.list(auth, q, [eq(crmRecords.accountId, id)]);
  }

  @RequireAccess('crm_accounts', 'read')
  @Get(':id/history')
  history(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.historyOf(auth, id);
  }

  @RequireAccess('crm_accounts', 'read')
  @Get(':id/snapshot')
  snapshot(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query(snapPipe) q: { at: Date }) {
    return this.accounts.snapshot(auth, id, q.at);
  }

  @RequireAccess('crm_accounts', 'create')
  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(accountCreateSchema)) body: z.infer<typeof accountCreateSchema>) {
    return this.accounts.create(auth, body);
  }

  @RequireAccess('crm_accounts', 'update')
  @Patch(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(accountUpdateSchema)) body: z.infer<typeof accountUpdateSchema>,
  ) {
    return this.accounts.update(auth, id, body);
  }

  @RequireAccess('crm_accounts', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.accounts.remove(auth, id);
  }
}

@ApiTags('crm')
@Controller('crm/records')
export class RecordsController {
  constructor(@Inject(RecordsService) private readonly records: RecordsService) {}

  @RequireAccess('crm_records', 'read')
  @Get()
  list(@Auth() auth: AuthContext, @Query(listPipe) q: ListQuery) {
    return this.records.list(auth, q);
  }

  @RequireAccess('crm_records', 'read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.records.get(auth, id);
  }

  @RequireAccess('crm_records', 'read')
  @Get(':id/history')
  history(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.records.historyOf(auth, id);
  }

  @RequireAccess('crm_records', 'read')
  @Get(':id/snapshot')
  snapshot(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Query(snapPipe) q: { at: Date }) {
    return this.records.snapshot(auth, id, q.at);
  }

  @RequireAccess('crm_records', 'create')
  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(recordCreateSchema)) body: z.infer<typeof recordCreateSchema>) {
    return this.records.create(auth, body);
  }

  @RequireAccess('crm_records', 'update')
  @Patch(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(recordUpdateSchema)) body: z.infer<typeof recordUpdateSchema>,
  ) {
    return this.records.update(auth, id, body);
  }

  @RequireAccess('crm_records', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.records.remove(auth, id);
  }
}

/** Per-user saved filters and column choices. Users only ever see their own. */
@ApiTags('crm')
@Controller('me/lists')
export class ListSettingsController {
  constructor(@Inject(ListSettingsService) private readonly svc: ListSettingsService) {}

  @AuthenticatedOnly()
  @Get(':list/filter-schemes')
  schemes(@Auth() auth: AuthContext, @Param(new ZodPipe(listNameSchema)) p: z.infer<typeof listNameSchema>) {
    return this.svc.listSchemes(auth, p.list);
  }

  @AuthenticatedOnly()
  @Post('filter-schemes')
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(filterSchemeSchema)) body: z.infer<typeof filterSchemeSchema>) {
    return this.svc.saveScheme(auth, body);
  }

  @AuthenticatedOnly()
  @Put('filter-schemes/:id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(filterSchemeSchema)) body: z.infer<typeof filterSchemeSchema>,
  ) {
    return this.svc.saveScheme(auth, { ...body, id });
  }

  @AuthenticatedOnly()
  @Delete('filter-schemes/:id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.deleteScheme(auth, id);
  }

  @AuthenticatedOnly()
  @Get(':list/columns')
  async columns(@Auth() auth: AuthContext, @Param(new ZodPipe(listNameSchema)) p: z.infer<typeof listNameSchema>) {
    return { columns: await this.svc.getColumns(auth, p.list) };
  }

  @AuthenticatedOnly()
  @Put(':list/columns')
  setColumns(
    @Auth() auth: AuthContext,
    @Param(new ZodPipe(listNameSchema)) p: z.infer<typeof listNameSchema>,
    @Body(new ZodPipe(columnsSchema)) body: z.infer<typeof columnsSchema>,
  ) {
    return this.svc.setColumns(auth, p.list, body.columns);
  }
}

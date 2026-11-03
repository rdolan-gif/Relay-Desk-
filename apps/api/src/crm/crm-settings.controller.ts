import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { Auth, RequireAccess } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AppRequest, type AuthContext } from '../common/request-context';
import { CrmSettingsService } from './crm-settings.service';
import { CustomFieldsService } from './custom-fields.service';
import { crmDatabaseSchema, customFieldSchema, recordTypeSchema } from './schemas';

@ApiTags('settings')
@Controller('settings/custom-fields')
export class CustomFieldsController {
  constructor(@Inject(CustomFieldsService) private readonly fields: CustomFieldsService) {}

  @RequireAccess('settings_custom_fields', 'read')
  @Get()
  list() {
    return this.fields.list();
  }

  @RequireAccess('settings_custom_fields', 'read')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.fields.get(id);
  }

  @RequireAccess('settings_custom_fields', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(customFieldSchema)) body: z.infer<typeof customFieldSchema>,
  ) {
    return this.fields.create(auth, { ...body, defaultValue: body.defaultValue ?? null }, clientIp(req));
  }

  @RequireAccess('settings_custom_fields', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(customFieldSchema)) body: z.infer<typeof customFieldSchema>,
  ) {
    return this.fields.update(auth, id, { ...body, defaultValue: body.defaultValue ?? null }, clientIp(req));
  }

  @RequireAccess('settings_custom_fields', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.fields.remove(auth, id, clientIp(req));
  }
}

@ApiTags('settings')
@Controller('settings/crm-databases')
export class CrmDatabasesController {
  constructor(@Inject(CrmSettingsService) private readonly svc: CrmSettingsService) {}

  @RequireAccess('settings_crm_databases', 'read')
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.svc.listDatabases(auth);
  }

  @RequireAccess('settings_crm_databases', 'read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getDatabase(auth, id);
  }

  @RequireAccess('settings_crm_databases', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(crmDatabaseSchema)) body: z.infer<typeof crmDatabaseSchema>,
  ) {
    return this.svc.createDatabase(auth, body, clientIp(req));
  }

  @RequireAccess('settings_crm_databases', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(crmDatabaseSchema)) body: z.infer<typeof crmDatabaseSchema>,
  ) {
    return this.svc.updateDatabase(auth, id, body, clientIp(req));
  }

  @RequireAccess('settings_crm_databases', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.deleteDatabase(auth, id, clientIp(req));
  }
}

@ApiTags('settings')
@Controller('settings/crm-record-types')
export class RecordTypesController {
  constructor(@Inject(CrmSettingsService) private readonly svc: CrmSettingsService) {}

  @RequireAccess('settings_crm_record_types', 'read')
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.svc.listRecordTypes(auth);
  }

  @RequireAccess('settings_crm_record_types', 'read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getRecordType(auth, id);
  }

  @RequireAccess('settings_crm_record_types', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(recordTypeSchema)) body: z.infer<typeof recordTypeSchema>,
  ) {
    return this.svc.createRecordType(auth, body, clientIp(req));
  }

  @RequireAccess('settings_crm_record_types', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(recordTypeSchema)) body: z.infer<typeof recordTypeSchema>,
  ) {
    return this.svc.updateRecordType(auth, id, body, clientIp(req));
  }

  @RequireAccess('settings_crm_record_types', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.deleteRecordType(auth, id, clientIp(req));
  }
}

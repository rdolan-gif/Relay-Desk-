import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { checkModuleAccess, type ModuleKey } from '@relay-desk/domain';
import { Auth, AuthenticatedOnly, RequireAccess, RequireFlag } from '../auth/decorators';
import { clientIp, type AppRequest, type AuthContext } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { listQuerySchema } from '../crm/crm-common';
import { GdprService } from '../gdpr/gdpr.service';
import { ViewsService } from '../tickets/views.service';
import { DataService, type ExportEntity } from './data.service';
import { BulkService, type DeletedType } from './deleted.service';
import { MergeService } from './merge.service';

const MODULE: Record<ExportEntity, ModuleKey> = {
  contacts: 'crm_contacts',
  accounts: 'crm_accounts',
  tickets: 'tickets',
};
const exportQuery = listQuerySchema.extend({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  columns: z.string().max(5000).default(''),
  viewId: z.string().uuid().optional(),
});
const entity = z.enum(['contacts', 'accounts']);
const importSchema = z.object({
  fileId: z.string().uuid(),
  entity,
  databaseId: z.string().uuid(),
  mapping: z.record(z.string().max(200), z.string().max(200)),
  duplicate: z.enum(['skip', 'update', 'create']).default('skip'),
  matchOn: z.enum(['email', 'phone']).default('email'),
});
const templateSchema = z.object({
  entity,
  name: z.string().trim().min(1).max(100),
  mapping: z.record(z.string().max(200), z.string().max(200)),
});
const mergeSchema = z.object({
  survivorId: z.string().uuid(),
  ids: z.array(z.string().uuid()).min(2).max(20),
  choices: z.record(z.string().max(200), z.string().max(100)).default({}),
});
const idsSchema = z.object({
  ids: z
    .array(z.union([z.string().uuid(), z.number().int().positive()]))
    .min(1)
    .max(5000),
});
const confirmSchema = z.object({ confirmation: z.string().max(100) });

function need(auth: AuthContext, module: ModuleKey, verb: 'read' | 'update' | 'delete') {
  if (!checkModuleAccess(auth.principal, module, verb).allowed)
    throw new ForbiddenException({ message: 'You do not have access to this.', reason: 'verb_not_granted' });
}

@ApiTags('data')
@Controller()
export class DataController {
  constructor(
    @Inject(DataService) private readonly data: DataService,
    @Inject(MergeService) private readonly merges: MergeService,
    @Inject(BulkService) private readonly bulk: BulkService,
    @Inject(GdprService) private readonly gdpr: GdprService,
    @Inject(ViewsService) private readonly views: ViewsService,
  ) {}

  // ----- export (needs the export access flag)

  @RequireFlag('can_export')
  @Get('exports/:entity')
  async export(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('entity') name: string,
    @Query(new ZodPipe(exportQuery)) q: z.infer<typeof exportQuery>,
    @Res() res: Response,
  ) {
    const e = z.enum(['contacts', 'accounts', 'tickets']).parse(name);
    need(auth, MODULE[e], 'read');
    const extra = e === 'tickets' && q.viewId ? await this.views.conditionsOf(auth, q.viewId) : [];
    const { format, columns, viewId: _v, ...list } = q;
    const f = await this.data.export(auth, e, list, columns.split(',').filter(Boolean), format, clientIp(req), extra);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${f.name}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(f.data);
  }

  @RequireFlag('can_export')
  @Post('exports/tickets/emails')
  async exportEmails(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(exportQuery)) q: z.infer<typeof exportQuery>,
  ) {
    need(auth, 'tickets', 'read');
    const extra = q.viewId ? await this.views.conditionsOf(auth, q.viewId) : [];
    const { format: _f, columns: _c, viewId: _v, ...list } = q;
    return this.data.exportTicketEmails(auth, list, clientIp(req), extra);
  }

  // ----- import (needs the import access flag)

  @RequireFlag('can_import_crm_data')
  @Post('imports/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  upload(
    @Auth() auth: AuthContext,
    @UploadedFile() file: { originalname: string; mimetype: string; buffer: Buffer } | undefined,
  ) {
    if (!file) throw new ForbiddenException({ message: 'No file received.', reason: 'no_file' });
    return this.data.upload(auth, file);
  }

  @RequireFlag('can_import_crm_data')
  @Post('imports')
  runImport(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(importSchema)) body: z.infer<typeof importSchema>,
  ) {
    need(auth, body.entity === 'contacts' ? 'crm_contacts' : 'crm_accounts', 'update');
    return this.data.runImport(auth, body, clientIp(req));
  }

  @RequireFlag('can_import_crm_data')
  @Get('imports/templates')
  templates(@Query('entity') e: string) {
    return this.data.listTemplates(entity.parse(e));
  }

  @RequireFlag('can_import_crm_data')
  @Post('imports/templates')
  saveTemplate(@Auth() auth: AuthContext, @Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>) {
    return this.data.saveTemplate(auth, body);
  }

  @RequireFlag('can_import_crm_data')
  @Delete('imports/templates/:id')
  @HttpCode(204)
  async deleteTemplate(@Param('id', ParseUUIDPipe) id: string) {
    await this.data.deleteTemplate(id);
  }

  // ----- merge (spec 12.4)

  @RequireAccess('crm_contacts', 'update')
  @Post('crm/contacts/merge')
  @HttpCode(200)
  mergeContacts(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(mergeSchema)) b: z.infer<typeof mergeSchema>,
  ) {
    return this.merges.mergeContacts(auth, b.survivorId, b.ids, b.choices, clientIp(req));
  }

  @RequireAccess('crm_accounts', 'update')
  @Post('crm/accounts/merge')
  @HttpCode(200)
  mergeAccounts(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(mergeSchema)) b: z.infer<typeof mergeSchema>,
  ) {
    return this.merges.mergeAccounts(auth, b.survivorId, b.ids, b.choices, clientIp(req));
  }

  // ----- bulk delete and recovery (spec 14)

  @RequireAccess('crm_contacts', 'delete')
  @Post('crm/contacts/bulk-delete')
  @HttpCode(200)
  deleteContacts(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(idsSchema)) b: z.infer<typeof idsSchema>,
  ) {
    return this.bulk.bulkDelete(auth, 'contacts', b.ids, clientIp(req));
  }

  @RequireAccess('crm_accounts', 'delete')
  @Post('crm/accounts/bulk-delete')
  @HttpCode(200)
  deleteAccounts(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(idsSchema)) b: z.infer<typeof idsSchema>,
  ) {
    return this.bulk.bulkDelete(auth, 'accounts', b.ids, clientIp(req));
  }

  @RequireFlag('can_delete_tickets')
  @Post('tickets/bulk-delete')
  @HttpCode(200)
  deleteTickets(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(idsSchema)) b: z.infer<typeof idsSchema>,
  ) {
    need(auth, 'tickets', 'delete');
    return this.bulk.bulkDelete(auth, 'tickets', b.ids, clientIp(req));
  }

  @AuthenticatedOnly()
  @Get('deleted/:type')
  deleted(@Auth() auth: AuthContext, @Param('type') type: string) {
    return this.bulk.listDeleted(auth, z.enum(['tickets', 'contacts', 'accounts']).parse(type) as DeletedType);
  }

  @AuthenticatedOnly()
  @Post('deleted/:type/:id/restore')
  @HttpCode(200)
  restore(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('type') type: string, @Param('id') id: string) {
    return this.bulk.restore(
      auth,
      z.enum(['tickets', 'contacts', 'accounts']).parse(type) as DeletedType,
      id,
      clientIp(req),
    );
  }

  // ----- GDPR (spec 14)

  @RequireFlag('can_anonymise')
  @Post('tickets/:id/anonymise')
  @HttpCode(200)
  anonymise(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(confirmSchema)) b: z.infer<typeof confirmSchema>,
  ) {
    need(auth, 'tickets', 'update');
    return this.gdpr.anonymiseTicket(auth, id, b.confirmation, clientIp(req));
  }

  @RequireFlag('can_anonymise')
  @Post('crm/contacts/:id/erase')
  @HttpCode(200)
  erase(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(confirmSchema)) b: z.infer<typeof confirmSchema>,
  ) {
    need(auth, 'crm_contacts', 'update');
    return this.gdpr.eraseContact(auth, id, b.confirmation, clientIp(req));
  }

  @RequireFlag('can_export')
  @Post('crm/contacts/:id/subject-access-export')
  @HttpCode(200)
  sar(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    need(auth, 'crm_contacts', 'read');
    return this.gdpr.subjectAccessExport(auth, id, clientIp(req));
  }
}

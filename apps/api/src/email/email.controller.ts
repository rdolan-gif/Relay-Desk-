import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import type { z } from 'zod';
import { checkModuleAccess } from '@relay-desk/domain';
import { Auth, AuthenticatedOnly, Public, RequireAccess } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AppRequest, type AuthContext } from '../common/request-context';
import { CONFIG, type AppConfig } from '../config/config';
import { DB, type Db } from '../db/db';
import { activities, attachments } from '../db/schema';
import { StorageService } from '../storage/storage.service';
import { TicketsService } from '../tickets/tickets.service';
import { GoogleOAuthService } from './google-oauth.service';
import { InboundService } from './inbound.service';
import { MailboxesService } from './mailboxes.service';
import { MAX_ATTACHMENT_BYTES, OutboundService } from './outbound.service';
import { RoutingRulesService } from './routing-rules.service';
import { TemplatesService } from './templates.service';
import {
  listTemplatesSchema,
  mailboxSchema,
  renderSchema,
  reorderSchema,
  routingRuleSchema,
  sendSchema,
  templateSchema,
} from './email.schemas';

@ApiTags('settings')
@Controller('settings/mailboxes')
export class MailboxSettingsController {
  constructor(
    @Inject(MailboxesService) private readonly mailboxes: MailboxesService,
    @Inject(GoogleOAuthService) private readonly google: GoogleOAuthService,
    @Inject(InboundService) private readonly inbound: InboundService,
  ) {}

  @RequireAccess('settings_mailbox_queues', 'read')
  @Get()
  async list() {
    return {
      mailboxes: await this.mailboxes.list(),
      googleConfigured: this.google.configured,
      redirectUri: this.google.redirectUri,
    };
  }

  @RequireAccess('settings_mailbox_queues', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(mailboxSchema)) body: z.infer<typeof mailboxSchema>,
  ) {
    return this.mailboxes.create(auth, body, clientIp(req));
  }

  @RequireAccess('settings_mailbox_queues', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(mailboxSchema)) body: z.infer<typeof mailboxSchema>,
  ) {
    return this.mailboxes.update(auth, id, body, clientIp(req));
  }

  @RequireAccess('settings_mailbox_queues', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.mailboxes.remove(auth, id, clientIp(req));
  }

  /** Starts Google sign-in for this mailbox; the browser goes to the returned URL. */
  @RequireAccess('settings_mailbox_queues', 'update')
  @Post(':id/connect')
  @HttpCode(200)
  async connect(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    const box = await this.mailboxes.find(id);
    return { url: this.google.authUrl(id, auth.user.id, box.address) };
  }

  @RequireAccess('settings_mailbox_queues', 'update')
  @Post(':id/disconnect')
  @HttpCode(204)
  async disconnect(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.mailboxes.disconnect(auth, id, clientIp(req));
  }

  @RequireAccess('settings_mailbox_queues', 'update')
  @Post(':id/sync')
  @HttpCode(200)
  async sync(@Param('id', ParseUUIDPipe) id: string) {
    const outcomes = await this.inbound.syncMailbox(id);
    return { processed: outcomes.length, outcomes };
  }

  @RequireAccess('settings_mailbox_queues', 'read')
  @Get(':id/log')
  log(@Param('id', ParseUUIDPipe) id: string) {
    return this.inbound.recentLog(id);
  }
}

/** Google redirects here after sign-in. The signed state says which mailbox and user. */
@ApiTags('settings')
@Controller('oauth/google')
export class GoogleCallbackController {
  constructor(
    @Inject(GoogleOAuthService) private readonly google: GoogleOAuthService,
    @Inject(MailboxesService) private readonly mailboxes: MailboxesService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Get('callback')
  async callback(@Query() q: { code?: string; state?: string; error?: string }, @Res() res: Response) {
    const back = (params: Record<string, string>) =>
      res.redirect(`${this.config.PUBLIC_URL.replace(/\/$/, '')}/settings/mailboxes?${new URLSearchParams(params)}`);
    try {
      if (q.error || !q.code || !q.state) return back({ error: q.error ?? 'cancelled' });
      const { queueId, userId } = this.google.verifyState(q.state);
      const { refreshToken, email } = await this.google.exchange(q.code);
      await this.mailboxes.connect(queueId, userId, email, refreshToken);
      return back({ connected: email });
    } catch (err) {
      const message =
        (err as { response?: { message?: string } }).response?.message ??
        (err instanceof Error ? err.message : 'Sign-in failed');
      return back({ error: message });
    }
  }
}

@ApiTags('settings')
@Controller('settings/email-routing')
export class RoutingRulesController {
  constructor(@Inject(RoutingRulesService) private readonly rules: RoutingRulesService) {}

  @RequireAccess('settings_email_routing', 'read')
  @Get()
  list() {
    return this.rules.list();
  }

  @RequireAccess('settings_email_routing', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(routingRuleSchema)) body: z.infer<typeof routingRuleSchema>,
  ) {
    return this.rules.create(auth, body, clientIp(req));
  }

  @RequireAccess('settings_email_routing', 'update')
  @Put('order')
  reorder(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(reorderSchema)) body: z.infer<typeof reorderSchema>,
  ) {
    return this.rules.reorder(auth, body.ids, clientIp(req));
  }

  @RequireAccess('settings_email_routing', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(routingRuleSchema)) body: z.infer<typeof routingRuleSchema>,
  ) {
    return this.rules.update(auth, id, body, clientIp(req));
  }

  @RequireAccess('settings_email_routing', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.rules.remove(auth, id, clientIp(req));
  }
}

/** Templates the team writes themselves (owner O-6). */
@ApiTags('email')
@Controller('templates')
export class TemplatesController {
  constructor(@Inject(TemplatesService) private readonly templates: TemplatesService) {}

  @RequireAccess('tickets', 'read')
  @Get()
  list(@Query(new ZodPipe(listTemplatesSchema)) q: z.infer<typeof listTemplatesSchema>) {
    return this.templates.list(q);
  }

  @RequireAccess('tickets', 'update')
  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>) {
    return this.templates.create(auth, body);
  }

  @RequireAccess('tickets', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(templateSchema)) body: z.infer<typeof templateSchema>,
  ) {
    return this.templates.update(auth, id, body);
  }

  @RequireAccess('tickets', 'update')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.templates.remove(auth, id);
  }

  /** Fills placeholders for a ticket (or none) as the calling user. */
  @RequireAccess('tickets', 'read')
  @Post(':id/render')
  @HttpCode(200)
  render(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(renderSchema)) body: z.infer<typeof renderSchema>,
  ) {
    return this.templates.render(id, body.ticketId, auth.user.name);
  }
}

@ApiTags('email')
@Controller()
export class EmailController {
  constructor(
    @Inject(OutboundService) private readonly outbound: OutboundService,
    @Inject(MailboxesService) private readonly mailboxes: MailboxesService,
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(DB) private readonly db: Db,
  ) {}

  /** Mailboxes the caller may send from. */
  @AuthenticatedOnly()
  @Get('mailboxes')
  mine(@Auth() auth: AuthContext) {
    return this.mailboxes.forUser(auth);
  }

  /** Sends an email: a reply/forward on a ticket, or a new email that opens a ticket. */
  @RequireAccess('tickets', 'update')
  @Post('emails')
  send(@Auth() auth: AuthContext, @Body(new ZodPipe(sendSchema)) body: z.infer<typeof sendSchema>) {
    return this.outbound.send(auth, body);
  }

  /** Uploads a file to attach to an email being written (max 25 MB). */
  @RequireAccess('tickets', 'update')
  @Post('attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  async upload(
    @Auth() auth: AuthContext,
    @UploadedFile() file: { originalname: string; mimetype: string; buffer: Buffer } | undefined,
  ) {
    if (!file) throw new NotFoundException({ message: 'No file received.', reason: 'no_file' });
    const put = await this.storage.put('uploads', file.buffer, 'bin');
    const [row] = await this.db
      .insert(attachments)
      .values({
        ownerType: 'upload',
        ownerId: auth.user.id,
        filename: file.originalname.slice(0, 255),
        mime: file.mimetype || 'application/octet-stream',
        size: put.size,
        storageKey: put.key,
        checksum: put.checksum,
        createdById: auth.user.id,
      })
      .returning();
    return { id: row!.id, filename: row!.filename, size: row!.size, mime: row!.mime };
  }

  /** Downloads an attachment if the caller can see its ticket. */
  @RequireAccess('tickets', 'read')
  @Get('attachments/:id')
  async download(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const [a] = await this.db.select().from(attachments).where(eq(attachments.id, id));
    if (!a) throw new NotFoundException();
    if (a.ownerType === 'upload') {
      if (a.createdById !== auth.user.id) throw new NotFoundException();
    } else {
      const [act] = await this.db.select().from(activities).where(eq(activities.id, a.ownerId));
      if (!act?.ticketId) throw new NotFoundException();
      await this.tickets.find(auth, act.ticketId);
    }
    if (!checkModuleAccess(auth.principal, 'tickets', 'read').allowed) throw new ForbiddenException();
    const data = await this.storage.get(a.storageKey);
    res.setHeader('Content-Type', a.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`);
    res.send(data);
  }
}

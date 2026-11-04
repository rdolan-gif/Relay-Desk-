import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Auth, AuthenticatedOnly, RequireAccess } from '../auth/decorators';
import type { AuthContext } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { TicketsService } from '../tickets/tickets.service';
import { NotificationsService } from './notifications.service';
import { PresenceService } from './presence.service';
import { RealtimeService } from './realtime.service';

const rulesSchema = z.object({
  notificationEmail: z.string().trim().email().max(320).nullable().default(null),
  rules: z
    .array(
      z.object({
        categoryId: z.string().uuid(),
        owner: z.boolean().default(false),
        followed: z.boolean().default(false),
        new: z.boolean().default(false),
        activity: z.boolean().default(false),
      }),
    )
    .max(1000),
});

@ApiTags('notifications')
@Controller('me')
export class NotificationsController {
  constructor(
    @Inject(NotificationsService) private readonly svc: NotificationsService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  @AuthenticatedOnly()
  @Get('notifications')
  list(@Auth() auth: AuthContext, @Query('unread') unread?: string) {
    return this.svc.list(auth, { unreadOnly: unread === '1' || unread === 'true' });
  }

  @AuthenticatedOnly()
  @Post('notifications/read-all')
  readAll(@Auth() auth: AuthContext) {
    return this.svc.markRead(auth, 'all');
  }

  @AuthenticatedOnly()
  @Post('notifications/:id/read')
  read(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markRead(auth, id);
  }

  @RequireAccess('tickets', 'read')
  @Get('notification-rules')
  rules(@Auth() auth: AuthContext) {
    return this.svc.rules(auth);
  }

  @RequireAccess('tickets', 'read')
  @Put('notification-rules')
  setRules(@Auth() auth: AuthContext, @Body(new ZodPipe(rulesSchema)) body: z.infer<typeof rulesSchema>) {
    return this.svc.setRules(auth, body);
  }

  /** Live events for this browser tab (Server-Sent Events). */
  @AuthenticatedOnly()
  @Sse('events')
  events(@Auth() auth: AuthContext) {
    return this.realtime.stream(auth.user.id);
  }
}

const beatSchema = z.object({ editing: z.boolean().default(false) });

/** Presence on a ticket (spec 13): heartbeat in, the other viewers and editors out. */
@ApiTags('tickets')
@Controller('tickets/:id/presence')
export class PresenceController {
  constructor(
    @Inject(PresenceService) private readonly presence: PresenceService,
    @Inject(TicketsService) private readonly tickets: TicketsService,
  ) {}

  @RequireAccess('tickets', 'read')
  @Post()
  async beat(
    @Auth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(beatSchema)) body: z.infer<typeof beatSchema>,
  ) {
    await this.tickets.find(auth, id);
    return this.presence.beat(id, { id: auth.user.id, name: auth.user.name }, body.editing);
  }

  @RequireAccess('tickets', 'read')
  @Post('leave')
  leave(@Auth() auth: AuthContext, @Param('id', ParseIntPipe) id: number) {
    this.presence.leave(id, auth.user.id);
    return { ok: true };
  }
}

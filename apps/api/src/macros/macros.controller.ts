import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PRIORITIES, TICKET_STATES } from '@relay-desk/domain';
import { Auth, RequireAccess } from '../auth/decorators';
import { clientIp, type AppRequest, type AuthContext } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { MacrosService } from './macros.service';

const id = z.string().max(100);
const action = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set_category'), categoryId: z.string().uuid() }),
  z.object({ type: z.literal('set_user'), userId: id.nullable(), replace: z.boolean().default(false) }),
  z.object({ type: z.literal('set_state'), state: z.enum(TICKET_STATES) }),
  z.object({
    type: z.literal('set_status'),
    statusIds: z.array(z.string().uuid()).max(20),
    mode: z.enum(['add', 'replace']).default('add'),
  }),
  z.object({ type: z.literal('set_priority'), priority: z.enum(PRIORITIES) }),
  z.object({
    type: z.literal('set_reopen'),
    mode: z.enum(['relative', 'absolute']),
    amount: z.number().positive().max(3650).optional(),
    unit: z.enum(['hours', 'days', 'working_days']).optional(),
    at: z.string().max(40).optional(),
  }),
  z.object({ type: z.literal('set_custom_field'), fieldId: z.string().uuid(), value: z.unknown() }),
  z.object({ type: z.literal('add_follower'), userId: id }),
  z.object({ type: z.literal('insert_template'), templateId: z.string().uuid() }),
  z.object({ type: z.literal('open_url'), url: z.string().max(2000) }),
  z.object({ type: z.literal('save') }),
  z.object({ type: z.literal('dont_save') }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('delete') }),
]);
export const macroSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(''),
  colour: z.string().max(30).default('blue'),
  position: z.enum(['hidden', 'menu', 'button']).default('button'),
  actions: z.array(action).min(1).max(50),
  categoryIds: z.array(z.string().uuid()).max(500).default([]),
});

@ApiTags('settings')
@Controller('settings/macros')
export class MacrosController {
  constructor(@Inject(MacrosService) private readonly svc: MacrosService) {}

  @RequireAccess('settings_macros', 'read')
  @Get()
  list() {
    return this.svc.list();
  }

  @RequireAccess('settings_macros', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(macroSchema)) body: z.infer<typeof macroSchema>,
  ) {
    return this.svc.create(auth, body as never, clientIp(req));
  }

  @RequireAccess('settings_macros', 'create')
  @Post(':id/clone')
  clone(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.clone(auth, id, clientIp(req));
  }

  @RequireAccess('settings_macros', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(macroSchema)) body: z.infer<typeof macroSchema>,
  ) {
    return this.svc.update(auth, id, body as never, clientIp(req));
  }

  @RequireAccess('settings_macros', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.remove(auth, id, clientIp(req));
  }
}

@ApiTags('tickets')
@Controller('tickets/:id/macros')
export class TicketMacrosController {
  constructor(@Inject(MacrosService) private readonly svc: MacrosService) {}

  @RequireAccess('tickets', 'read')
  @Get()
  list(@Auth() auth: AuthContext, @Param('id', ParseIntPipe) id: number) {
    return this.svc.forTicket(auth, id);
  }
}

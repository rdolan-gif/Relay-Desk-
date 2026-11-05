import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Auth, AuthenticatedOnly, RequireAccess } from '../auth/decorators';
import { clientIp, type AppRequest, type AuthContext } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { DistributionService } from './distribution.service';
import { SlaSettingsService } from './sla-settings.service';

const amount = z.number().positive().max(100_000);
export const slaSchema = z.object({
  title: z.string().trim().min(1).max(200),
  unit: z.enum(['hours', 'minutes']).default('hours'),
  basisFieldId: z.string().uuid().nullable().default(null),
  targets: z.record(z.string().max(100), z.object({ response: amount.nullable().default(null), solution: amount })),
});

const time = z.string().regex(/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/);
const interval = z.object({ start: time, end: time });
export const timeGroupSchema = z.object({
  title: z.string().trim().min(1).max(200),
  timezone: z.string().min(1).max(100).default('Europe/London'),
  week: z.array(z.array(interval).max(10)).length(7),
  exceptions: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        title: z.string().max(200).optional(),
        intervals: z.array(interval).max(10).optional(),
      }),
    )
    .max(1000)
    .default([]),
});
const readySchema = z.object({ queueIds: z.array(z.string().uuid()).max(100) });

@ApiTags('settings')
@Controller('settings/slas')
export class SlaController {
  constructor(@Inject(SlaSettingsService) private readonly svc: SlaSettingsService) {}

  @RequireAccess('settings_sla', 'read')
  @Get()
  list() {
    return this.svc.listSlas();
  }

  @RequireAccess('settings_sla', 'read')
  @Get('basis-fields')
  basisFields() {
    return this.svc.basisFields();
  }

  @RequireAccess('settings_sla', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(slaSchema)) body: z.infer<typeof slaSchema>,
  ) {
    return this.svc.createSla(auth, body, clientIp(req));
  }

  @RequireAccess('settings_sla', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(slaSchema)) body: z.infer<typeof slaSchema>,
  ) {
    return this.svc.updateSla(auth, id, body, clientIp(req));
  }

  @RequireAccess('settings_sla', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.deleteSla(auth, id, clientIp(req));
  }
}

@ApiTags('settings')
@Controller('settings/time-groups')
export class TimeGroupsController {
  constructor(@Inject(SlaSettingsService) private readonly svc: SlaSettingsService) {}

  @RequireAccess('settings_time_groups', 'read')
  @Get()
  list() {
    return this.svc.listTimeGroups();
  }

  @RequireAccess('settings_time_groups', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(timeGroupSchema)) body: z.infer<typeof timeGroupSchema>,
  ) {
    return this.svc.createTimeGroup(auth, body, clientIp(req));
  }

  @RequireAccess('settings_time_groups', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(timeGroupSchema)) body: z.infer<typeof timeGroupSchema>,
  ) {
    return this.svc.updateTimeGroup(auth, id, body, clientIp(req));
  }

  @RequireAccess('settings_time_groups', 'update')
  @Post(':id/import-bank-holidays')
  importHolidays(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.importBankHolidays(auth, id, clientIp(req));
  }

  @RequireAccess('settings_time_groups', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.deleteTimeGroup(auth, id, clientIp(req));
  }
}

/** "Ready for email" (spec 9): the queues an agent is logged in to for distribution. */
@ApiTags('tickets')
@Controller('me/queues')
export class QueueLoginController {
  constructor(@Inject(DistributionService) private readonly svc: DistributionService) {}

  @AuthenticatedOnly()
  @Get()
  mine(@Auth() auth: AuthContext) {
    return this.svc.myQueues(auth);
  }

  @RequireAccess('tickets', 'read')
  @Put()
  set(@Auth() auth: AuthContext, @Body(new ZodPipe(readySchema)) body: z.infer<typeof readySchema>) {
    return this.svc.setReady(auth, body.queueIds);
  }
}

/** SLA and working-hours names for pickers (categories, accounts). */
@ApiTags('settings')
@Controller('sla-options')
export class SlaOptionsController {
  constructor(@Inject(SlaSettingsService) private readonly svc: SlaSettingsService) {}

  @AuthenticatedOnly()
  @Get()
  async slas() {
    return (await this.svc.listSlas()).map((s) => ({ id: s.id, title: s.title }));
  }

  @AuthenticatedOnly()
  @Get('time-groups')
  async timeGroups() {
    return (await this.svc.listTimeGroups()).map((g) => ({ id: g.id, title: g.title }));
  }
}

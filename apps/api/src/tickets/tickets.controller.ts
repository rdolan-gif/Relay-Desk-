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
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { MacrosService } from '../macros/macros.service';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { checkAccessFlag, checkModuleAccess } from '@relay-desk/domain';
import { ForbiddenException } from '@nestjs/common';
import { Auth, AuthenticatedOnly, RequireAccess, RequireFlag } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AppRequest, type AuthContext } from '../common/request-context';
import { listQuerySchema, type ListQuery } from '../crm/crm-common';
import { CustomFieldsService } from '../crm/custom-fields.service';
import { snapshotQuerySchema } from '../crm/schemas';
import { ActivitiesService } from './activities.service';
import { ticketFilterFields } from './ticket-filters';
import { TicketSettingsService } from './ticket-settings.service';
import { TicketsService } from './tickets.service';
import { ViewsService } from './views.service';
import {
  bulkEditSchema,
  categorySchema,
  childSchema,
  commentSchema,
  mergeSchema,
  moveSchema,
  sidebarSchema,
  statusSchema,
  ticketCreateSchema,
  ticketListSchema,
  ticketUpdateSchema,
  viewSchema,
} from './schemas';

const listPipe = new ZodPipe(listQuerySchema.merge(ticketListSchema));

// ------------------------------------------------------------------ settings

@ApiTags('settings')
@Controller('settings/ticket-statuses')
export class StatusesController {
  constructor(@Inject(TicketSettingsService) private readonly svc: TicketSettingsService) {}

  @RequireAccess('settings_statuses', 'read')
  @Get()
  list() {
    return this.svc.listStatuses();
  }

  @RequireAccess('settings_statuses', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(statusSchema)) body: z.infer<typeof statusSchema>,
  ) {
    return this.svc.createStatus(auth, body, clientIp(req));
  }

  @RequireAccess('settings_statuses', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(statusSchema)) body: z.infer<typeof statusSchema>,
  ) {
    return this.svc.updateStatus(auth, id, body, clientIp(req));
  }

  @RequireAccess('settings_statuses', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.deleteStatus(auth, id, clientIp(req));
  }
}

@ApiTags('settings')
@Controller('settings/categories')
export class CategoriesController {
  constructor(@Inject(TicketSettingsService) private readonly svc: TicketSettingsService) {}

  @RequireAccess('settings_categories', 'read')
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.svc.listCategories(auth);
  }

  @RequireAccess('settings_categories', 'read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getCategory(auth, id);
  }

  @RequireAccess('settings_categories', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(categorySchema)) body: z.infer<typeof categorySchema>,
  ) {
    return this.svc.createCategory(auth, body, clientIp(req));
  }

  @RequireAccess('settings_categories', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(categorySchema)) body: z.infer<typeof categorySchema>,
  ) {
    return this.svc.updateCategory(auth, id, body, clientIp(req));
  }

  @RequireAccess('settings_categories', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.deleteCategory(auth, id, clientIp(req));
  }
}

@ApiTags('settings')
@Controller('settings/ticket-views')
export class TeamViewsController {
  constructor(@Inject(TicketSettingsService) private readonly svc: TicketSettingsService) {}

  @RequireAccess('settings_ticket_views', 'read')
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.svc.listTeamViews(auth);
  }

  @RequireAccess('settings_ticket_views', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(viewSchema)) body: z.infer<typeof viewSchema>,
  ) {
    return this.svc.saveTeamView(auth, null, body, clientIp(req));
  }

  @RequireAccess('settings_ticket_views', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(viewSchema)) body: z.infer<typeof viewSchema>,
  ) {
    return this.svc.saveTeamView(auth, id, body, clientIp(req));
  }

  @RequireAccess('settings_ticket_views', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.deleteTeamView(auth, id, clientIp(req));
  }
}

// ------------------------------------------------------------------ agent side

/** What the ticket screens need: categories (with forms), statuses and filter fields. */
@ApiTags('tickets')
@Controller('tickets/meta')
export class TicketMetaController {
  constructor(
    @Inject(TicketSettingsService) private readonly settings: TicketSettingsService,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
  ) {}

  @RequireAccess('tickets', 'read')
  @Get()
  async meta(@Auth() auth: AuthContext) {
    const visible = new Set((await this.settings.listCategories(auth, { visibleOnly: true })).map((c) => c.id));
    const cats = await this.settings.listCategories(auth);
    return {
      categories: cats.map((c) => ({ ...c, canSee: visible.has(c.id) })),
      statuses: await this.settings.listStatuses(),
      filterFields: ticketFilterFields(await this.fields.list()),
      can: {
        createViews: checkAccessFlag(auth.principal, 'can_create_own_ticket_views').allowed,
        bulkEdit: checkAccessFlag(auth.principal, 'can_bulk_edit').allowed,
        merge: checkAccessFlag(auth.principal, 'can_merge_tickets').allowed,
        delete:
          checkAccessFlag(auth.principal, 'can_delete_tickets').allowed &&
          checkModuleAccess(auth.principal, 'tickets', 'delete').allowed,
        moveActivities: checkAccessFlag(auth.principal, 'can_move_activities').allowed,
      },
    };
  }
}

@ApiTags('tickets')
@Controller('tickets/views')
export class TicketViewsController {
  constructor(@Inject(ViewsService) private readonly views: ViewsService) {}

  @RequireAccess('tickets', 'read')
  @Get()
  sidebar(@Auth() auth: AuthContext) {
    return this.views.sidebar(auth);
  }

  @RequireFlag('can_create_own_ticket_views')
  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(viewSchema)) body: z.infer<typeof viewSchema>) {
    return this.views.createMine(auth, body);
  }

  @RequireAccess('tickets', 'read')
  @Put('sidebar')
  setSidebar(@Auth() auth: AuthContext, @Body(new ZodPipe(sidebarSchema)) body: z.infer<typeof sidebarSchema>) {
    return this.views.setSidebar(auth, body.items);
  }

  @RequireFlag('can_create_own_ticket_views')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(viewSchema)) body: z.infer<typeof viewSchema>,
  ) {
    return this.views.updateMine(auth, id, body);
  }

  @RequireAccess('tickets', 'read')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.views.deleteMine(auth, id);
  }
}

@ApiTags('tickets')
@Controller('tickets')
export class TicketsController {
  constructor(
    @Inject(TicketsService) private readonly tickets: TicketsService,
    @Inject(ActivitiesService) private readonly activities: ActivitiesService,
    @Inject(ViewsService) private readonly views: ViewsService,
    @Inject(MacrosService) private readonly macros: MacrosService,
  ) {}

  @RequireAccess('tickets', 'read')
  @Get()
  async list(@Auth() auth: AuthContext, @Query(listPipe) q: ListQuery & { viewId?: string }) {
    const viewConditions = q.viewId ? await this.views.conditionsOf(auth, q.viewId) : [];
    return this.tickets.list(auth, q, viewConditions);
  }

  @RequireAccess('tickets', 'create')
  @Post()
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(ticketCreateSchema)) body: z.infer<typeof ticketCreateSchema>) {
    return this.tickets.create(auth, body, 'form');
  }

  @RequireFlag('can_bulk_edit')
  @Post('bulk-edit')
  @HttpCode(200)
  bulk(@Auth() auth: AuthContext, @Body(new ZodPipe(bulkEditSchema)) body: z.infer<typeof bulkEditSchema>) {
    if (!checkModuleAccess(auth.principal, 'tickets', 'update').allowed) {
      throw new ForbiddenException({
        message: 'You do not have update access to tickets.',
        reason: 'verb_not_granted',
      });
    }
    return this.tickets.bulkEdit(auth, body.ticketIds, body.changes);
  }

  @RequireFlag('can_merge_tickets')
  @Post('merge')
  @HttpCode(200)
  merge(@Auth() auth: AuthContext, @Body(new ZodPipe(mergeSchema)) body: z.infer<typeof mergeSchema>) {
    return this.tickets.merge(auth, body.ticketIds, body.survivorId);
  }

  @RequireAccess('tickets', 'update')
  @Post(':id/fyi')
  @HttpCode(200)
  fyi(@Auth() auth: AuthContext, @Param('id', ParseIntPipe) id: number) {
    return this.tickets.markFyi(auth, id);
  }

  @RequireFlag('can_merge_tickets')
  @Post(':id/merges/:mergeId/undo')
  @HttpCode(200)
  unmerge(
    @Auth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('mergeId', ParseIntPipe) mergeId: number,
  ) {
    return this.tickets.unmerge(auth, id, mergeId);
  }

  @RequireAccess('tickets', 'read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseIntPipe) id: number) {
    return this.tickets.get(auth, id);
  }

  @RequireAccess('tickets', 'update')
  @Patch(':id')
  async update(
    @Auth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(ticketUpdateSchema)) body: z.infer<typeof ticketUpdateSchema>,
  ) {
    const { macroId, ...changes } = body;
    if (macroId) {
      await this.macros.assertUsable(auth, id, macroId);
      return this.tickets.update(auth, id, changes, 'macro');
    }
    return this.tickets.update(auth, id, changes, 'form');
  }

  @RequireFlag('can_delete_tickets')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Param('id', ParseIntPipe) id: number) {
    if (!checkModuleAccess(auth.principal, 'tickets', 'delete').allowed) {
      throw new ForbiddenException({
        message: 'You do not have delete access to tickets.',
        reason: 'verb_not_granted',
      });
    }
    await this.tickets.remove(auth, id);
  }

  @RequireAccess('tickets', 'read')
  @Get(':id/history')
  history(@Auth() auth: AuthContext, @Param('id', ParseIntPipe) id: number) {
    return this.tickets.historyOf(auth, id);
  }

  @RequireAccess('tickets', 'read')
  @Get(':id/snapshot')
  snapshot(
    @Auth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Query(new ZodPipe(snapshotQuerySchema)) q: { at: Date },
  ) {
    return this.tickets.snapshot(auth, id, q.at);
  }

  @RequireAccess('tickets', 'read')
  @Get(':id/activities')
  listActivities(@Auth() auth: AuthContext, @Param('id', ParseIntPipe) id: number) {
    return this.activities.list(auth, id);
  }

  @RequireAccess('tickets', 'update')
  @Post(':id/comments')
  comment(
    @Auth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(commentSchema)) body: z.infer<typeof commentSchema>,
  ) {
    return this.activities.addComment(auth, id, body);
  }

  @RequireAccess('tickets', 'update')
  @Patch(':id/comments/:activityId')
  editComment(
    @Auth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body(new ZodPipe(commentSchema)) body: z.infer<typeof commentSchema>,
  ) {
    return this.activities.editComment(auth, id, activityId, body);
  }

  @RequireFlag('can_move_activities')
  @Post(':id/activities/:activityId/move')
  @HttpCode(200)
  move(
    @Auth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('activityId', ParseUUIDPipe) activityId: string,
    @Body(new ZodPipe(moveSchema)) body: z.infer<typeof moveSchema>,
  ) {
    return this.activities.move(auth, id, activityId, body.targetTicketId);
  }

  @RequireAccess('tickets', 'create')
  @Post(':id/children')
  child(
    @Auth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(childSchema)) body: z.infer<typeof childSchema>,
  ) {
    return this.tickets.createChild(auth, id, body);
  }

  @RequireAccess('tickets', 'read')
  @Post(':id/follow')
  @HttpCode(204)
  async follow(@Auth() auth: AuthContext, @Param('id', ParseIntPipe) id: number) {
    await this.tickets.setFollowing(auth, id, true);
  }

  @RequireAccess('tickets', 'read')
  @Delete(':id/follow')
  @HttpCode(204)
  async unfollow(@Auth() auth: AuthContext, @Param('id', ParseIntPipe) id: number) {
    await this.tickets.setFollowing(auth, id, false);
  }

  @AuthenticatedOnly()
  @Post(':id/favourite')
  @HttpCode(204)
  async favourite(@Auth() auth: AuthContext, @Param('id', ParseIntPipe) id: number) {
    await this.tickets.setFavourite(auth, id, true);
  }

  @AuthenticatedOnly()
  @Delete(':id/favourite')
  @HttpCode(204)
  async unfavourite(@Auth() auth: AuthContext, @Param('id', ParseIntPipe) id: number) {
    await this.tickets.setFavourite(auth, id, false);
  }
}

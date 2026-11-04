import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Auth, RequireAccess } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AppRequest, type AuthContext } from '../common/request-context';
import { ProfilesService } from './profiles.service';

const verbFlags = z
  .object({
    enabled: z.boolean().optional(),
    create: z.boolean().optional(),
    read: z.boolean().optional(),
    update: z.boolean().optional(),
    delete: z.boolean().optional(),
  })
  .strict();

const accessSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).optional(),
  modules: z.record(verbFlags).default({}),
  flags: z.record(z.boolean()).default({}),
});

const idList = z.array(z.string().uuid()).max(1000);
const rightsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(1000).optional(),
  userVisibility: z.enum(['all', 'selected']).default('all'),
  visibleUserIds: idList.default([]),
  editableAccessProfiles: z.union([z.literal('all'), idList]).default([]),
  editableRightsProfiles: z.union([z.literal('all'), idList]).default([]),
  crmDatabases: z.union([z.literal('all'), idList]).default([]),
  crmRecordTypes: z.union([z.literal('all'), idList]).default([]),
  categories: z
    .union([
      z.literal('all'),
      z
        .array(
          z.object({
            categoryId: z.string().uuid(),
            access: z.boolean().default(true),
            distribute: z.boolean().default(false),
            distributionLimit: z.number().int().min(1).max(1000).nullable().default(null),
          }),
        )
        .max(1000),
    ])
    .default([]),
  ticketViews: z.union([z.literal('all'), idList]).default([]),
  mailboxes: z.union([z.literal('all'), idList]).default([]),
  macros: z.union([z.literal('all'), idList]).default([]),
  kbFolders: z
    .union([
      z.literal('all'),
      z
        .array(
          z.object({
            folderId: z.string().uuid(),
            view: z.boolean().default(true),
            create: z.boolean().default(false),
            update: z.boolean().default(false),
            delete: z.boolean().default(false),
          }),
        )
        .max(1000),
    ])
    .default([]),
});

@ApiTags('settings')
@Controller('settings/access-profiles')
export class AccessProfilesController {
  constructor(@Inject(ProfilesService) private readonly profiles: ProfilesService) {}

  @RequireAccess('settings_access_profiles', 'read')
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.profiles.listAccess(auth);
  }

  @RequireAccess('settings_access_profiles', 'read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.profiles.getAccess(auth, id);
  }

  @RequireAccess('settings_access_profiles', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(accessSchema)) body: z.infer<typeof accessSchema>,
  ) {
    return this.profiles.createAccess(auth, body, clientIp(req));
  }

  @RequireAccess('settings_access_profiles', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(accessSchema)) body: z.infer<typeof accessSchema>,
  ) {
    return this.profiles.updateAccess(auth, id, body, clientIp(req));
  }

  @RequireAccess('settings_access_profiles', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.profiles.deleteAccess(auth, id, clientIp(req));
  }
}

@ApiTags('settings')
@Controller('settings/rights-profiles')
export class RightsProfilesController {
  constructor(@Inject(ProfilesService) private readonly profiles: ProfilesService) {}

  @RequireAccess('settings_rights_profiles', 'read')
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.profiles.listRights(auth);
  }

  @RequireAccess('settings_rights_profiles', 'read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.profiles.getRights(auth, id);
  }

  @RequireAccess('settings_rights_profiles', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(rightsSchema)) body: z.infer<typeof rightsSchema>,
  ) {
    return this.profiles.createRights(auth, body, clientIp(req));
  }

  @RequireAccess('settings_rights_profiles', 'update')
  @Put(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(rightsSchema)) body: z.infer<typeof rightsSchema>,
  ) {
    return this.profiles.updateRights(auth, id, body, clientIp(req));
  }

  @RequireAccess('settings_rights_profiles', 'delete')
  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() auth: AuthContext, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string) {
    await this.profiles.deleteRights(auth, id, clientIp(req));
  }
}

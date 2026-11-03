import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { USER_TYPES } from '@relay-desk/domain';
import { Auth, RequireAccess } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { clientIp, type AppRequest, type AuthContext } from '../common/request-context';
import { UsersService } from './users.service';

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown timezone');

const createSchema = z.object({
  email: z.string().trim().email().max(320),
  name: z.string().trim().min(1).max(200),
  type: z.enum(USER_TYPES),
  password: z.string().max(256).optional(),
  accessProfileId: z.string().uuid().nullable().optional(),
  rightsProfileId: z.string().uuid().nullable().optional(),
  timezone: timezone.optional(),
});

const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

@ApiTags('settings')
@Controller('settings/users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @RequireAccess('settings_users', 'read')
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.users.list(auth);
  }

  @RequireAccess('settings_users', 'read')
  @Get(':id')
  get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.get(auth, id);
  }

  @RequireAccess('settings_users', 'create')
  @Post()
  create(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.users.create(auth, body, clientIp(req));
  }

  @RequireAccess('settings_users', 'update')
  @Patch(':id')
  update(
    @Auth() auth: AuthContext,
    @Req() req: AppRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
  ) {
    return this.users.update(auth, id, body, clientIp(req));
  }
}

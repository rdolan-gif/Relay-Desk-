import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequireAccess } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { AuditService } from './audit.service';

const querySchema = z.object({
  eventType: z.string().max(100).optional(),
  actorUserId: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  beforeId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Admin-only system audit log (spec 17). Read-only by design. */
@ApiTags('settings')
@Controller('settings/audit-log')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @RequireAccess('settings_audit_log', 'read')
  @Get()
  list(@Query(new ZodPipe(querySchema)) q: z.infer<typeof querySchema>) {
    return this.audit.list(q);
  }
}

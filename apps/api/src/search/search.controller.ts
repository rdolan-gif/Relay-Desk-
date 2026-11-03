import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Auth, AuthenticatedOnly } from '../auth/decorators';
import { ZodPipe } from '../common/zod.pipe';
import type { AuthContext } from '../common/request-context';
import { SearchService } from './search.service';

const querySchema = z.object({ q: z.string().max(200).default('') });

@ApiTags('search')
@Controller('search')
export class SearchController {
  constructor(@Inject(SearchService) private readonly search: SearchService) {}

  /** Per-type access and rights checks are applied inside the service. */
  @AuthenticatedOnly()
  @Get()
  run(@Auth() auth: AuthContext, @Query(new ZodPipe(querySchema)) q: z.infer<typeof querySchema>) {
    return this.search.search(auth, q.q);
  }
}

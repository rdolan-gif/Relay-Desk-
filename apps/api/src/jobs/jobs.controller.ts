import { Controller, Get, Inject, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Auth, AuthenticatedOnly } from '../auth/decorators';
import type { AuthContext } from '../common/request-context';
import { JobsService, publicJob } from './jobs.service';

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  @AuthenticatedOnly()
  @Get()
  list(@Auth() auth: AuthContext) {
    return this.jobs.list(auth);
  }

  @AuthenticatedOnly()
  @Get(':id')
  async get(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string) {
    return publicJob(await this.jobs.get(auth, id));
  }

  @AuthenticatedOnly()
  @Get(':id/file')
  async file(@Auth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.jobs.file(auth, id);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${f.name.replace(/[^\w.\- ]/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(f.data);
  }
}

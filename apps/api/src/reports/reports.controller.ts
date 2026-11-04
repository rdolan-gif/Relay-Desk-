import { BadRequestException, Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { Auth, RequireAccess } from '../auth/decorators';
import type { AuthContext } from '../common/request-context';
import { ukDateTime, writeTable } from '../data/spreadsheet';
import { ReportsService } from './reports.service';

const filter = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    categoryId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    queueId: z.string().uuid().optional(),
    priority: z.enum(['low', 'normal', 'high']).optional(),
  })
  .refine((f) => new Date(f.from) <= new Date(f.to), 'The start must be before the end.')
  .refine(
    (f) => new Date(f.to).getTime() - new Date(f.from).getTime() <= 400 * 86_400_000,
    'Choose at most about a year.',
  );
const drill = z.object({
  metric: z.string().max(40),
  forUserId: z.string().uuid().optional(),
  day: z.string().max(10).optional(),
});
const emailFilter = z.object({
  direction: z.enum(['in', 'out']).optional(),
  status: z.enum(['received', 'sending', 'sent', 'failed']).optional(),
});
const exportQ = z.object({
  section: z.enum(['daily', 'workload', 'heatmap', 'emails']),
  format: z.enum(['csv', 'xlsx']).default('csv'),
});

const toFilter = (q: z.infer<typeof filter>) => ({ ...q, from: new Date(q.from), to: new Date(q.to) });
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Reporting module (spec 17). */
@ApiTags('reporting')
@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  @RequireAccess('reporting', 'read')
  @Get('summary')
  summary(@Auth() auth: AuthContext, @Query() q: Record<string, string>) {
    return this.reports.summary(auth, toFilter(parse(filter, pick(q))));
  }

  @RequireAccess('reporting', 'read')
  @Get('tickets')
  tickets(@Auth() auth: AuthContext, @Query() q: Record<string, string>) {
    const d = parse(drill, q);
    return this.reports.drill(auth, toFilter(parse(filter, pick(q))), d.metric, { userId: d.forUserId, day: d.day });
  }

  @RequireAccess('reporting', 'read')
  @Get('emails')
  emails(@Auth() auth: AuthContext, @Query() q: Record<string, string>) {
    return this.reports.emails(auth, { ...toFilter(parse(filter, pick(q))), ...parse(emailFilter, q) });
  }

  /** Each section as CSV or Excel (spec 17: exportable). */
  @RequireAccess('reporting', 'read')
  @Get('export')
  async export(@Auth() auth: AuthContext, @Query() q: Record<string, string>, @Res() res: Response) {
    const f = toFilter(parse(filter, pick(q)));
    const e = parse(exportQ, q);
    let rows: unknown[][];
    if (e.section === 'emails') {
      const list = await this.reports.emails(auth, { ...f, ...parse(emailFilter, q) });
      rows = [
        ['Date', 'Ticket', 'Direction', 'Status', 'Subject', 'Mailbox', 'Error'],
        ...list.map((a) => [
          ukDateTime(a.createdAt, 'Europe/London'),
          a.ticketId,
          a.direction,
          a.status,
          a.subject,
          a.queue,
          a.error,
        ]),
      ];
    } else {
      const s = await this.reports.summary(auth, f);
      rows =
        e.section === 'daily'
          ? [
              ['Day', 'Created', 'Closed', 'Backlog'],
              ...s.days.map((d, i) => [d, s.created[i]!.count, s.closed[i]!.count, s.backlog[i]!.count]),
            ]
          : e.section === 'workload'
            ? [['User', 'Open now', 'Closed in period'], ...s.workload.map((w) => [w.name, w.open, w.closed])]
            : [
                ['Day', ...Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`)],
                ...s.heatmap.map((r, i) => [DAYS[i], ...r]),
              ];
    }
    const file = await writeTable(rows, e.format, e.section);
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `attachment; filename="report-${e.section}.${file.ext}"`);
    res.send(file.data);
  }
}

function pick(q: Record<string, unknown>) {
  const { from, to, categoryId, userId, queueId, priority } = q;
  return Object.fromEntries(
    Object.entries({ from, to, categoryId, userId, queueId, priority }).filter(([, v]) => v !== undefined && v !== ''),
  );
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new BadRequestException({ message: r.error.issues.map((i) => i.message).join(' '), reason: 'invalid_query' });
  return r.data;
}

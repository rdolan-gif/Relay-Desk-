import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  diffFields,
  ENGLAND_AND_WALES_BANK_HOLIDAYS,
  mergeExceptions,
  parseGovUkBankHolidays,
  validateSla,
  validateTimeGroup,
  type Interval,
  type SlaTarget,
  type SlaUnit,
  type TimeException,
} from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/request-context';
import { formError } from '../crm/form-errors';
import { DB, type Db } from '../db/db';
import { accounts, categories, customFields, slaDefinitions, timeGroups } from '../db/schema';
import { SlaService } from './sla.service';

export interface SlaInput {
  title: string;
  unit: SlaUnit;
  basisFieldId: string | null;
  targets: Record<string, SlaTarget>;
}

export interface TimeGroupInput {
  title: string;
  timezone: string;
  week: Interval[][];
  exceptions: TimeException[];
}

const GOV_UK = 'https://www.gov.uk/bank-holidays.json';

/** Settings › SLAs and Settings › Working hours (spec 8). */
@Injectable()
export class SlaSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SlaService) private readonly sla: SlaService,
  ) {}

  // ----- SLA definitions

  listSlas() {
    return this.db
      .select()
      .from(slaDefinitions)
      .where(isNull(slaDefinitions.deletedAt))
      .orderBy(asc(slaDefinitions.title));
  }

  private async findSla(id: string) {
    const [r] = await this.db
      .select()
      .from(slaDefinitions)
      .where(and(eq(slaDefinitions.id, id), isNull(slaDefinitions.deletedAt)));
    if (!r) throw new NotFoundException();
    return r;
  }

  private async checkSla(input: SlaInput) {
    let options: string[] | undefined;
    if (input.basisFieldId) {
      const [f] = await this.db
        .select()
        .from(customFields)
        .where(and(eq(customFields.id, input.basisFieldId), isNull(customFields.deletedAt)));
      if (!f || f.type !== 'select')
        throw formError(['The SLA can only be based on a single-choice (select) field.'], 'invalid_sla');
      options = f.options.map((o) => o.value);
    }
    const errors = validateSla(input, options);
    if (errors.length) throw formError(errors, 'invalid_sla');
  }

  async createSla(auth: AuthContext, input: SlaInput, ip: string | null) {
    await this.checkSla(input);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(slaDefinitions).values(input).returning();
      await this.audit.record(
        {
          eventType: 'settings.created',
          actorUserId: auth.user.id,
          ip,
          targetType: 'sla',
          targetId: row!.id,
          changes: diffFields({}, input as never),
        },
        tx,
      );
      return row!;
    });
  }

  async updateSla(auth: AuthContext, id: string, input: SlaInput, ip: string | null) {
    const before = await this.findSla(id);
    await this.checkSla(input);
    const row = await this.db.transaction(async (tx) => {
      const [r] = await tx
        .update(slaDefinitions)
        .set({ ...input, updatedAt: new Date() })
        .where(eq(slaDefinitions.id, id))
        .returning();
      const { title, unit, basisFieldId, targets } = before;
      await this.audit.record(
        {
          eventType: 'settings.updated',
          actorUserId: auth.user.id,
          ip,
          targetType: 'sla',
          targetId: id,
          changes: diffFields({ title, unit, basisFieldId, targets } as never, input as never),
        },
        tx,
      );
      return r!;
    });
    await this.sla.refreshUsing({ slaId: id });
    return row;
  }

  async deleteSla(auth: AuthContext, id: string, ip: string | null) {
    await this.findSla(id);
    const [usedCat] = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.slaId, id), isNull(categories.deletedAt)))
      .limit(1);
    const [usedAcc] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.slaId, id), isNull(accounts.deletedAt)))
      .limit(1);
    if (usedCat || usedAcc)
      throw new ConflictException({ message: 'A category or account still uses this SLA.', reason: 'sla_in_use' });
    await this.db.transaction(async (tx) => {
      await tx.update(slaDefinitions).set({ deletedAt: new Date() }).where(eq(slaDefinitions.id, id));
      await this.audit.record(
        { eventType: 'settings.deleted', actorUserId: auth.user.id, ip, targetType: 'sla', targetId: id },
        tx,
      );
    });
  }

  // ----- time groups

  listTimeGroups() {
    return this.db.select().from(timeGroups).where(isNull(timeGroups.deletedAt)).orderBy(asc(timeGroups.title));
  }

  private async findTimeGroup(id: string) {
    const [r] = await this.db
      .select()
      .from(timeGroups)
      .where(and(eq(timeGroups.id, id), isNull(timeGroups.deletedAt)));
    if (!r) throw new NotFoundException();
    return r;
  }

  private check(input: TimeGroupInput) {
    const errors = validateTimeGroup(input);
    if (errors.length) throw formError(errors, 'invalid_time_group');
  }

  private normalise(input: TimeGroupInput): TimeGroupInput {
    return { ...input, exceptions: [...input.exceptions].sort((a, b) => a.date.localeCompare(b.date)) };
  }

  async createTimeGroup(auth: AuthContext, input: TimeGroupInput, ip: string | null) {
    this.check(input);
    const values = this.normalise(input);
    return this.db.transaction(async (tx) => {
      const [row] = await tx.insert(timeGroups).values(values).returning();
      await this.audit.record(
        {
          eventType: 'settings.created',
          actorUserId: auth.user.id,
          ip,
          targetType: 'time_group',
          targetId: row!.id,
          changes: diffFields({}, values as never),
        },
        tx,
      );
      return row!;
    });
  }

  async updateTimeGroup(auth: AuthContext, id: string, input: TimeGroupInput, ip: string | null) {
    const before = await this.findTimeGroup(id);
    this.check(input);
    const values = this.normalise(input);
    const row = await this.db.transaction(async (tx) => {
      const [r] = await tx
        .update(timeGroups)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(timeGroups.id, id))
        .returning();
      const { title, timezone, week, exceptions } = before;
      await this.audit.record(
        {
          eventType: 'settings.updated',
          actorUserId: auth.user.id,
          ip,
          targetType: 'time_group',
          targetId: id,
          changes: diffFields({ title, timezone, week, exceptions } as never, values as never),
        },
        tx,
      );
      return r!;
    });
    await this.sla.refreshUsing({ timeGroupId: id });
    return row;
  }

  async deleteTimeGroup(auth: AuthContext, id: string, ip: string | null) {
    await this.findTimeGroup(id);
    const [used] = await this.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.timeGroupId, id), isNull(categories.deletedAt)))
      .limit(1);
    if (used)
      throw new ConflictException({
        message: 'A category still uses these working hours.',
        reason: 'time_group_in_use',
      });
    await this.db.transaction(async (tx) => {
      await tx.update(timeGroups).set({ deletedAt: new Date() }).where(eq(timeGroups.id, id));
      await this.audit.record(
        { eventType: 'settings.deleted', actorUserId: auth.user.id, ip, targetType: 'time_group', targetId: id },
        tx,
      );
    });
  }

  /**
   * Adds England and Wales bank holidays from today on (spec 8: "importable"). Uses the
   * live GOV.UK list, or the built-in list when it can't be reached.
   */
  async importBankHolidays(auth: AuthContext, id: string, ip: string | null, fetcher: typeof fetch = fetch) {
    const tg = await this.findTimeGroup(id);
    let holidays = ENGLAND_AND_WALES_BANK_HOLIDAYS;
    let source: 'gov.uk' | 'built-in' = 'built-in';
    try {
      const res = await fetcher(GOV_UK, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        holidays = parseGovUkBankHolidays(await res.json());
        source = 'gov.uk';
      }
    } catch {
      // Offline or blocked: fall back to the built-in list.
    }
    const today = new Date().toISOString().slice(0, 10);
    const exceptions = mergeExceptions(tg.exceptions, holidays, today);
    const added = exceptions.length - tg.exceptions.length;
    const row = await this.updateTimeGroup(
      auth,
      id,
      { title: tg.title, timezone: tg.timezone, week: tg.week, exceptions },
      ip,
    );
    return { ...row, added, source };
  }

  /** Select fields an SLA can be based on. */
  async basisFields() {
    return this.db
      .select({ id: customFields.id, name: customFields.name, options: customFields.options })
      .from(customFields)
      .where(and(eq(customFields.type, 'select'), isNull(customFields.deletedAt)));
  }
}

import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { validateConditions, type FilterCondition } from '@relay-desk/domain';
import { isUniqueViolation } from '../common/db-errors';
import type { AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { filterSchemes, listPreferences } from '../db/schema';
import { filterFields, type ListName } from './crm-common';
import { CustomFieldsService } from './custom-fields.service';

/** Saved filter schemes (private to their owner) and per-user column choices. */
@Injectable()
export class ListSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CustomFieldsService) private readonly fields: CustomFieldsService,
  ) {}

  listSchemes(auth: AuthContext, list: ListName) {
    return this.db
      .select()
      .from(filterSchemes)
      .where(and(eq(filterSchemes.userId, auth.user.id), eq(filterSchemes.list, list)))
      .orderBy(asc(filterSchemes.name));
  }

  async saveScheme(
    auth: AuthContext,
    input: { id?: string; list: ListName; name: string; conditions: FilterCondition[] },
  ) {
    const check = validateConditions(filterFields(input.list, (await this.fields.map()).values()), input.conditions);
    if (!check.ok)
      throw new BadRequestException({
        message: check.errors.join(' '),
        reason: 'invalid_filter',
        errors: check.errors,
      });
    try {
      if (input.id) {
        const [row] = await this.db
          .update(filterSchemes)
          .set({ name: input.name, conditions: check.conditions, updatedAt: new Date() })
          .where(and(eq(filterSchemes.id, input.id), eq(filterSchemes.userId, auth.user.id)))
          .returning();
        if (!row) throw new NotFoundException();
        return row;
      }
      const [row] = await this.db
        .insert(filterSchemes)
        .values({ userId: auth.user.id, list: input.list, name: input.name, conditions: check.conditions })
        .returning();
      return row!;
    } catch (err) {
      if (isUniqueViolation(err))
        throw new ConflictException({ message: 'You already have a filter with this name.', reason: 'duplicate_name' });
      throw err;
    }
  }

  async deleteScheme(auth: AuthContext, id: string) {
    const rows = await this.db
      .delete(filterSchemes)
      .where(and(eq(filterSchemes.id, id), eq(filterSchemes.userId, auth.user.id)))
      .returning({ id: filterSchemes.id });
    if (!rows.length) throw new NotFoundException();
  }

  async getColumns(auth: AuthContext, list: string): Promise<string[] | null> {
    const [row] = await this.db
      .select()
      .from(listPreferences)
      .where(and(eq(listPreferences.userId, auth.user.id), eq(listPreferences.list, list)));
    return row?.columns ?? null;
  }

  async setColumns(auth: AuthContext, list: string, columns: string[]) {
    await this.db
      .insert(listPreferences)
      .values({ userId: auth.user.id, list, columns })
      .onConflictDoUpdate({
        target: [listPreferences.userId, listPreferences.list],
        set: { columns, updatedAt: new Date() },
      });
    return { columns };
  }
}

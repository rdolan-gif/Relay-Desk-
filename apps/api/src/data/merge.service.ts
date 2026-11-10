import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { diffFields, mergeValues, validateMerge, type MergeChoices } from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../common/request-context';
import { AccountsService } from '../crm/accounts.service';
import { ContactsService } from '../crm/contacts.service';
import { DB, type Db } from '../db/db';
import { accounts, activities, contacts, crmRecords, tickets } from '../db/schema';
import { HistoryService } from '../history/history.service';
import { SlaService } from '../sla/sla.service';

/**
 * Contact and account merge (spec 12.4): pick the survivor and which value wins per field;
 * tickets, activities and records move to the survivor; merged records are soft-deleted
 * with a pointer to the survivor, and the merge is logged in history.
 */
@Injectable()
export class MergeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ContactsService) private readonly contactsService: ContactsService,
    @Inject(AccountsService) private readonly accountsService: AccountsService,
    @Inject(HistoryService) private readonly history: HistoryService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SlaService) private readonly sla: SlaService,
  ) {}

  private check(survivorId: string, ids: string[]) {
    const errors = validateMerge(survivorId, ids);
    if (errors.length) throw new BadRequestException({ message: errors.join(' '), reason: 'invalid_merge' });
    return [...new Set(ids)];
  }

  async mergeContacts(auth: AuthContext, survivorId: string, ids: string[], choices: MergeChoices, ip: string | null) {
    const all = await Promise.all(this.check(survivorId, ids).map((id) => this.contactsService.find(auth, id)));
    if (new Set(all.map((c) => c.databaseId)).size > 1)
      throw new BadRequestException({ message: 'Only contacts in the same CRM database can be merged.', reason: 'different_databases' });
    const values = mergeValues(survivorId, all, choices);
    const merged = all.filter((c) => c.id !== survivorId).map((c) => c.id);
    const survivor = all.find((c) => c.id === survivorId)!;
    const moved = await this.db.transaction(async (tx) => {
      await tx.update(contacts).set({ ...values, updatedAt: new Date() }).where(eq(contacts.id, survivorId));
      const t = await tx.update(tickets).set({ contactId: survivorId }).where(inArray(tickets.contactId, merged)).returning({ id: tickets.id });
      await tx.update(activities).set({ contactId: survivorId }).where(inArray(activities.contactId, merged));
      await tx.update(crmRecords).set({ contactId: survivorId }).where(inArray(crmRecords.contactId, merged));
      await tx.update(contacts).set({ mergedIntoId: survivorId, deletedAt: new Date() }).where(inArray(contacts.id, merged));
      const { name, emails, phones, accountId } = survivor;
      await this.history.record(tx, auth, 'contact', survivorId, 'merge', [
        { field: 'mergedContactIds', old: null, new: merged },
        ...diffFields({ name, emails, phones, accountId }, { name: values.name, emails: values.emails, phones: values.phones, accountId: values.accountId }),
      ]);
      for (const id of merged) await this.history.record(tx, auth, 'contact', id, 'merge', [{ field: 'mergedIntoId', old: null, new: survivorId }]);
      await this.audit.record({ eventType: 'merge.run', actorUserId: auth.user.id, ip, targetType: 'contact', targetId: survivorId, details: { merged } }, tx);
      return t.map((x) => x.id);
    });
    // A different account can bring a different SLA (spec 8).
    if (values.accountId !== survivor.accountId) await this.sla.refreshContact(survivorId);
    else if (moved.length) await this.db.transaction((tx) => this.sla.refresh(tx, moved));
    return { id: survivorId, merged, tickets: moved.length };
  }

  async mergeAccounts(auth: AuthContext, survivorId: string, ids: string[], choices: MergeChoices, ip: string | null) {
    const all = await Promise.all(this.check(survivorId, ids).map((id) => this.accountsService.find(auth, id)));
    if (new Set(all.map((a) => a.databaseId)).size > 1)
      throw new BadRequestException({ message: 'Only accounts in the same CRM database can be merged.', reason: 'different_databases' });
    const survivor = all.find((a) => a.id === survivorId)!;
    const merged = all.filter((a) => a.id !== survivorId);
    const mergedIds = merged.map((a) => a.id);
    // Company › Branch is one level (owner Q2): a branch cannot take over another account's branches.
    const branches = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(inArray(accounts.parentId, mergedIds), isNull(accounts.deletedAt)));
    if (branches.length && survivor.parentId)
      throw new BadRequestException({ message: 'Keep the company, not a branch, when merging accounts that have branches.', reason: 'branch_survivor' });
    if (survivor.parentId && mergedIds.includes(survivor.parentId))
      throw new BadRequestException({ message: 'A branch cannot absorb its own company.', reason: 'branch_survivor' });
    const values = mergeValues(survivorId, all.map((a) => ({ ...a, accountId: null })), choices);
    const pick = (field: string) => all.find((a) => a.id === choices[field]) ?? survivor;
    const addresses = choices.addresses && choices.addresses !== 'all' ? pick('addresses').addresses : all.flatMap((a) => a.addresses);
    await this.db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({
          name: values.name,
          emails: values.emails,
          phones: values.phones,
          addresses,
          branchCode: pick('branchCode').branchCode,
          customFields: values.customFields,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, survivorId));
      await tx.update(contacts).set({ accountId: survivorId }).where(inArray(contacts.accountId, mergedIds));
      await tx.update(accounts).set({ parentId: survivorId }).where(inArray(accounts.parentId, mergedIds));
      await tx.update(crmRecords).set({ accountId: survivorId }).where(inArray(crmRecords.accountId, mergedIds));
      await tx.update(accounts).set({ mergedIntoId: survivorId, deletedAt: new Date() }).where(inArray(accounts.id, mergedIds));
      await this.history.record(tx, auth, 'account', survivorId, 'merge', [
        { field: 'mergedAccountIds', old: null, new: mergedIds },
        ...diffFields({ name: survivor.name, emails: survivor.emails, phones: survivor.phones }, { name: values.name, emails: values.emails, phones: values.phones }),
      ]);
      for (const id of mergedIds) await this.history.record(tx, auth, 'account', id, 'merge', [{ field: 'mergedIntoId', old: null, new: survivorId }]);
      await this.audit.record({ eventType: 'merge.run', actorUserId: auth.user.id, ip, targetType: 'account', targetId: survivorId, details: { merged: mergedIds } }, tx);
    });
    await this.sla.refreshAccount(survivorId);
    return { id: survivorId, merged: mergedIds };
  }
}

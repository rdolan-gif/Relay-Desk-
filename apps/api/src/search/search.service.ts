import { Inject, Injectable } from '@nestjs/common';
import { and, asc, isNull, sql } from 'drizzle-orm';
import { checkModuleAccess, crmDatabaseScope, recordTypeScope } from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import { scopeSql } from '../crm/crm-common';
import { AccountsService } from '../crm/accounts.service';
import { ContactsService } from '../crm/contacts.service';
import { RecordsService } from '../crm/records.service';
import { DB, type Db } from '../db/db';
import { accounts, contacts, crmRecords } from '../db/schema';

export const SEARCH_MIN_LENGTH = 3;
const PER_TYPE = 8;

/**
 * Global search (spec 14). Each result type applies the same access check and rights
 * scope as its list. Phase 1 covers CRM entities with ILIKE; tickets, KB articles and
 * full-text ranking arrive in Phase 6.
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ContactsService) private readonly contactsService: ContactsService,
    @Inject(AccountsService) private readonly accountsService: AccountsService,
    @Inject(RecordsService) private readonly recordsService: RecordsService,
  ) {}

  async search(auth: AuthContext, q: string) {
    const term = q.trim();
    const empty = { contacts: [], accounts: [], records: [] };
    if (term.length < SEARCH_MIN_LENGTH) return empty;
    const can = (m: 'crm_contacts' | 'crm_accounts' | 'crm_records') =>
      checkModuleAccess(auth.principal, m, 'read').allowed;

    const contactRows = can('crm_contacts')
      ? await this.db
          .select({ id: contacts.id, name: contacts.name, emails: contacts.emails, phones: contacts.phones })
          .from(contacts)
          .where(
            and(
              isNull(contacts.deletedAt),
              scopeSql(contacts.databaseId, crmDatabaseScope(auth.rights)),
              this.contactsService.searchSql(term),
            ),
          )
          .orderBy(asc(sql`lower(${contacts.name})`))
          .limit(PER_TYPE)
      : [];
    const accountRows = can('crm_accounts')
      ? await this.db
          .select({ id: accounts.id, name: accounts.name })
          .from(accounts)
          .where(
            and(
              isNull(accounts.deletedAt),
              scopeSql(accounts.databaseId, crmDatabaseScope(auth.rights)),
              this.accountsService.searchSql(term),
            ),
          )
          .orderBy(asc(sql`lower(${accounts.name})`))
          .limit(PER_TYPE)
      : [];
    const recordRows = can('crm_records')
      ? await this.db
          .select({ id: crmRecords.id, title: crmRecords.title, stage: crmRecords.stage })
          .from(crmRecords)
          .where(
            and(
              isNull(crmRecords.deletedAt),
              scopeSql(crmRecords.recordTypeId, recordTypeScope(auth.rights)),
              this.recordsService.searchSql(term),
            ),
          )
          .orderBy(asc(sql`lower(${crmRecords.title})`))
          .limit(PER_TYPE)
      : [];
    return { contacts: contactRows, accounts: accountRows, records: recordRows };
  }
}

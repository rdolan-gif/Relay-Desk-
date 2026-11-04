import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, isNull, sql } from 'drizzle-orm';
import { checkModuleAccess, crmDatabaseScope, recordTypeScope } from '@relay-desk/domain';
import type { AuthContext } from '../common/request-context';
import { scopeSql } from '../crm/crm-common';
import { AccountsService } from '../crm/accounts.service';
import { ContactsService } from '../crm/contacts.service';
import { RecordsService } from '../crm/records.service';
import { DB, type Db } from '../db/db';
import { accounts, contacts, crmRecords, tickets } from '../db/schema';
import { KbService } from '../kb/kb.service';
import { TicketsService } from '../tickets/tickets.service';

export const SEARCH_MIN_LENGTH = 3;
const PER_TYPE = 8;

/**
 * Global search (spec 14). Each result type applies the same access check and rights
 * scope as its list. Covers tickets (number, title, description, comments) and CRM entities
 * with ILIKE; KB articles and full-text ranking arrive in Phase 6.
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ContactsService) private readonly contactsService: ContactsService,
    @Inject(AccountsService) private readonly accountsService: AccountsService,
    @Inject(RecordsService) private readonly recordsService: RecordsService,
    @Inject(TicketsService) private readonly ticketsService: TicketsService,
    @Inject(KbService) private readonly kb: KbService,
  ) {}

  async search(auth: AuthContext, q: string) {
    const term = q.trim();
    const empty = { tickets: [], contacts: [], accounts: [], records: [], kb: [] };
    if (term.length < SEARCH_MIN_LENGTH) return empty;
    const can = (m: 'tickets' | 'crm_contacts' | 'crm_accounts' | 'crm_records' | 'knowledge_base') =>
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
              this.accountsService.searchSqlStandalone(term),
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
    const ticketRows = can('tickets')
      ? await this.db
          .select({ id: tickets.id, title: tickets.title, state: tickets.state })
          .from(tickets)
          .where(
            and(
              isNull(tickets.deletedAt),
              this.ticketsService.categoryScope(auth),
              this.ticketsService.searchSql(term),
            ),
          )
          .orderBy(desc(tickets.id))
          .limit(PER_TYPE)
      : [];
    const kbRows = can('knowledge_base')
      ? (await this.kb.list(auth, { q: term, limit: PER_TYPE })).map((a) => ({ id: a.id, title: a.title }))
      : [];
    return { tickets: ticketRows, contacts: contactRows, accounts: accountRows, records: recordRows, kb: kbRows };
  }
}

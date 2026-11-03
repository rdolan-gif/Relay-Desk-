import { sql, type SQL } from 'drizzle-orm';
import { filterKindForFieldType, type CustomFieldDef, type FilterFieldDef } from '@relay-desk/domain';
import { tickets } from '../db/schema';

/** Filterable ticket fields (spec 6.1): system fields plus every custom field. */
export function ticketFilterFields(custom: Iterable<CustomFieldDef>): FilterFieldDef[] {
  return [
    { key: 'id', label: 'ID', kind: 'number' },
    { key: 'title', label: 'Title', kind: 'text' },
    { key: 'state', label: 'State', kind: 'option' },
    { key: 'statusIds', label: 'Status', kind: 'text_list' },
    { key: 'priority', label: 'Priority', kind: 'option' },
    { key: 'categoryId', label: 'Category', kind: 'ref' },
    { key: 'userId', label: 'User', kind: 'ref' },
    { key: 'contactId', label: 'Contact', kind: 'ref' },
    { key: 'deadline', label: 'Deadline', kind: 'datetime' },
    { key: 'reopenAt', label: 'Re-open date', kind: 'datetime' },
    { key: 'lastActivityAt', label: 'Last activity', kind: 'datetime' },
    { key: 'createdAt', label: 'Created', kind: 'datetime' },
    { key: 'updatedAt', label: 'Updated', kind: 'datetime' },
    ...[...custom].map((f) => ({ key: `custom.${f.id}`, label: f.name, kind: filterKindForFieldType(f.type) })),
  ];
}

export const TICKET_COLUMNS: Record<string, SQL> = {
  id: sql`${tickets.id}`,
  title: sql`${tickets.title}`,
  state: sql`${tickets.state}`,
  statusIds: sql`${tickets.statusIds}`,
  priority: sql`${tickets.priority}`,
  categoryId: sql`${tickets.categoryId}`,
  userId: sql`${tickets.userId}`,
  contactId: sql`${tickets.contactId}`,
  deadline: sql`${tickets.deadline}`,
  reopenAt: sql`${tickets.reopenAt}`,
  lastActivityAt: sql`${tickets.lastActivityAt}`,
  createdAt: sql`${tickets.createdAt}`,
  updatedAt: sql`${tickets.updatedAt}`,
};

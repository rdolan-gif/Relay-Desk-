import type { FilterFieldDef, FormLayout, Priority, TicketState } from '@relay-desk/domain';

export interface TicketStatus {
  id: string;
  title: string;
  color: string;
  description: string;
}

export interface Category {
  id: string;
  title: string;
  groupName: string;
  statusRequired: 'never' | 'on_close' | 'always';
  multipleStatuses: boolean;
  checkChildOnClose: boolean;
  autoArchiveDays: number | null;
  allowExternalComments: boolean;
  waitingRequiresReopen: boolean;
  defaultCrmDatabaseId: string | null;
  formLayout: FormLayout;
  autofocusTab: string;
  statusIds: string[];
  canSee?: boolean;
}

export interface TicketMeta {
  categories: Category[];
  statuses: TicketStatus[];
  filterFields: FilterFieldDef[];
  can: { createViews: boolean; bulkEdit: boolean; merge: boolean; delete: boolean; moveActivities: boolean };
}

export interface Ticket {
  id: number;
  title: string;
  description: string;
  categoryId: string;
  state: TicketState;
  statusIds: string[];
  priority: Priority;
  userId: string | null;
  contactId: string | null;
  parentId: number | null;
  mergedIntoId: number | null;
  deadline: string | null;
  reopenAt: string | null;
  customFields: Record<string, unknown>;
  version: number;
  createdAt: string;
  lastActivityAt: string;
  categoryTitle?: string;
  userName?: string | null;
  contactName?: string | null;
}

export interface TicketDetail extends Ticket {
  category: { id: string; title: string; allowExternalComments: boolean; autofocusTab: string };
  user: { id: string; name: string; isActive: boolean } | null;
  followers: { id: string; name: string }[];
  isFavourite: boolean;
  parent: { id: number; title: string } | null;
  children: { id: number; title: string; state: TicketState }[];
  contactCard: {
    id: string;
    name: string;
    emails: string[];
    phones: string[];
    account: { id: string; name: string } | null;
    otherOpenTickets: { id: number; title: string; state: TicketState }[];
    openRecordCount: number;
  } | null;
  visible?: boolean;
}

export interface Activity {
  id: string;
  type: 'comment' | 'email';
  userId: string | null;
  userName: string | null;
  isExternal: boolean;
  bodyHtml: string;
  mentionUserIds: string[];
  createdAt: string;
  editedAt: string | null;
}

export interface TicketView {
  id: string;
  ownerUserId: string | null;
  name: string;
  conditions: { field: string; op: string; value?: string | number | boolean }[];
  columns: string[] | null;
}

export interface Sidebar {
  teamViews: TicketView[];
  myViews: TicketView[];
  items: { viewId: string; position: number; folder: string | null; parentViewId: string | null }[];
}

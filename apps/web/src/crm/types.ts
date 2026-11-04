import type { CustomFieldDef, FilterCondition, FilterFieldDef, FormLayout, RecordStatusDef } from '@relay-desk/domain';

export interface CrmDatabase {
  id: string;
  title: string;
  isDefault: boolean;
  contactFormLayout: FormLayout;
  accountFormLayout: FormLayout;
}

export interface RecordType {
  id: string;
  title: string;
  statuses: RecordStatusDef[];
  formLayout: FormLayout;
}

export interface CrmMeta {
  databases: CrmDatabase[];
  recordTypes: RecordType[];
  customFields: CustomFieldDef[];
  filterFields: Record<Exclude<ListName, 'tickets'>, FilterFieldDef[]>;
}

export type ListName = 'contacts' | 'accounts' | 'records' | 'tickets';
export type CustomValues = Record<string, unknown>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Contact {
  id: string;
  databaseId: string;
  accountId: string | null;
  name: string;
  emails: string[];
  phones: string[];
  customFields: CustomValues;
  createdAt: string;
  updatedAt: string;
  accountName?: string | null;
  databaseTitle?: string;
  account?: { id: string; name: string } | null;
  database?: { id: string; title: string } | null;
}

export interface Address {
  label: string;
  line1: string;
  line2?: string;
  town: string;
  county?: string;
  postcode: string;
  country: string;
  isDelivery: boolean;
}

export interface Account {
  id: string;
  databaseId: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  branchCode: string | null;
  slaId?: string | null;
  path: string;
  emails: string[];
  phones: string[];
  addresses: Address[];
  branchCount?: number;
  branches?: Account[];
  customFields: CustomValues;
  createdAt: string;
  updatedAt: string;
  databaseTitle?: string;
  contactCount?: number;
}

export interface CrmRecord {
  id: string;
  recordTypeId: string;
  title: string;
  status: string | null;
  stage: 'open' | 'closed';
  contactId: string | null;
  accountId: string | null;
  userId: string | null;
  customFields: CustomValues;
  createdAt: string;
  updatedAt: string;
  recordTypeTitle?: string;
  contactName?: string | null;
  accountName?: string | null;
  userName?: string | null;
}

export interface HistoryEntry {
  id: number;
  action: string;
  changes: { field: string; old: unknown; new: unknown }[];
  createdAt: string;
  userId: string | null;
  userName: string | null;
  sessionId: string | null;
}

export interface FilterScheme {
  id: string;
  list: ListName;
  name: string;
  conditions: FilterCondition[];
}

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
}

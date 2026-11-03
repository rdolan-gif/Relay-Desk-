import { Badge, Button, Text } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { formatPhoneForDisplay, sortedOptions, type CustomFieldDef } from '@relay-desk/domain';
import { useAuth } from '../../auth';
import { CopyValue } from '../../components/CopyValue';
import { EntityList, type Column } from '../../components/EntityList';
import { useCrmMeta, useUserDirectory } from '../../crm/hooks';
import type { Account, Contact, CrmRecord, CustomValues } from '../../crm/types';
import { formatDateTime } from '../../format';
import { t } from '../../i18n/en-GB';

/** Renders a stored custom value for a list cell. */
function customCell(def: CustomFieldDef, values: CustomValues) {
  const v = values[def.id];
  if (v === undefined || v === null || v === '') return t.crm.none;
  const label = (x: unknown) => def.options.find((o) => o.value === x)?.label ?? String(x);
  if (Array.isArray(v)) return v.map(label).join(', ');
  if (def.type === 'checkbox') return v ? 'Yes' : 'No';
  if (def.type === 'phone') return formatPhoneForDisplay(String(v));
  if (def.options.length) return label(v);
  return String(v);
}

function customColumns<T extends { customFields: CustomValues }>(fields: CustomFieldDef[]): Column<T>[] {
  return fields.map((f) => ({
    key: `custom.${f.id}`,
    label: f.name,
    render: (row: T) => customCell(f, row.customFields),
  }));
}

/** Option and reference choices so filter values can be picked rather than typed. */
function filterChoices(fields: CustomFieldDef[], extra: Record<string, { value: string; label: string }[]>) {
  const out: Record<string, { value: string; label: string }[]> = { ...extra };
  for (const f of fields)
    if (f.options.length)
      out[`custom.${f.id}`] = sortedOptions(f.options).map((o) => ({ value: o.value, label: o.label }));
  return out;
}

export function ContactsPage() {
  const nav = useNavigate();
  const { me, can } = useAuth();
  const meta = useCrmMeta();
  if (!meta.data) return null;
  const tz = me!.user.timezone;
  const columns: Column<Contact>[] = [
    { key: 'name', label: t.crm.name, render: (c) => c.name, sortKey: 'name' },
    {
      key: 'emails',
      label: t.crm.emails,
      render: (c) => (c.emails[0] ? <CopyValue value={c.emails[0]} display={c.emails.join(', ')} /> : t.crm.none),
    },
    {
      key: 'phones',
      label: t.crm.phones,
      render: (c) =>
        c.phones[0] ? (
          <CopyValue
            value={formatPhoneForDisplay(c.phones[0])}
            display={c.phones.map((p) => formatPhoneForDisplay(p)).join(', ')}
          />
        ) : (
          t.crm.none
        ),
    },
    { key: 'accountName', label: t.crm.account, render: (c) => c.accountName ?? t.crm.none },
    { key: 'databaseTitle', label: t.crm.database, render: (c) => c.databaseTitle },
    { key: 'createdAt', label: t.crm.created, render: (c) => formatDateTime(c.createdAt, tz), sortKey: 'createdAt' },
    { key: 'updatedAt', label: t.crm.updated, render: (c) => formatDateTime(c.updatedAt, tz), sortKey: 'updatedAt' },
    ...customColumns<Contact>(meta.data.customFields),
  ];
  return (
    <EntityList<Contact>
      list="contacts"
      title={t.crm.contacts}
      endpoint="/crm/contacts"
      columns={columns}
      defaultColumns={['name', 'emails', 'phones', 'accountName', 'updatedAt']}
      filterFields={meta.data.filterFields.contacts}
      filterChoices={filterChoices(meta.data.customFields, {
        databaseId: meta.data.databases.map((d) => ({ value: d.id, label: d.title })),
      })}
      onOpen={(c) => nav(`/crm/contacts/${c.id}`)}
      actions={
        can('crm_contacts', 'create') && <Button onClick={() => nav('/crm/contacts/new')}>{t.crm.newContact}</Button>
      }
    />
  );
}

export function AccountsPage() {
  const nav = useNavigate();
  const { me, can } = useAuth();
  const meta = useCrmMeta();
  if (!meta.data) return null;
  const tz = me!.user.timezone;
  const columns: Column<Account>[] = [
    { key: 'name', label: t.crm.name, render: (a) => a.name, sortKey: 'name' },
    { key: 'contactCount', label: t.crm.contactCount, render: (a) => a.contactCount ?? 0 },
    { key: 'databaseTitle', label: t.crm.database, render: (a) => a.databaseTitle },
    { key: 'createdAt', label: t.crm.created, render: (a) => formatDateTime(a.createdAt, tz), sortKey: 'createdAt' },
    { key: 'updatedAt', label: t.crm.updated, render: (a) => formatDateTime(a.updatedAt, tz), sortKey: 'updatedAt' },
    ...customColumns<Account>(meta.data.customFields),
  ];
  return (
    <EntityList<Account>
      list="accounts"
      title={t.crm.accounts}
      endpoint="/crm/accounts"
      columns={columns}
      defaultColumns={['name', 'contactCount', 'databaseTitle', 'updatedAt']}
      filterFields={meta.data.filterFields.accounts}
      filterChoices={filterChoices(meta.data.customFields, {
        databaseId: meta.data.databases.map((d) => ({ value: d.id, label: d.title })),
      })}
      onOpen={(a) => nav(`/crm/accounts/${a.id}`)}
      actions={
        can('crm_accounts', 'create') && <Button onClick={() => nav('/crm/accounts/new')}>{t.crm.newAccount}</Button>
      }
    />
  );
}

export function RecordsPage() {
  const nav = useNavigate();
  const { me, can } = useAuth();
  const meta = useCrmMeta();
  const users = useUserDirectory();
  if (!meta.data) return null;
  const tz = me!.user.timezone;
  const statusTitle = (r: CrmRecord) =>
    meta.data!.recordTypes.find((rt) => rt.id === r.recordTypeId)?.statuses.find((s) => s.key === r.status)?.title ??
    r.status;
  const columns: Column<CrmRecord>[] = [
    { key: 'title', label: t.crm.title, render: (r) => r.title, sortKey: 'title' },
    { key: 'recordTypeTitle', label: t.crm.recordType, render: (r) => r.recordTypeTitle },
    { key: 'status', label: t.crm.status, render: (r) => statusTitle(r) ?? t.crm.none },
    {
      key: 'stage',
      label: t.crm.stage,
      render: (r) => (
        <Badge color={r.stage === 'open' ? 'teal' : 'gray'} variant="light">
          {t.crm.stages[r.stage]}
        </Badge>
      ),
    },
    { key: 'contactName', label: t.crm.contact, render: (r) => r.contactName ?? t.crm.none },
    { key: 'accountName', label: t.crm.account, render: (r) => r.accountName ?? t.crm.none },
    { key: 'userName', label: t.crm.owner, render: (r) => <Text size="sm">{r.userName ?? t.crm.none}</Text> },
    { key: 'updatedAt', label: t.crm.updated, render: (r) => formatDateTime(r.updatedAt, tz), sortKey: 'updatedAt' },
    ...customColumns<CrmRecord>(meta.data.customFields),
  ];
  const statuses = meta.data.recordTypes.flatMap((rt) =>
    rt.statuses.map((s) => ({ value: s.key, label: `${rt.title}: ${s.title}` })),
  );
  return (
    <EntityList<CrmRecord>
      list="records"
      title={t.crm.records}
      endpoint="/crm/records"
      columns={columns}
      defaultColumns={['title', 'recordTypeTitle', 'status', 'stage', 'contactName', 'userName', 'updatedAt']}
      filterFields={meta.data.filterFields.records}
      filterChoices={filterChoices(meta.data.customFields, {
        recordTypeId: meta.data.recordTypes.map((rt) => ({ value: rt.id, label: rt.title })),
        status: statuses,
        stage: [
          { value: 'open', label: t.crm.stages.open },
          { value: 'closed', label: t.crm.stages.closed },
        ],
        userId: (users.data ?? []).map((u) => ({ value: u.id, label: u.name })),
      })}
      onOpen={(r) => nav(`/crm/records/${r.id}`)}
      actions={
        can('crm_records', 'create') && <Button onClick={() => nav('/crm/records/new')}>{t.crm.newRecord}</Button>
      }
    />
  );
}

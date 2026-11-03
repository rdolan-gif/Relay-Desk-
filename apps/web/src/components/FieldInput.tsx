import { Checkbox, MultiSelect, NumberInput, Radio, Select, Stack, TextInput, Textarea } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { sortedOptions, type CustomFieldDef, type FieldPlacement } from '@relay-desk/domain';
import { api } from '../api';
import { qs, useUserDirectory } from '../crm/hooks';
import type { Contact, Page } from '../crm/types';

interface Props {
  def: CustomFieldDef;
  placement?: FieldPlacement;
  value: unknown;
  onChange: (value: unknown) => void;
  readOnly?: boolean;
  error?: string;
}

/** One custom field input, chosen by field type (spec 7.3). */
export function FieldInput({ def, placement, value, onChange, readOnly, error }: Props) {
  const common = {
    label: def.name,
    description: placement?.tooltip,
    required: placement?.required,
    disabled: readOnly || placement?.readOnly,
    error,
  };
  const options = sortedOptions(def.options).map((o) => ({ value: o.value, label: o.label }));
  const str = typeof value === 'string' ? value : '';
  switch (def.type) {
    case 'textarea':
      return (
        <Textarea
          {...common}
          autosize
          minRows={placement?.rows ?? 3}
          value={str}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      );
    case 'number':
      return (
        <NumberInput
          {...common}
          value={typeof value === 'number' ? value : ''}
          onChange={(v) => onChange(v === '' ? null : v)}
        />
      );
    case 'date':
      return (
        <TextInput {...common} type="date" value={str} onChange={(e) => onChange(e.currentTarget.value || null)} />
      );
    case 'datetime':
      return (
        <TextInput
          {...common}
          type="datetime-local"
          value={str ? toLocalInput(str) : ''}
          onChange={(e) => onChange(e.currentTarget.value ? new Date(e.currentTarget.value).toISOString() : null)}
        />
      );
    case 'select':
      return <Select {...common} data={options} value={str || null} onChange={(v) => onChange(v)} clearable />;
    case 'multiselect':
      return (
        <MultiSelect
          {...common}
          data={options}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          clearable
        />
      );
    case 'radio':
      return (
        <Radio.Group {...common} value={str} onChange={onChange}>
          <Stack gap={4} mt={4}>
            {options.map((o) => (
              <Radio key={o.value} value={o.value} label={o.label} disabled={common.disabled} />
            ))}
          </Stack>
        </Radio.Group>
      );
    case 'checkbox':
      return (
        <Checkbox
          label={def.name}
          description={placement?.tooltip}
          disabled={common.disabled}
          error={error}
          checked={value === true}
          onChange={(e) => onChange(e.currentTarget.checked)}
        />
      );
    case 'user':
      return <UserPicker {...common} value={str || null} onChange={onChange} />;
    case 'contact':
      return <ContactPicker {...common} value={str || null} onChange={onChange} />;
    case 'email':
      return <TextInput {...common} type="email" value={str} onChange={(e) => onChange(e.currentTarget.value)} />;
    case 'url':
      return <TextInput {...common} type="url" value={str} onChange={(e) => onChange(e.currentTarget.value)} />;
    case 'phone':
      return <TextInput {...common} type="tel" value={str} onChange={(e) => onChange(e.currentTarget.value)} />;
    default:
      return <TextInput {...common} value={str} onChange={(e) => onChange(e.currentTarget.value)} />;
  }
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type PickerProps = {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  description?: string;
  error?: string;
};

export function UserPicker(props: PickerProps) {
  const users = useUserDirectory();
  return (
    <Select {...props} data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))} searchable clearable />
  );
}

/**
 * One label per contact: the select syncs its search text to the selected label, so a
 * label that changed between queries would trigger an endless search loop.
 */
const contactLabel = (c: Contact) => `${c.name}${c.emails[0] ? ` (${c.emails[0]})` : ''}`;

/** Searches visible contacts as you type. */
export function ContactPicker(props: PickerProps & { databaseId?: string }) {
  const [search, setSearch] = useState('');
  const current = useQuery({
    queryKey: ['contact', props.value],
    queryFn: () => api<Contact>('GET', `/crm/contacts/${props.value}`),
    enabled: !!props.value,
  });
  const results = useQuery({
    queryKey: ['contact-search', search],
    queryFn: () => api<Page<Contact>>('GET', `/crm/contacts${qs({ q: search, pageSize: 20 })}`),
    enabled: search.length >= 2 && !(current.data && search === contactLabel(current.data)),
  });
  const data = new Map<string, string>();
  if (current.data) data.set(current.data.id, contactLabel(current.data));
  for (const c of results.data?.items ?? []) data.set(c.id, contactLabel(c));
  return (
    <Select
      {...props}
      data={[...data].map(([value, label]) => ({ value, label }))}
      searchable
      clearable
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options }) => options}
      nothingFoundMessage={search.length >= 2 ? 'No contacts found' : 'Type to search'}
    />
  );
}

/** Searches visible accounts, optionally only within one CRM database. */
export function AccountPicker(props: PickerProps & { databaseId?: string }) {
  const [search, setSearch] = useState('');
  const current = useQuery({
    queryKey: ['account', props.value],
    queryFn: () => api<{ id: string; name: string }>('GET', `/crm/accounts/${props.value}`),
    enabled: !!props.value,
  });
  const filter = props.databaseId
    ? JSON.stringify([{ field: 'databaseId', op: 'is', value: props.databaseId }])
    : undefined;
  const results = useQuery({
    queryKey: ['account-search', search, props.databaseId],
    queryFn: () =>
      api<Page<{ id: string; name: string }>>(
        'GET',
        `/crm/accounts${qs({ q: search || undefined, filter, pageSize: 20 })}`,
      ),
  });
  const data = new Map<string, string>();
  if (current.data) data.set(current.data.id, current.data.name);
  for (const a of results.data?.items ?? []) data.set(a.id, a.name);
  const { databaseId: _db, ...rest } = props;
  return (
    <Select
      {...rest}
      data={[...data].map(([value, label]) => ({ value, label }))}
      searchable
      clearable
      searchValue={search}
      onSearchChange={setSearch}
      filter={({ options }) => options}
    />
  );
}

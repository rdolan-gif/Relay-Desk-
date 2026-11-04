import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Grid,
  Group,
  Paper,
  Select,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatPhoneForDisplay } from '@relay-desk/domain';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { CopyValue } from '../../components/CopyValue';
import { DynamicForm } from '../../components/DynamicForm';
import { AccountPicker } from '../../components/FieldInput';
import { MultiValueInput } from '../../components/MultiValueInput';
import { HistoryPanel } from '../../components/HistoryPanel';
import { useCrmMeta } from '../../crm/hooks';
import type { Account, Address, Contact, CustomValues, Page } from '../../crm/types';
import { STATE_COLOURS } from '../../tickets/hooks';
import type { Ticket } from '../../tickets/types';
import { useFieldErrors } from '../../crm/useEntityForm';
import { formatDateTime } from '../../format';
import { t } from '../../i18n/en-GB';
import { notifyOk } from '../../notify';
import { RecordsTable } from './RecordsTable';

interface Draft {
  name: string;
  databaseId: string;
  parentId: string | null;
  branchCode: string | null;
  emails: string[];
  phones: string[];
  addresses: Address[];
  customFields: CustomValues;
}

const EMPTY_ADDRESS: Address = { label: '', line1: '', town: '', postcode: '', country: 'GB', isDelivery: true };

export function AccountPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me, can } = useAuth();
  const meta = useCrmMeta();
  const fieldErrors = useFieldErrors();
  const account = useQuery({
    queryKey: ['account', id],
    queryFn: () => api<Account>('GET', `/crm/accounts/${id}`),
    enabled: !isNew,
  });
  const contacts = useQuery({
    queryKey: ['account-contacts', id],
    queryFn: () => api<Contact[]>('GET', `/crm/accounts/${id}/contacts`),
    enabled: !isNew,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewAt, setViewAt] = useState<string | null>(null);

  useEffect(() => {
    if (isNew && meta.data && !draft) {
      const db = meta.data.databases.find((d) => d.isDefault) ?? meta.data.databases[0];
      setDraft({
        name: '',
        databaseId: db?.id ?? '',
        parentId: params.get('parentId'),
        branchCode: null,
        emails: [],
        phones: [],
        addresses: [],
        customFields: {},
      });
    }
    if (!isNew && account.data)
      setDraft({
        name: account.data.name,
        databaseId: account.data.databaseId,
        parentId: account.data.parentId,
        branchCode: account.data.branchCode,
        emails: account.data.emails,
        phones: account.data.phones,
        addresses: account.data.addresses,
        customFields: account.data.customFields,
      });
  }, [isNew, meta.data, account.data]);

  const snapshot = useQuery({
    queryKey: ['account-snapshot', id, viewAt],
    queryFn: () => api<Draft>('GET', `/crm/accounts/${id}/snapshot?at=${encodeURIComponent(viewAt!)}`),
    enabled: !!viewAt,
  });

  const save = useMutation({
    mutationFn: (d: Draft) =>
      isNew ? api<Account>('POST', '/crm/accounts', d) : api<Account>('PATCH', `/crm/accounts/${id}`, d),
    onSuccess: async (saved) => {
      fieldErrors.clear();
      notifyOk();
      await qc.invalidateQueries({ queryKey: ['/crm/accounts'] });
      await qc.invalidateQueries({ queryKey: ['account', saved.id] });
      await qc.invalidateQueries({ queryKey: [`/crm/accounts/${saved.id}`, 'history'] });
      if (isNew) nav(`/crm/accounts/${saved.id}`, { replace: true });
    },
    onError: fieldErrors.handle,
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/crm/accounts/${id}`),
    onSuccess: () => nav('/crm/accounts'),
    onError: fieldErrors.handle,
  });

  if (!draft || !meta.data) return <Text>{t.common.loading}</Text>;
  const database = meta.data.databases.find((d) => d.id === draft.databaseId);
  const shown = viewAt && snapshot.data ? snapshot.data : draft;
  const readOnly = !!viewAt || !can('crm_accounts', isNew ? 'create' : 'update');
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const isCompany = (account.data?.branches?.length ?? 0) > 0;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{isNew ? t.crm.newAccount : account.data?.path}</Title>
        <Group>
          {!isNew && can('crm_accounts', 'delete') && (
            <Button color="red" variant="subtle" onClick={() => window.confirm(t.crm.confirmDelete) && remove.mutate()}>
              {t.crm.delete}
            </Button>
          )}
          {!readOnly && (
            <Button loading={save.isPending} onClick={() => save.mutate(draft)}>
              {isNew ? t.crm.create : t.crm.save}
            </Button>
          )}
        </Group>
      </Group>
      {viewAt && (
        <Alert color="blue">
          <Group justify="space-between">
            <Text size="sm">{t.crm.history.viewingAt(formatDateTime(viewAt, me!.user.timezone))}</Text>
            <Button size="compact-sm" variant="light" onClick={() => setViewAt(null)}>
              {t.crm.history.reset}
            </Button>
          </Group>
        </Alert>
      )}
      <Tabs defaultValue="form" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="form">{t.crm.tabs.form}</Tabs.Tab>
          {!isNew && !draft.parentId && <Tabs.Tab value="branches">{t.crm.branches}</Tabs.Tab>}
          {!isNew && <Tabs.Tab value="contacts">{t.crm.tabs.contacts}</Tabs.Tab>}
          {!isNew && can('tickets', 'read') && <Tabs.Tab value="tickets">{t.crm.tickets}</Tabs.Tab>}
          {!isNew && can('crm_records', 'read') && <Tabs.Tab value="records">{t.crm.tabs.records}</Tabs.Tab>}
          {!isNew && <Tabs.Tab value="history">{t.crm.tabs.history}</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="form" pt="md">
          <Grid>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Paper withBorder p="sm">
                <Stack gap="sm">
                  <TextInput
                    label={t.crm.name}
                    required
                    value={shown.name}
                    disabled={readOnly}
                    onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
                  />
                  <Select
                    label={t.crm.database}
                    data={meta.data.databases.map((d) => ({ value: d.id, label: d.title }))}
                    value={shown.databaseId}
                    disabled={readOnly}
                    allowDeselect={false}
                    onChange={(v) => v && setDraft({ ...draft, databaseId: v })}
                  />
                  {!isCompany && (
                    <AccountPicker
                      label={t.crm.company}
                      databaseId={shown.databaseId}
                      value={shown.parentId ?? null}
                      disabled={readOnly}
                      onChange={(parentId) => set({ parentId })}
                    />
                  )}
                  {shown.parentId && (
                    <TextInput
                      label={t.crm.branchCode}
                      value={shown.branchCode ?? ''}
                      disabled={readOnly}
                      onChange={(e) => set({ branchCode: e.currentTarget.value || null })}
                    />
                  )}
                  <MultiValueInput
                    label={t.crm.accountPhones}
                    addLabel={t.crm.addPhone}
                    type="tel"
                    values={shown.phones ?? []}
                    format={(v) => (v.startsWith('+') ? formatPhoneForDisplay(v) : v)}
                    readOnly={readOnly}
                    onChange={(phones) => set({ phones })}
                  />
                  <MultiValueInput
                    label={t.crm.accountEmails}
                    addLabel={t.crm.addEmail}
                    type="email"
                    values={shown.emails ?? []}
                    readOnly={readOnly}
                    onChange={(emails) => set({ emails })}
                  />
                </Stack>
              </Paper>
              <Paper withBorder p="sm" mt="sm">
                <AddressesEditor
                  value={shown.addresses ?? []}
                  readOnly={readOnly}
                  onChange={(addresses) => set({ addresses })}
                />
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 7 }}>
              {database && (
                <DynamicForm
                  layout={database.accountFormLayout}
                  fields={meta.data.customFields}
                  values={shown.customFields}
                  readOnly={readOnly}
                  errors={fieldErrors.errors}
                  onChange={(customFields) => setDraft({ ...draft, customFields })}
                />
              )}
            </Grid.Col>
          </Grid>
        </Tabs.Panel>
        {!isNew && (
          <Tabs.Panel value="contacts" pt="md">
            {contacts.data?.length === 0 ? (
              <Text c="dimmed">{t.crm.noResults}</Text>
            ) : (
              <Table highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t.crm.name}</Table.Th>
                    <Table.Th>{t.crm.emails}</Table.Th>
                    <Table.Th>{t.crm.phones}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {contacts.data?.map((c) => (
                    <Table.Tr key={c.id}>
                      <Table.Td>
                        <Text
                          size="sm"
                          style={{ cursor: 'pointer' }}
                          td="underline"
                          onClick={() => nav(`/crm/contacts/${c.id}`)}
                        >
                          {c.name}
                        </Text>
                      </Table.Td>
                      <Table.Td>{c.emails[0] ? <CopyValue value={c.emails[0]} /> : t.crm.none}</Table.Td>
                      <Table.Td>
                        {c.phones[0] ? <CopyValue value={formatPhoneForDisplay(c.phones[0])} /> : t.crm.none}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Tabs.Panel>
        )}
        {!isNew && (
          <Tabs.Panel value="branches" pt="md">
            <Stack>
              {can('crm_accounts', 'create') && (
                <Group>
                  <Button size="xs" variant="light" onClick={() => nav(`/crm/accounts/new?parentId=${id}`)}>
                    {t.crm.addBranch}
                  </Button>
                </Group>
              )}
              {(account.data?.branches ?? []).length === 0 ? (
                <Text c="dimmed">{t.crm.noResults}</Text>
              ) : (
                <Table highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t.crm.name}</Table.Th>
                      <Table.Th>{t.crm.branchCode}</Table.Th>
                      <Table.Th>{t.crm.accountPhones}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {account.data?.branches?.map((b) => (
                      <Table.Tr key={b.id} onClick={() => nav(`/crm/accounts/${b.id}`)} style={{ cursor: 'pointer' }}>
                        <Table.Td>{b.name}</Table.Td>
                        <Table.Td>{b.branchCode ?? t.crm.none}</Table.Td>
                        <Table.Td>{b.phones.map((p) => formatPhoneForDisplay(p)).join(', ') || t.crm.none}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
          </Tabs.Panel>
        )}
        {!isNew && (
          <Tabs.Panel value="tickets" pt="md">
            <AccountTickets accountId={id!} />
          </Tabs.Panel>
        )}
        {!isNew && (
          <Tabs.Panel value="records" pt="md">
            <RecordsTable endpoint={`/crm/accounts/${id}/records`} newRecordQuery={`accountId=${id}`} />
          </Tabs.Panel>
        )}
        {!isNew && (
          <Tabs.Panel value="history" pt="md">
            <HistoryPanel endpoint={`/crm/accounts/${id}`} onViewAt={setViewAt} />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}

/** Tickets from this account's contacts (and its branches' contacts, for a company). */
function AccountTickets({ accountId }: { accountId: string }) {
  const nav = useNavigate();
  const list = useQuery({
    queryKey: ['account-tickets', accountId],
    queryFn: () => api<Page<Ticket>>('GET', `/crm/accounts/${accountId}/tickets?pageSize=200`),
  });
  if (list.data?.items.length === 0) return <Text c="dimmed">{t.crm.noResults}</Text>;
  return (
    <Table highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t.tickets.id}</Table.Th>
          <Table.Th>{t.tickets.titleField}</Table.Th>
          <Table.Th>{t.tickets.contact}</Table.Th>
          <Table.Th>{t.tickets.state}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {list.data?.items.map((tk) => (
          <Table.Tr key={tk.id} onClick={() => nav(`/tickets/${tk.id}`)} style={{ cursor: 'pointer' }}>
            <Table.Td>#{tk.id}</Table.Td>
            <Table.Td>{tk.title}</Table.Td>
            <Table.Td>{tk.contactName ?? t.crm.none}</Table.Td>
            <Table.Td>
              <Badge color={STATE_COLOURS[tk.state]} variant="light">
                {t.tickets.states[tk.state]}
              </Badge>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** Postal addresses; delivery addresses show on the ticket contact card (owner Q2). */
function AddressesEditor({
  value,
  onChange,
  readOnly,
}: {
  value: Address[];
  onChange: (v: Address[]) => void;
  readOnly: boolean;
}) {
  const update = (i: number, patch: Partial<Address>) =>
    onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <Stack gap="sm">
      <Text size="sm" fw={500}>
        {t.crm.addresses}
      </Text>
      {value.map((a, i) => (
        <Paper key={i} withBorder p="xs">
          <Stack gap={6}>
            <Group grow>
              <TextInput
                size="xs"
                label={t.crm.addressLabel}
                value={a.label}
                disabled={readOnly}
                onChange={(e) => update(i, { label: e.currentTarget.value })}
              />
              <Checkbox
                mt="lg"
                size="xs"
                label={t.crm.delivery}
                checked={a.isDelivery}
                disabled={readOnly}
                onChange={(e) => update(i, { isDelivery: e.currentTarget.checked })}
              />
            </Group>
            <TextInput
              size="xs"
              label={t.crm.line1}
              value={a.line1}
              disabled={readOnly}
              onChange={(e) => update(i, { line1: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              label={t.crm.line2}
              value={a.line2 ?? ''}
              disabled={readOnly}
              onChange={(e) => update(i, { line2: e.currentTarget.value })}
            />
            <Group grow>
              <TextInput
                size="xs"
                label={t.crm.town}
                value={a.town}
                disabled={readOnly}
                onChange={(e) => update(i, { town: e.currentTarget.value })}
              />
              <TextInput
                size="xs"
                label={t.crm.county}
                value={a.county ?? ''}
                disabled={readOnly}
                onChange={(e) => update(i, { county: e.currentTarget.value })}
              />
              <TextInput
                size="xs"
                label={t.crm.postcode}
                value={a.postcode}
                disabled={readOnly}
                onChange={(e) => update(i, { postcode: e.currentTarget.value })}
              />
            </Group>
            {!readOnly && (
              <Group justify="flex-end">
                <Button
                  size="compact-xs"
                  color="red"
                  variant="subtle"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                >
                  {t.builder.remove}
                </Button>
              </Group>
            )}
          </Stack>
        </Paper>
      ))}
      {!readOnly && (
        <Group>
          <Button size="compact-xs" variant="subtle" onClick={() => onChange([...value, { ...EMPTY_ADDRESS }])}>
            + {t.crm.addAddress}
          </Button>
        </Group>
      )}
    </Stack>
  );
}

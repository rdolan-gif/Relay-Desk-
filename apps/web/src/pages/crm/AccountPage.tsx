import { Alert, Button, Grid, Group, Paper, Select, Stack, Table, Tabs, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { formatPhoneForDisplay } from '@relay-desk/domain';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { CopyValue } from '../../components/CopyValue';
import { DynamicForm } from '../../components/DynamicForm';
import { HistoryPanel } from '../../components/HistoryPanel';
import { useCrmMeta } from '../../crm/hooks';
import type { Account, Contact, CustomValues } from '../../crm/types';
import { useFieldErrors } from '../../crm/useEntityForm';
import { formatDateTime } from '../../format';
import { t } from '../../i18n/en-GB';
import { notifyOk } from '../../notify';
import { RecordsTable } from './RecordsTable';

interface Draft {
  name: string;
  databaseId: string;
  customFields: CustomValues;
}

export function AccountPage() {
  const { id } = useParams();
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
      setDraft({ name: '', databaseId: db?.id ?? '', customFields: {} });
    }
    if (!isNew && account.data)
      setDraft({
        name: account.data.name,
        databaseId: account.data.databaseId,
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

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{isNew ? t.crm.newAccount : account.data?.name}</Title>
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
          {!isNew && <Tabs.Tab value="contacts">{t.crm.tabs.contacts}</Tabs.Tab>}
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
                </Stack>
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

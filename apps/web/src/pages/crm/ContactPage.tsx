import { Alert, Anchor, Button, Grid, Group, Paper, Select, Stack, Tabs, Text, TextInput, Title } from '@mantine/core';
import { JobModal } from '../../components/JobModal';
import { ConfirmTyped } from '../../components/ConfirmTyped';
import { useDebouncedValue } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatPhoneForDisplay } from '@relay-desk/domain';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { DynamicForm } from '../../components/DynamicForm';
import { AccountPicker } from '../../components/FieldInput';
import { HistoryPanel } from '../../components/HistoryPanel';
import { MultiValueInput } from '../../components/MultiValueInput';
import { RecordsTable } from './RecordsTable';
import { useCrmMeta } from '../../crm/hooks';
import type { Contact, CustomValues } from '../../crm/types';
import { useFieldErrors } from '../../crm/useEntityForm';
import { formatDateTime } from '../../format';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';

interface Draft {
  name: string;
  databaseId: string;
  accountId: string | null;
  emails: string[];
  phones: string[];
  customFields: CustomValues;
}

export function ContactPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me, can, hasFlag } = useAuth();
  const [gdprJob, setGdprJob] = useState<string | null>(null);
  const [eraseOpen, setEraseOpen] = useState(false);
  const gdpr = useMutation({
    mutationFn: (fn: () => Promise<{ id: string }>) => fn(),
    onSuccess: (j) => {
      setEraseOpen(false);
      setGdprJob(j.id);
    },
    onError: notifyError,
  });
  const meta = useCrmMeta();
  const fieldErrors = useFieldErrors();
  const contact = useQuery({
    queryKey: ['contact', id],
    queryFn: () => api<Contact>('GET', `/crm/contacts/${id}`),
    enabled: !isNew,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewAt, setViewAt] = useState<string | null>(null);

  useEffect(() => {
    if (isNew && meta.data && !draft) {
      const db = meta.data.databases.find((d) => d.isDefault) ?? meta.data.databases[0];
      setDraft({ name: '', databaseId: db?.id ?? '', accountId: null, emails: [''], phones: [], customFields: {} });
    }
    if (!isNew && contact.data) {
      const c = contact.data;
      setDraft({
        name: c.name,
        databaseId: c.databaseId,
        accountId: c.accountId,
        emails: c.emails,
        phones: c.phones,
        customFields: c.customFields,
      });
    }
  }, [isNew, meta.data, contact.data]);

  const snapshot = useQuery({
    queryKey: ['contact-snapshot', id, viewAt],
    queryFn: () => api<Draft>('GET', `/crm/contacts/${id}/snapshot?at=${encodeURIComponent(viewAt!)}`),
    enabled: !!viewAt && !isNew,
  });

  // Possible-duplicate warning (Q-P1-9): never blocks saving.
  const [ids] = useDebouncedValue(
    JSON.stringify({ emails: draft?.emails.filter(Boolean) ?? [], phones: draft?.phones.filter(Boolean) ?? [] }),
    500,
  );
  const duplicates = useQuery({
    queryKey: ['duplicates', ids, id],
    queryFn: () =>
      api<{ id: string; name: string }[]>('POST', '/crm/contacts/duplicate-check', {
        ...JSON.parse(ids),
        excludeId: isNew ? undefined : id,
      }),
    enabled: !!draft && ids !== '{"emails":[],"phones":[]}',
  });

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = { ...d, emails: d.emails.filter((e) => e.trim()), phones: d.phones.filter((p) => p.trim()) };
      return isNew ? api<Contact>('POST', '/crm/contacts', body) : api<Contact>('PATCH', `/crm/contacts/${id}`, body);
    },
    onSuccess: async (saved) => {
      fieldErrors.clear();
      notifyOk();
      await qc.invalidateQueries({ queryKey: ['/crm/contacts'] });
      await qc.invalidateQueries({ queryKey: ['contact', saved.id] });
      await qc.invalidateQueries({ queryKey: [`/crm/contacts/${saved.id}`, 'history'] });
      if (isNew) nav(`/crm/contacts/${saved.id}`, { replace: true });
    },
    onError: fieldErrors.handle,
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/crm/contacts/${id}`),
    onSuccess: () => nav('/crm/contacts'),
    onError: fieldErrors.handle,
  });

  if (!draft || !meta.data) return <Text>{t.common.loading}</Text>;
  const database = meta.data.databases.find((d) => d.id === draft.databaseId);
  const shown: Draft = viewAt && snapshot.data ? snapshot.data : draft;
  const readOnly = !!viewAt || !can('crm_contacts', isNew ? 'create' : 'update');
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  return (
    <Stack>
      <ConfirmTyped
        opened={eraseOpen}
        title={t.gdpr.eraseTitle}
        help={t.gdpr.eraseHelp}
        phrase="ERASE"
        loading={gdpr.isPending}
        onClose={() => setEraseOpen(false)}
        onConfirm={(confirmation) => gdpr.mutate(() => api('POST', `/crm/contacts/${id}/erase`, { confirmation }))}
      />
      <JobModal
        jobId={gdprJob}
        onClose={() => {
          setGdprJob(null);
          void contact.refetch();
        }}
      />
      <Group justify="space-between">
        <Title order={2}>{isNew ? t.crm.newContact : contact.data?.name}</Title>
        <Group>
          {!isNew && hasFlag('can_export') && (
            <Button
              variant="default"
              title={t.gdpr.sarHelp}
              onClick={() => gdpr.mutate(() => api('POST', `/crm/contacts/${id}/subject-access-export`))}
            >
              {t.gdpr.sar}
            </Button>
          )}
          {!isNew && hasFlag('can_anonymise') && can('crm_contacts', 'update') && (
            <Button color="red" variant="subtle" onClick={() => setEraseOpen(true)}>
              {t.gdpr.erase}
            </Button>
          )}
          {!isNew && can('crm_contacts', 'delete') && (
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
      {duplicates.data && duplicates.data.length > 0 && (
        <Alert color="yellow">
          {t.crm.duplicates('')}
          {duplicates.data.map((d, i) => (
            <span key={d.id}>
              {i > 0 && ', '}
              <Anchor component={Link} to={`/crm/contacts/${d.id}`}>
                {d.name}
              </Anchor>
            </span>
          ))}
        </Alert>
      )}
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
                    onChange={(e) => set({ name: e.currentTarget.value })}
                  />
                  <Select
                    label={t.crm.database}
                    data={meta.data.databases.map((d) => ({ value: d.id, label: d.title }))}
                    value={shown.databaseId}
                    disabled={readOnly}
                    allowDeselect={false}
                    onChange={(v) => v && set({ databaseId: v, accountId: null })}
                  />
                  {can('crm_accounts', 'read') && (
                    <AccountPicker
                      label={t.crm.account}
                      databaseId={shown.databaseId}
                      value={shown.accountId}
                      disabled={readOnly}
                      onChange={(v) => set({ accountId: v })}
                    />
                  )}
                  {!isNew && contact.data?.account && !readOnly && (
                    <Anchor component={Link} to={`/crm/accounts/${contact.data.account.id}`} size="sm">
                      {contact.data.account.name} →
                    </Anchor>
                  )}
                  <MultiValueInput
                    label={t.crm.emails}
                    addLabel={t.crm.addEmail}
                    type="email"
                    values={shown.emails}
                    readOnly={readOnly}
                    onChange={(emails) => set({ emails })}
                  />
                  <MultiValueInput
                    label={t.crm.phones}
                    addLabel={t.crm.addPhone}
                    type="tel"
                    values={shown.phones}
                    format={(v) => (v.startsWith('+') ? formatPhoneForDisplay(v) : v)}
                    readOnly={readOnly}
                    onChange={(phones) => set({ phones })}
                  />
                </Stack>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 7 }}>
              {database && (
                <DynamicForm
                  layout={database.contactFormLayout}
                  fields={meta.data.customFields}
                  values={shown.customFields}
                  readOnly={readOnly}
                  errors={fieldErrors.errors}
                  onChange={(customFields) => set({ customFields })}
                />
              )}
            </Grid.Col>
          </Grid>
        </Tabs.Panel>
        {!isNew && (
          <Tabs.Panel value="records" pt="md">
            <RecordsTable endpoint={`/crm/contacts/${id}/records`} newRecordQuery={`contactId=${id}`} />
          </Tabs.Panel>
        )}
        {!isNew && (
          <Tabs.Panel value="history" pt="md">
            <HistoryPanel endpoint={`/crm/contacts/${id}`} onViewAt={setViewAt} />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}

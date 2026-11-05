import { Alert, Button, Grid, Group, Paper, Select, Stack, Tabs, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { DynamicForm } from '../../components/DynamicForm';
import { AccountPicker, ContactPicker, UserPicker } from '../../components/FieldInput';
import { HistoryPanel } from '../../components/HistoryPanel';
import { Segmented } from '../../components/Segmented';
import { useCrmMeta } from '../../crm/hooks';
import type { CrmRecord, CustomValues } from '../../crm/types';
import { useFieldErrors } from '../../crm/useEntityForm';
import { formatDateTime } from '../../format';
import { t } from '../../i18n/en-GB';
import { notifyOk } from '../../notify';

interface Draft {
  title: string;
  recordTypeId: string;
  status: string | null;
  stage: 'open' | 'closed';
  contactId: string | null;
  accountId: string | null;
  userId: string | null;
  customFields: CustomValues;
}

export function RecordPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me, can } = useAuth();
  const meta = useCrmMeta();
  const fieldErrors = useFieldErrors();
  const record = useQuery({
    queryKey: ['record', id],
    queryFn: () => api<CrmRecord>('GET', `/crm/records/${id}`),
    enabled: !isNew,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewAt, setViewAt] = useState<string | null>(null);

  useEffect(() => {
    if (isNew && meta.data && !draft) {
      setDraft({
        title: '',
        recordTypeId: meta.data.recordTypes[0]?.id ?? '',
        status: null,
        stage: 'open',
        contactId: params.get('contactId'),
        accountId: params.get('accountId'),
        userId: me!.user.id,
        customFields: {},
      });
    }
    if (!isNew && record.data) {
      const r = record.data;
      setDraft({
        title: r.title,
        recordTypeId: r.recordTypeId,
        status: r.status,
        stage: r.stage,
        contactId: r.contactId,
        accountId: r.accountId,
        userId: r.userId,
        customFields: r.customFields,
      });
    }
  }, [isNew, meta.data, record.data]);

  const snapshot = useQuery({
    queryKey: ['record-snapshot', id, viewAt],
    queryFn: () => api<Draft>('GET', `/crm/records/${id}/snapshot?at=${encodeURIComponent(viewAt!)}`),
    enabled: !!viewAt,
  });

  const save = useMutation({
    mutationFn: (d: Draft) =>
      isNew ? api<CrmRecord>('POST', '/crm/records', d) : api<CrmRecord>('PATCH', `/crm/records/${id}`, d),
    onSuccess: async (saved) => {
      fieldErrors.clear();
      notifyOk();
      await qc.invalidateQueries({ queryKey: ['/crm/records'] });
      await qc.invalidateQueries({ queryKey: ['record', saved.id] });
      await qc.invalidateQueries({ queryKey: [`/crm/records/${saved.id}`, 'history'] });
      if (isNew) nav(`/crm/records/${saved.id}`, { replace: true });
    },
    onError: fieldErrors.handle,
  });
  const remove = useMutation({
    mutationFn: () => api('DELETE', `/crm/records/${id}`),
    onSuccess: () => nav('/crm/records'),
    onError: fieldErrors.handle,
  });

  if (!draft || !meta.data) return <Text>{t.common.loading}</Text>;
  const type = meta.data.recordTypes.find((rt) => rt.id === draft.recordTypeId);
  const shown = viewAt && snapshot.data ? snapshot.data : draft;
  const readOnly = !!viewAt || !can('crm_records', isNew ? 'create' : 'update');
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{isNew ? t.crm.newRecord : record.data?.title}</Title>
        <Group>
          {!isNew && can('crm_records', 'delete') && (
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
          {!isNew && <Tabs.Tab value="history">{t.crm.tabs.history}</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="form" pt="md">
          <Grid>
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Paper withBorder p="sm">
                <Stack gap="sm">
                  <TextInput
                    label={t.crm.title}
                    required
                    value={shown.title}
                    disabled={readOnly}
                    onChange={(e) => set({ title: e.currentTarget.value })}
                  />
                  <Select
                    label={t.crm.recordType}
                    data={meta.data.recordTypes.map((rt) => ({ value: rt.id, label: rt.title }))}
                    value={shown.recordTypeId}
                    disabled={readOnly || !isNew}
                    allowDeselect={false}
                    onChange={(v) => v && set({ recordTypeId: v, status: null })}
                  />
                  <Select
                    label={t.crm.status}
                    data={(type?.statuses ?? []).map((s) => ({ value: s.key, label: s.title }))}
                    value={shown.status}
                    disabled={readOnly}
                    clearable
                    onChange={(v) => set({ status: v })}
                  />
                  <div>
                    <Text size="sm" fw={500} mb={4}>
                      {t.crm.stage}
                    </Text>
                    <Segmented
                      label={t.crm.stage}
                      data={[
                        { value: 'open', label: t.crm.stages.open },
                        { value: 'closed', label: t.crm.stages.closed },
                      ]}
                      value={shown.stage}
                      disabled={readOnly}
                      onChange={(v) => set({ stage: v as Draft['stage'] })}
                    />
                  </div>
                  {can('crm_contacts', 'read') && (
                    <ContactPicker
                      label={t.crm.contact}
                      value={shown.contactId}
                      disabled={readOnly}
                      onChange={(v) => set({ contactId: v })}
                    />
                  )}
                  {can('crm_accounts', 'read') && (
                    <AccountPicker
                      label={t.crm.account}
                      value={shown.accountId}
                      disabled={readOnly}
                      onChange={(v) => set({ accountId: v })}
                    />
                  )}
                  <UserPicker
                    label={t.crm.owner}
                    value={shown.userId}
                    disabled={readOnly}
                    onChange={(v) => set({ userId: v })}
                  />
                </Stack>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 7 }}>
              {type && (
                <DynamicForm
                  layout={type.formLayout}
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
          <Tabs.Panel value="history" pt="md">
            <HistoryPanel endpoint={`/crm/records/${id}`} onViewAt={setViewAt} />
          </Tabs.Panel>
        )}
      </Tabs>
    </Stack>
  );
}

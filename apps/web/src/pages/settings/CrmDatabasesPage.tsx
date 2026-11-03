import {
  ActionIcon,
  Button,
  Checkbox,
  Drawer,
  Group,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Badge,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CustomFieldDef } from '@relay-desk/domain';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { FormBuilder } from '../../components/FormBuilder';
import { useCrmMeta } from '../../crm/hooks';
import type { CrmDatabase, RecordType } from '../../crm/types';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';

/** The field pool from CRM metadata, so this page doesn't need the custom-fields settings page. */
function useFields() {
  const meta = useCrmMeta();
  return { data: meta.data?.customFields as CustomFieldDef[] | undefined };
}

function useSave<T extends { id?: string }>(base: string, key: string, done: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: T) => {
      const { id, ...body } = d;
      return id ? api('PUT', `${base}/${id}`, body) : api('POST', base, body);
    },
    onSuccess: async () => {
      done();
      notifyOk();
      await qc.invalidateQueries({ queryKey: [key] });
      await qc.invalidateQueries({ queryKey: ['crm-meta'] });
    },
    onError: notifyError,
  });
}

function useRemove(base: string, key: string, done: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api('DELETE', `${base}/${id}`),
    onSuccess: async () => {
      done();
      await qc.invalidateQueries({ queryKey: [key] });
      await qc.invalidateQueries({ queryKey: ['crm-meta'] });
    },
    onError: notifyError,
  });
}

type DbDraft = Omit<CrmDatabase, 'id'> & { id?: string };

/** Settings > CRM databases (spec 12.1) with contact and account form builders. */
export function CrmDatabasesPage() {
  const { can } = useAuth();
  const fields = useFields();
  const list = useQuery({
    queryKey: ['crm-databases'],
    queryFn: () => api<CrmDatabase[]>('GET', '/settings/crm-databases'),
  });
  const [draft, setDraft] = useState<DbDraft | null>(null);
  const save = useSave<DbDraft>('/settings/crm-databases', 'crm-databases', () => setDraft(null));
  const remove = useRemove('/settings/crm-databases', 'crm-databases', () => setDraft(null));

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.crmSettings.databases}</Title>
        {can('settings_crm_databases', 'create') && (
          <Button
            onClick={() =>
              setDraft({
                title: '',
                isDefault: false,
                contactFormLayout: { sections: [] },
                accountFormLayout: { sections: [] },
              })
            }
          >
            {t.crmSettings.addDatabase}
          </Button>
        )}
      </Group>
      <Table highlightOnHover>
        <Table.Tbody>
          {list.data?.map((d) => (
            <Table.Tr key={d.id} onClick={() => setDraft(d)} style={{ cursor: 'pointer' }}>
              <Table.Td>{d.title}</Table.Td>
              <Table.Td>{d.isDefault && <Badge variant="light">{t.crmSettings.isDefault}</Badge>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Drawer
        opened={!!draft}
        onClose={() => setDraft(null)}
        position="right"
        size="xl"
        title={draft?.id ? draft.title : t.crmSettings.addDatabase}
      >
        {draft && (
          <Stack>
            <TextInput
              label={t.crmSettings.title}
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
            />
            <Checkbox
              label={t.crmSettings.isDefault}
              checked={draft.isDefault}
              onChange={(e) => setDraft({ ...draft, isDefault: e.currentTarget.checked })}
            />
            <Tabs defaultValue="contact">
              <Tabs.List>
                <Tabs.Tab value="contact">{t.crmSettings.contactForm}</Tabs.Tab>
                <Tabs.Tab value="account">{t.crmSettings.accountForm}</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="contact" pt="sm">
                <FormBuilder
                  layout={draft.contactFormLayout}
                  fields={fields.data ?? []}
                  onChange={(contactFormLayout) => setDraft({ ...draft, contactFormLayout })}
                />
              </Tabs.Panel>
              <Tabs.Panel value="account" pt="sm">
                <FormBuilder
                  layout={draft.accountFormLayout}
                  fields={fields.data ?? []}
                  onChange={(accountFormLayout) => setDraft({ ...draft, accountFormLayout })}
                />
              </Tabs.Panel>
            </Tabs>
            <Group justify="space-between">
              {draft.id && can('settings_crm_databases', 'delete') ? (
                <Button color="red" variant="light" onClick={() => remove.mutate(draft.id!)}>
                  {t.profiles.delete_}
                </Button>
              ) : (
                <span />
              )}
              <Group>
                <Button variant="default" onClick={() => setDraft(null)}>
                  {t.common.cancel}
                </Button>
                <Button loading={save.isPending} onClick={() => save.mutate(draft)}>
                  {t.profiles.save}
                </Button>
              </Group>
            </Group>
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}

type TypeDraft = Omit<RecordType, 'id'> & { id?: string };

/** Settings > CRM record types (spec 12.2): statuses and record form. */
export function RecordTypesPage() {
  const { can } = useAuth();
  const fields = useFields();
  const list = useQuery({
    queryKey: ['crm-record-types'],
    queryFn: () => api<RecordType[]>('GET', '/settings/crm-record-types'),
  });
  const [draft, setDraft] = useState<TypeDraft | null>(null);
  const save = useSave<TypeDraft>('/settings/crm-record-types', 'crm-record-types', () => setDraft(null));
  const remove = useRemove('/settings/crm-record-types', 'crm-record-types', () => setDraft(null));

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.crmSettings.recordTypes}</Title>
        {can('settings_crm_record_types', 'create') && (
          <Button onClick={() => setDraft({ title: '', statuses: [], formLayout: { sections: [] } })}>
            {t.crmSettings.addRecordType}
          </Button>
        )}
      </Group>
      <Table highlightOnHover>
        <Table.Tbody>
          {list.data?.map((rt) => (
            <Table.Tr key={rt.id} onClick={() => setDraft(rt)} style={{ cursor: 'pointer' }}>
              <Table.Td>{rt.title}</Table.Td>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {rt.statuses.map((s) => s.title).join(', ')}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Drawer
        opened={!!draft}
        onClose={() => setDraft(null)}
        position="right"
        size="xl"
        title={draft?.id ? draft.title : t.crmSettings.addRecordType}
      >
        {draft && (
          <Stack>
            <TextInput
              label={t.crmSettings.title}
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
            />
            <Text fw={500} size="sm">
              {t.crmSettings.statuses}
            </Text>
            {draft.statuses.map((s, i) => (
              <Group key={i} gap={4} wrap="nowrap">
                <TextInput
                  aria-label={t.crmSettings.statusTitle}
                  placeholder={t.crmSettings.statusTitle}
                  value={s.title}
                  onChange={(e) => {
                    const title = e.currentTarget.value;
                    setDraft({
                      ...draft,
                      statuses: draft.statuses.map((x, j) =>
                        j === i
                          ? {
                              title,
                              key:
                                x.key ||
                                title
                                  .toLowerCase()
                                  .replace(/[^a-z0-9]+/g, '_')
                                  .replace(/^_|_$/g, ''),
                            }
                          : x,
                      ),
                    });
                  }}
                />
                <TextInput
                  aria-label={t.crmSettings.statusKey}
                  placeholder={t.crmSettings.statusKey}
                  value={s.key}
                  onChange={(e) => {
                    const key = e.currentTarget.value;
                    setDraft({ ...draft, statuses: draft.statuses.map((x, j) => (j === i ? { ...x, key } : x)) });
                  }}
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label="Remove status"
                  onClick={() => setDraft({ ...draft, statuses: draft.statuses.filter((_, j) => j !== i) })}
                >
                  ✕
                </ActionIcon>
              </Group>
            ))}
            <Group>
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => setDraft({ ...draft, statuses: [...draft.statuses, { key: '', title: '' }] })}
              >
                + {t.crmSettings.addStatus}
              </Button>
            </Group>
            <Text fw={500} size="sm">
              {t.crmSettings.recordForm}
            </Text>
            <FormBuilder
              layout={draft.formLayout}
              fields={fields.data ?? []}
              onChange={(formLayout) => setDraft({ ...draft, formLayout })}
            />
            <Group justify="space-between">
              {draft.id && can('settings_crm_record_types', 'delete') ? (
                <Button color="red" variant="light" onClick={() => remove.mutate(draft.id!)}>
                  {t.profiles.delete_}
                </Button>
              ) : (
                <span />
              )}
              <Group>
                <Button variant="default" onClick={() => setDraft(null)}>
                  {t.common.cancel}
                </Button>
                <Button loading={save.isPending} onClick={() => save.mutate(draft)}>
                  {t.profiles.save}
                </Button>
              </Group>
            </Group>
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}

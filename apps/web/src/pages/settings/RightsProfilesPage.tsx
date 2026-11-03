import {
  Button,
  Checkbox,
  Drawer,
  Group,
  MultiSelect,
  Radio,
  Stack,
  Table,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';
import type { AccessProfileDto, RightsProfileDto, User } from '../../types';
import { useCrmMeta } from '../../crm/hooks';
import { CategoryRightsEditor } from './CategoryRightsEditor';

type Draft = Omit<RightsProfileDto, 'id'> & { id?: string };
const EMPTY: Draft = {
  name: '',
  description: '',
  userVisibility: 'all',
  visibleUserIds: [],
  editableAccessProfiles: [],
  editableRightsProfiles: [],
  crmDatabases: [],
  crmRecordTypes: [],
  categories: [],
  ticketViews: [],
};

function AllOrList(props: {
  label: string;
  value: 'all' | string[];
  options: { value: string; label: string }[];
  onChange: (v: 'all' | string[]) => void;
}) {
  return (
    <Stack gap={4}>
      <Checkbox
        label={`${props.label}: ${t.profiles.all}`}
        checked={props.value === 'all'}
        onChange={(e) => props.onChange(e.currentTarget.checked ? 'all' : [])}
      />
      {props.value !== 'all' && (
        <MultiSelect
          aria-label={props.label}
          data={props.options}
          value={props.value}
          onChange={props.onChange}
          searchable
        />
      )}
    </Stack>
  );
}

export function RightsProfilesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['rights-profiles'],
    queryFn: () => api<RightsProfileDto[]>('GET', '/settings/rights-profiles'),
  });
  const aps = useQuery({
    queryKey: ['access-profiles'],
    queryFn: () => api<AccessProfileDto[]>('GET', '/settings/access-profiles'),
    enabled: can('settings_access_profiles', 'read'),
  });
  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => api<User[]>('GET', '/settings/users'),
    enabled: can('settings_users', 'read'),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const meta = useCrmMeta();
  const teamViews = useQuery({
    queryKey: ['team-views'],
    queryFn: () => api<{ id: string; name: string }[]>('GET', '/settings/ticket-views'),
    enabled: can('settings_ticket_views', 'read'),
  });

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const { id, ...body } = d;
      return id ? api('PUT', `/settings/rights-profiles/${id}`, body) : api('POST', '/settings/rights-profiles', body);
    },
    onSuccess: async () => {
      setDraft(null);
      notifyOk();
      await qc.invalidateQueries({ queryKey: ['rights-profiles'] });
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/settings/rights-profiles/${id}`),
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['rights-profiles'] });
    },
    onError: notifyError,
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.profiles.rightsTitle}</Title>
        {can('settings_rights_profiles', 'create') && <Button onClick={() => setDraft(EMPTY)}>{t.profiles.add}</Button>}
      </Group>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t.profiles.name}</Table.Th>
            <Table.Th>{t.profiles.description}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {list.data?.map((p) => (
            <Table.Tr key={p.id} onClick={() => setDraft(p)} style={{ cursor: 'pointer' }}>
              <Table.Td>{p.name}</Table.Td>
              <Table.Td>{p.description}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Drawer
        opened={!!draft}
        onClose={() => setDraft(null)}
        position="right"
        size="lg"
        title={draft?.id ? draft.name : t.profiles.add}
      >
        {draft && (
          <Stack>
            <TextInput
              label={t.profiles.name}
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
            />
            <Textarea
              label={t.profiles.description}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.currentTarget.value })}
            />
            <Radio.Group
              label={t.profiles.userVisibility}
              value={draft.userVisibility}
              onChange={(v) => setDraft({ ...draft, userVisibility: v as 'all' | 'selected' })}
            >
              <Group mt="xs">
                <Radio value="all" label={t.profiles.visibilityAll} />
                <Radio value="selected" label={t.profiles.visibilitySelected} />
              </Group>
            </Radio.Group>
            {draft.userVisibility === 'selected' && (
              <MultiSelect
                label={t.profiles.visibleUsers}
                data={(users.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))}
                value={draft.visibleUserIds}
                onChange={(v) => setDraft({ ...draft, visibleUserIds: v })}
                searchable
              />
            )}
            <CategoryRightsEditor
              value={draft.categories}
              onChange={(categories) => setDraft({ ...draft, categories })}
            />
            <AllOrList
              label={t.ticketSettings.teamViewsRights}
              value={draft.ticketViews}
              options={(teamViews.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
              onChange={(v) => setDraft({ ...draft, ticketViews: v })}
            />
            <AllOrList
              label={t.crmSettings.crmDatabasesRights}
              value={draft.crmDatabases}
              options={(meta.data?.databases ?? []).map((d) => ({ value: d.id, label: d.title }))}
              onChange={(v) => setDraft({ ...draft, crmDatabases: v })}
            />
            <AllOrList
              label={t.crmSettings.recordTypesRights}
              value={draft.crmRecordTypes}
              options={(meta.data?.recordTypes ?? []).map((rt) => ({ value: rt.id, label: rt.title }))}
              onChange={(v) => setDraft({ ...draft, crmRecordTypes: v })}
            />
            <AllOrList
              label={t.profiles.editableAccess}
              value={draft.editableAccessProfiles}
              options={(aps.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
              onChange={(v) => setDraft({ ...draft, editableAccessProfiles: v })}
            />
            <AllOrList
              label={t.profiles.editableRights}
              value={draft.editableRightsProfiles}
              options={(list.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
              onChange={(v) => setDraft({ ...draft, editableRightsProfiles: v })}
            />
            <Group justify="space-between">
              {draft.id && can('settings_rights_profiles', 'delete') ? (
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

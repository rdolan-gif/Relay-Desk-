import {
  Badge,
  Button,
  Drawer,
  Group,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Table,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { USER_TYPES, type UserType } from '@relay-desk/domain';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';
import type { AccessProfileDto, RightsProfileDto, User } from '../../types';

interface Draft {
  id?: string;
  email: string;
  name: string;
  type: UserType;
  password: string;
  accessProfileId: string | null;
  rightsProfileId: string | null;
  isActive: boolean;
}

const EMPTY: Draft = {
  email: '',
  name: '',
  type: 'agent',
  password: '',
  accessProfileId: null,
  rightsProfileId: null,
  isActive: true,
};

export function UsersPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<User[]>('GET', '/settings/users') });
  const aps = useQuery({
    queryKey: ['access-profiles'],
    queryFn: () => api<AccessProfileDto[]>('GET', '/settings/access-profiles'),
    enabled: can('settings_access_profiles', 'read'),
  });
  const rps = useQuery({
    queryKey: ['rights-profiles'],
    queryFn: () => api<RightsProfileDto[]>('GET', '/settings/rights-profiles'),
    enabled: can('settings_rights_profiles', 'read'),
  });
  const [draft, setDraft] = useState<Draft | null>(null);

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = {
        email: d.email,
        name: d.name,
        type: d.type,
        accessProfileId: d.accessProfileId,
        rightsProfileId: d.rightsProfileId,
        ...(d.password ? { password: d.password } : {}),
      };
      return d.id
        ? api('PATCH', `/settings/users/${d.id}`, { ...body, isActive: d.isActive })
        : api('POST', '/settings/users', body);
    },
    onSuccess: async () => {
      setDraft(null);
      notifyOk();
      await qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: notifyError,
  });

  const apName = (id: string | null) => aps.data?.find((p) => p.id === id)?.name ?? '—';
  const rpName = (id: string | null) => rps.data?.find((p) => p.id === id)?.name ?? '—';

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.users.title}</Title>
        {can('settings_users', 'create') && <Button onClick={() => setDraft(EMPTY)}>{t.users.add}</Button>}
      </Group>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t.users.name}</Table.Th>
            <Table.Th>{t.users.email}</Table.Th>
            <Table.Th>{t.users.type}</Table.Th>
            <Table.Th>{t.users.accessProfile}</Table.Th>
            <Table.Th>{t.users.rightsProfile}</Table.Th>
            <Table.Th>{t.users.active}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {users.data?.map((u) => (
            <Table.Tr
              key={u.id}
              onClick={() => can('settings_users', 'update') && setDraft({ ...u, password: '' })}
              style={{ cursor: can('settings_users', 'update') ? 'pointer' : undefined }}
            >
              <Table.Td>{u.name}</Table.Td>
              <Table.Td>{u.email}</Table.Td>
              <Table.Td>{t.users.types[u.type]}</Table.Td>
              <Table.Td>{apName(u.accessProfileId)}</Table.Td>
              <Table.Td>{rpName(u.rightsProfileId)}</Table.Td>
              <Table.Td>{u.isActive ? <Badge color="teal">Yes</Badge> : <Badge color="gray">No</Badge>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Drawer
        opened={!!draft}
        onClose={() => setDraft(null)}
        position="right"
        title={draft?.id ? draft.name : t.users.add}
      >
        {draft && (
          <Stack>
            <TextInput
              label={t.users.name}
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
            />
            <TextInput
              label={t.users.email}
              type="email"
              required
              value={draft.email}
              onChange={(e) => setDraft({ ...draft, email: e.currentTarget.value })}
            />
            <Select
              label={t.users.type}
              data={USER_TYPES.map((v) => ({ value: v, label: t.users.types[v] }))}
              value={draft.type}
              onChange={(v) => v && setDraft({ ...draft, type: v as UserType })}
              allowDeselect={false}
            />
            <Select
              label={t.users.accessProfile}
              data={(aps.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
              value={draft.accessProfileId}
              onChange={(v) => setDraft({ ...draft, accessProfileId: v })}
              clearable
            />
            <Select
              label={t.users.rightsProfile}
              data={(rps.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
              value={draft.rightsProfileId}
              onChange={(v) => setDraft({ ...draft, rightsProfileId: v })}
              clearable
            />
            <PasswordInput
              label={t.users.password}
              autoComplete="new-password"
              value={draft.password}
              onChange={(e) => setDraft({ ...draft, password: e.currentTarget.value })}
            />
            {draft.id && (
              <Switch
                label={t.users.active}
                checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.currentTarget.checked })}
              />
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setDraft(null)}>
                {t.common.cancel}
              </Button>
              <Button loading={save.isPending} onClick={() => save.mutate(draft)}>
                {t.users.save}
              </Button>
            </Group>
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}

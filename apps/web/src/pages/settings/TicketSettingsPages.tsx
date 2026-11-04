import {
  Badge,
  Button,
  Checkbox,
  ColorInput,
  Drawer,
  Group,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FilterCondition } from '@relay-desk/domain';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { FilterBuilder } from '../../components/FilterBuilder';
import { FormBuilder } from '../../components/FormBuilder';
import { useCrmMeta, useUserDirectory } from '../../crm/hooks';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';
import { useTicketMeta } from '../../tickets/hooks';
import type { Category, TicketStatus, TicketView } from '../../tickets/types';

function useCrud<T extends { id?: string }>(base: string, keys: string[], done: () => void) {
  const qc = useQueryClient();
  const invalidate = async () => {
    for (const k of keys) await qc.invalidateQueries({ queryKey: [k] });
  };
  const save = useMutation({
    mutationFn: (d: T) => {
      const { id, ...body } = d as T & { id?: string };
      return id ? api('PUT', `${base}/${id}`, body) : api('POST', base, body);
    },
    onSuccess: async () => {
      done();
      notifyOk();
      await invalidate();
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `${base}/${id}`),
    onSuccess: async () => {
      done();
      await invalidate();
    },
    onError: notifyError,
  });
  return { save, remove };
}

function DrawerButtons(props: {
  canDelete: boolean;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <Group justify="space-between">
      {props.canDelete ? (
        <Button color="red" variant="light" onClick={props.onDelete}>
          {t.profiles.delete_}
        </Button>
      ) : (
        <span />
      )}
      <Group>
        <Button variant="default" onClick={props.onCancel}>
          {t.common.cancel}
        </Button>
        <Button loading={props.saving} onClick={props.onSave}>
          {t.profiles.save}
        </Button>
      </Group>
    </Group>
  );
}

/** Settings > Statuses (spec 7.2). */
export function StatusesPage() {
  const { can } = useAuth();
  const list = useQuery({
    queryKey: ['ticket-statuses'],
    queryFn: () => api<TicketStatus[]>('GET', '/settings/ticket-statuses'),
  });
  const [draft, setDraft] = useState<Partial<TicketStatus> | null>(null);
  const { save, remove } = useCrud<Partial<TicketStatus>>(
    '/settings/ticket-statuses',
    ['ticket-statuses', 'ticket-meta'],
    () => setDraft(null),
  );
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.ticketSettings.statuses}</Title>
        {can('settings_statuses', 'create') && (
          <Button onClick={() => setDraft({ title: '', color: 'gray', description: '' })}>
            {t.ticketSettings.addStatus}
          </Button>
        )}
      </Group>
      <Table highlightOnHover>
        <Table.Tbody>
          {list.data?.map((s) => (
            <Table.Tr key={s.id} onClick={() => setDraft(s)} style={{ cursor: 'pointer' }}>
              <Table.Td>
                <Badge color={s.color} variant="light">
                  {s.title}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {s.description}
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
        title={draft?.id ? draft.title : t.ticketSettings.addStatus}
      >
        {draft && (
          <Stack>
            <TextInput
              label={t.crmSettings.title}
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
            />
            <ColorInput
              label={t.ticketSettings.color}
              value={draft.color}
              onChange={(color) => setDraft({ ...draft, color })}
              swatches={['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet']}
            />
            <Textarea
              label={t.profiles.description}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.currentTarget.value })}
            />
            <DrawerButtons
              canDelete={!!draft.id && can('settings_statuses', 'delete')}
              onDelete={() => remove.mutate(draft.id!)}
              onCancel={() => setDraft(null)}
              onSave={() =>
                save.mutate({ id: draft.id, title: draft.title, color: draft.color, description: draft.description })
              }
              saving={save.isPending}
            />
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}

const EMPTY_CATEGORY: Omit<Category, 'id'> = {
  title: '',
  groupName: '',
  statusRequired: 'never',
  multipleStatuses: false,
  checkChildOnClose: false,
  autoArchiveDays: null,
  allowExternalComments: false,
  waitingRequiresReopen: false,
  defaultCrmDatabaseId: null,
  slaId: null,
  timeGroupId: null,
  formLayout: { sections: [] },
  autofocusTab: 'form',
  statusIds: [],
};

/** Settings > Categories (spec 7.1). */
export function CategoriesPage() {
  const { can } = useAuth();
  const crm = useCrmMeta();
  const statuses = useQuery({
    queryKey: ['ticket-statuses'],
    queryFn: () => api<TicketStatus[]>('GET', '/settings/ticket-statuses'),
  });
  const list = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('GET', '/settings/categories') });
  const slas = useQuery({
    queryKey: ['sla-options'],
    queryFn: () => api<{ id: string; title: string }[]>('GET', '/sla-options'),
  });
  const timeGroups = useQuery({
    queryKey: ['time-group-options'],
    queryFn: () => api<{ id: string; title: string }[]>('GET', '/sla-options/time-groups'),
  });
  const [draft, setDraft] = useState<(Omit<Category, 'id'> & { id?: string }) | null>(null);
  const { save, remove } = useCrud<Omit<Category, 'id'> & { id?: string }>(
    '/settings/categories',
    ['categories', 'ticket-meta'],
    () => setDraft(null),
  );
  const set = (patch: Partial<Category>) => draft && setDraft({ ...draft, ...patch });
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.ticketSettings.categories}</Title>
        {can('settings_categories', 'create') && (
          <Button onClick={() => setDraft(EMPTY_CATEGORY)}>{t.ticketSettings.addCategory}</Button>
        )}
      </Group>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t.crmSettings.title}</Table.Th>
            <Table.Th>{t.ticketSettings.group}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {list.data?.map((c) => (
            <Table.Tr key={c.id} onClick={() => setDraft(c)} style={{ cursor: 'pointer' }}>
              <Table.Td>{c.title}</Table.Td>
              <Table.Td>{c.groupName}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Drawer
        opened={!!draft}
        onClose={() => setDraft(null)}
        position="right"
        size="xl"
        title={draft?.id ? draft.title : t.ticketSettings.addCategory}
      >
        {draft && (
          <Stack>
            <Group grow>
              <TextInput
                label={t.crmSettings.title}
                required
                value={draft.title}
                onChange={(e) => set({ title: e.currentTarget.value })}
              />
              <TextInput
                label={t.ticketSettings.group}
                value={draft.groupName}
                onChange={(e) => set({ groupName: e.currentTarget.value })}
              />
            </Group>
            <Group grow>
              <Select
                label={t.ticketSettings.statusRequired}
                data={Object.entries(t.ticketSettings.statusRequiredOptions).map(([value, label]) => ({
                  value,
                  label,
                }))}
                value={draft.statusRequired}
                allowDeselect={false}
                onChange={(v) => v && set({ statusRequired: v as Category['statusRequired'] })}
              />
              <NumberInput
                label={t.ticketSettings.autoArchiveDays}
                min={1}
                max={3650}
                value={draft.autoArchiveDays ?? ''}
                onChange={(v) => set({ autoArchiveDays: v === '' ? null : Number(v) })}
              />
            </Group>
            <Group grow>
              <Select
                label={t.sla.category}
                data={[
                  { value: '', label: t.sla.none },
                  ...(slas.data ?? []).map((x) => ({ value: x.id, label: x.title })),
                ]}
                value={draft.slaId ?? ''}
                allowDeselect={false}
                onChange={(v) => set({ slaId: v || null })}
              />
              <Select
                label={t.timeGroups.category}
                data={[
                  { value: '', label: t.timeGroups.allDay },
                  ...(timeGroups.data ?? []).map((x) => ({ value: x.id, label: x.title })),
                ]}
                value={draft.timeGroupId ?? ''}
                allowDeselect={false}
                onChange={(v) => set({ timeGroupId: v || null })}
              />
            </Group>
            <Group grow>
              <Select
                label={t.ticketSettings.defaultCrmDatabase}
                data={(crm.data?.databases ?? []).map((d) => ({ value: d.id, label: d.title }))}
                value={draft.defaultCrmDatabaseId}
                clearable
                onChange={(v) => set({ defaultCrmDatabaseId: v })}
              />
              <Select
                label={t.ticketSettings.autofocusTab}
                data={[
                  { value: 'form', label: 'Form' },
                  { value: 'attachments', label: 'Attachments' },
                  { value: 'templates', label: 'Templates' },
                ]}
                value={draft.autofocusTab}
                allowDeselect={false}
                onChange={(v) => v && set({ autofocusTab: v })}
              />
            </Group>
            <Group>
              <Checkbox
                label={t.ticketSettings.multipleStatuses}
                checked={draft.multipleStatuses}
                onChange={(e) => set({ multipleStatuses: e.currentTarget.checked })}
              />
              <Checkbox
                label={t.ticketSettings.checkChildOnClose}
                checked={draft.checkChildOnClose}
                onChange={(e) => set({ checkChildOnClose: e.currentTarget.checked })}
              />
              <Checkbox
                label={t.ticketSettings.allowExternalComments}
                checked={draft.allowExternalComments}
                onChange={(e) => set({ allowExternalComments: e.currentTarget.checked })}
              />
              <Checkbox
                label={t.ticketSettings.waitingRequiresReopen}
                checked={draft.waitingRequiresReopen}
                onChange={(e) => set({ waitingRequiresReopen: e.currentTarget.checked })}
              />
            </Group>
            <MultiSelect
              label={t.ticketSettings.allowedStatuses}
              data={(statuses.data ?? []).map((s) => ({ value: s.id, label: s.title }))}
              value={draft.statusIds}
              onChange={(statusIds) => set({ statusIds })}
              searchable
            />
            <Text fw={500} size="sm">
              {t.ticketSettings.form}
            </Text>
            <FormBuilder
              layout={draft.formLayout}
              fields={crm.data?.customFields ?? []}
              onChange={(formLayout) => set({ formLayout })}
            />
            <DrawerButtons
              canDelete={!!draft.id && can('settings_categories', 'delete')}
              onDelete={() => remove.mutate(draft.id!)}
              onCancel={() => setDraft(null)}
              onSave={() => {
                const { canSee: _c, ...rest } = draft as Category & { canSee?: boolean };
                const body = Object.fromEntries(
                  Object.entries(rest).filter(([k]) => !['createdAt', 'updatedAt', 'deletedAt'].includes(k)),
                );
                save.mutate(body as never);
              }}
              saving={save.isPending}
            />
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}

/** Settings > Team views (spec 6.1). */
export function TeamViewsPage() {
  const { can } = useAuth();
  const meta = useTicketMeta();
  const users = useUserDirectory();
  const list = useQuery({
    queryKey: ['team-views'],
    queryFn: () => api<TicketView[]>('GET', '/settings/ticket-views'),
  });
  const [draft, setDraft] = useState<{ id?: string; name: string; conditions: FilterCondition[] } | null>(null);
  const { save, remove } = useCrud<{ id?: string; name: string; conditions: FilterCondition[] }>(
    '/settings/ticket-views',
    ['team-views', 'ticket-sidebar'],
    () => setDraft(null),
  );
  const choices: Record<string, { value: string; label: string }[]> = {
    state: Object.entries(t.tickets.states).map(([value, label]) => ({ value, label })),
    priority: Object.entries(t.tickets.priorities).map(([value, label]) => ({ value, label })),
    statusIds: (meta.data?.statuses ?? []).map((s) => ({ value: s.id, label: s.title })),
    categoryId: (meta.data?.categories ?? []).map((c) => ({ value: c.id, label: c.title })),
    userId: [
      { value: '@me', label: 'Me (the viewer)' },
      ...(users.data ?? []).map((u) => ({ value: u.id, label: u.name })),
    ],
  };
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.ticketSettings.views}</Title>
        {can('settings_ticket_views', 'create') && (
          <Button onClick={() => setDraft({ name: '', conditions: [] })}>{t.ticketSettings.addView}</Button>
        )}
      </Group>
      <Table highlightOnHover>
        <Table.Tbody>
          {list.data?.map((v) => (
            <Table.Tr
              key={v.id}
              onClick={() => setDraft({ id: v.id, name: v.name, conditions: v.conditions as FilterCondition[] })}
              style={{ cursor: 'pointer' }}
            >
              <Table.Td>{v.name}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Drawer
        opened={!!draft}
        onClose={() => setDraft(null)}
        position="right"
        size="xl"
        title={draft?.id ? draft.name : t.ticketSettings.addView}
      >
        {draft && meta.data && (
          <Stack>
            <TextInput
              label={t.tickets.viewName}
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
            />
            <Paper withBorder p="sm">
              <FilterBuilder
                fields={meta.data.filterFields.filter((f) => f.kind !== 'ref' || choices[f.key])}
                conditions={draft.conditions}
                onChange={(conditions) => setDraft({ ...draft, conditions })}
                choices={choices}
              />
            </Paper>
            <DrawerButtons
              canDelete={!!draft.id && can('settings_ticket_views', 'delete')}
              onDelete={() => remove.mutate(draft.id!)}
              onCancel={() => setDraft(null)}
              onSave={() => save.mutate(draft)}
              saving={save.isPending}
            />
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
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
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { MACRO_ACTION_TYPES, ME, type MacroAction, type MacroActionType, type MacroPosition } from '@relay-desk/domain';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useCrmMeta, useUserDirectory } from '../../crm/hooks';
import type { EmailTemplate } from '../../email/types';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';
import { useTicketMeta } from '../../tickets/hooks';
import { Title } from '@mantine/core';

interface Macro {
  id: string;
  title: string;
  description: string;
  colour: string;
  position: MacroPosition;
  actions: MacroAction[];
  categoryIds: string[];
}
type Draft = Omit<Macro, 'id'> & { id?: string; keys: string[] };

const COLOURS = ['blue', 'ricoman', 'amber', 'green', 'red', 'gray', 'violet', 'teal'];
let seq = 0;
const key = () => `a${++seq}`;
const EMPTY = (): Draft => ({
  title: '',
  description: '',
  colour: 'blue',
  position: 'button',
  actions: [],
  categoryIds: [],
  keys: [],
});

function defaultAction(type: MacroActionType): MacroAction {
  switch (type) {
    case 'set_category':
      return { type, categoryId: '' };
    case 'set_user':
      return { type, userId: ME, replace: false };
    case 'set_state':
      return { type, state: 'waiting' };
    case 'set_status':
      return { type, statusIds: [], mode: 'add' };
    case 'set_priority':
      return { type, priority: 'normal' };
    case 'set_reopen':
      return { type, mode: 'relative', amount: 2, unit: 'working_days' };
    case 'set_custom_field':
      return { type, fieldId: '', value: '' };
    case 'add_follower':
      return { type, userId: ME };
    case 'insert_template':
      return { type, templateId: '' };
    case 'open_url':
      return { type, url: 'https://' };
    default:
      return { type } as MacroAction;
  }
}

function SortableRow({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}>
      {children(
        <ActionIcon
          variant="subtle"
          aria-label={`Drag ${label}`}
          style={{ cursor: 'grab' }}
          {...attributes}
          {...listeners}
        >
          ⠿
        </ActionIcon>,
      )}
    </div>
  );
}

/** One action block's settings. */
function ActionFields({ a, onChange }: { a: MacroAction; onChange: (a: MacroAction) => void }) {
  const meta = useTicketMeta();
  const crm = useCrmMeta();
  const users = useUserDirectory();
  const templates = useQuery({ queryKey: ['templates-all'], queryFn: () => api<EmailTemplate[]>('GET', '/templates') });
  const people = [
    { value: ME, label: t.macros.me },
    ...(users.data ?? []).map((u) => ({ value: u.id, label: u.name })),
  ];
  switch (a.type) {
    case 'set_category':
      return (
        <Select
          aria-label={t.tickets.category}
          data={(meta.data?.categories ?? []).map((c) => ({ value: c.id, label: c.title }))}
          value={a.categoryId || null}
          searchable
          onChange={(v) => onChange({ ...a, categoryId: v ?? '' })}
        />
      );
    case 'set_user':
      return (
        <Group>
          <Select
            aria-label={t.tickets.user}
            data={[...people, { value: '', label: t.macros.nobody }]}
            value={a.userId ?? ''}
            searchable
            onChange={(v) => onChange({ ...a, userId: v || null })}
          />
          <Checkbox
            label={t.macros.replace}
            checked={a.replace}
            onChange={(e) => onChange({ ...a, replace: e.currentTarget.checked })}
          />
        </Group>
      );
    case 'set_state':
      return (
        <Select
          aria-label={t.tickets.state}
          data={Object.entries(t.tickets.states).map(([value, label]) => ({ value, label }))}
          value={a.state}
          allowDeselect={false}
          onChange={(v) => v && onChange({ ...a, state: v as never })}
        />
      );
    case 'set_status':
      return (
        <Group grow>
          <Select
            aria-label="Mode"
            data={Object.entries(t.macros.statusMode).map(([value, label]) => ({ value, label }))}
            value={a.mode}
            allowDeselect={false}
            onChange={(v) => v && onChange({ ...a, mode: v as 'add' | 'replace' })}
          />
          <MultiSelect
            aria-label={t.tickets.status}
            data={(meta.data?.statuses ?? []).map((s) => ({ value: s.id, label: s.title }))}
            value={a.statusIds}
            onChange={(statusIds) => onChange({ ...a, statusIds })}
          />
        </Group>
      );
    case 'set_priority':
      return (
        <Select
          aria-label={t.tickets.priority}
          data={Object.entries(t.tickets.priorities).map(([value, label]) => ({ value, label }))}
          value={a.priority}
          allowDeselect={false}
          onChange={(v) => v && onChange({ ...a, priority: v as never })}
        />
      );
    case 'set_reopen':
      return (
        <Group>
          <Select
            aria-label="When"
            w={140}
            data={Object.entries(t.macros.reopenMode).map(([value, label]) => ({ value, label }))}
            value={a.mode}
            allowDeselect={false}
            onChange={(v) =>
              onChange(
                v === 'absolute'
                  ? { type: 'set_reopen', mode: 'absolute', at: new Date().toISOString() }
                  : { type: 'set_reopen', mode: 'relative', amount: 2, unit: 'working_days' },
              )
            }
          />
          {a.mode === 'relative' ? (
            <>
              <NumberInput
                aria-label="Amount"
                w={90}
                min={1}
                value={a.amount}
                onChange={(v) => onChange({ ...a, amount: Number(v) || 1 })}
              />
              <Select
                aria-label="Unit"
                w={150}
                data={Object.entries(t.macros.units).map(([value, label]) => ({ value, label }))}
                value={a.unit}
                allowDeselect={false}
                onChange={(v) => v && onChange({ ...a, unit: v as never })}
              />
            </>
          ) : (
            <TextInput
              type="datetime-local"
              aria-label={t.tickets.reopenAt}
              value={a.at.slice(0, 16)}
              onChange={(e) => onChange({ ...a, at: new Date(e.currentTarget.value).toISOString() })}
            />
          )}
        </Group>
      );
    case 'set_custom_field': {
      const def = crm.data?.customFields.find((f) => f.id === a.fieldId);
      return (
        <Group grow>
          <Select
            aria-label={t.macros.field}
            data={(crm.data?.customFields ?? []).map((f) => ({ value: f.id, label: f.name }))}
            value={a.fieldId || null}
            searchable
            onChange={(v) => onChange({ ...a, fieldId: v ?? '', value: '' })}
          />
          {def && (def.type === 'select' || def.type === 'radio') ? (
            <Select
              aria-label={t.macros.value}
              data={def.options.map((o) => ({ value: o.value, label: o.label }))}
              value={(a.value as string) || null}
              onChange={(v) => onChange({ ...a, value: v })}
            />
          ) : def?.type === 'checkbox' ? (
            <Checkbox
              label={t.macros.value}
              checked={!!a.value}
              onChange={(e) => onChange({ ...a, value: e.currentTarget.checked })}
            />
          ) : (
            <TextInput
              aria-label={t.macros.value}
              value={String(a.value ?? '')}
              onChange={(e) => onChange({ ...a, value: e.currentTarget.value })}
            />
          )}
        </Group>
      );
    }
    case 'add_follower':
      return (
        <Select
          aria-label={t.tickets.followers}
          data={people}
          value={a.userId}
          searchable
          allowDeselect={false}
          onChange={(v) => v && onChange({ ...a, userId: v })}
        />
      );
    case 'insert_template':
      return (
        <Select
          aria-label={t.macros.template}
          data={(templates.data ?? []).filter((x) => x.kind === 'reply').map((x) => ({ value: x.id, label: x.title }))}
          value={a.templateId || null}
          searchable
          onChange={(v) => onChange({ ...a, templateId: v ?? '' })}
        />
      );
    case 'open_url':
      return (
        <TextInput
          aria-label="URL"
          description={t.macros.urlHelp}
          value={a.url}
          onChange={(e) => onChange({ ...a, url: e.currentTarget.value })}
        />
      );
    default:
      return null;
  }
}

/** Settings › Macros (spec 10): ordered action blocks, built by drag and drop. */
export function MacrosPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const meta = useTicketMeta();
  const list = useQuery({ queryKey: ['macros'], queryFn: () => api<Macro[]>('GET', '/settings/macros') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const refresh = () => qc.invalidateQueries({ queryKey: ['macros'] });
  const save = useMutation({
    mutationFn: (d: Draft) => {
      const { id, keys: _k, ...body } = d;
      return id ? api('PUT', `/settings/macros/${id}`, body) : api('POST', '/settings/macros', body);
    },
    onSuccess: async () => {
      setDraft(null);
      notifyOk();
      await refresh();
    },
    onError: notifyError,
  });
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
    onError: notifyError,
  });
  const open = (m: Macro) => setDraft({ ...m, keys: m.actions.map(key) });
  const setActions = (actions: MacroAction[], keys: string[]) => draft && setDraft({ ...draft, actions, keys });
  const onDrag = (e: DragEndEvent) => {
    if (!draft || !e.over || e.active.id === e.over.id) return;
    const from = draft.keys.indexOf(String(e.active.id));
    const to = draft.keys.indexOf(String(e.over.id));
    setActions(arrayMove(draft.actions, from, to), arrayMove(draft.keys, from, to));
  };
  const move = (i: number, by: number) => {
    if (!draft) return;
    const j = i + by;
    if (j < 0 || j >= draft.actions.length) return;
    setActions(arrayMove(draft.actions, i, j), arrayMove(draft.keys, i, j));
  };
  const catTitle = (id: string) => meta.data?.categories.find((c) => c.id === id)?.title ?? '…';

  return (
    <Stack maw={1000}>
      <Group justify="space-between">
        <Title order={2}>{t.macros.title}</Title>
        {can('settings_macros', 'create') && <Button onClick={() => setDraft(EMPTY())}>{t.macros.add}</Button>}
      </Group>
      <Text size="sm" c="dimmed">
        {t.macros.help}
      </Text>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t.macros.name}</Table.Th>
            <Table.Th>{t.macros.position}</Table.Th>
            <Table.Th>{t.macros.categories}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {list.data?.map((m) => (
            <Table.Tr
              key={m.id}
              style={{ cursor: 'pointer' }}
              tabIndex={0}
              onClick={() => open(m)}
              onKeyDown={(e) => e.key === 'Enter' && open(m)}
            >
              <Table.Td>
                <Badge color={m.colour} variant="light">
                  {m.title}
                </Badge>
              </Table.Td>
              <Table.Td>{t.macros.positions[m.position]}</Table.Td>
              <Table.Td>
                <Text size="sm">{m.categoryIds.map(catTitle).join(', ') || t.crm.none}</Text>
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
        title={draft?.id ? draft.title : t.macros.add}
      >
        {draft && (
          <Stack>
            <TextInput
              label={t.macros.name}
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
            />
            <TextInput
              label={t.macros.description}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.currentTarget.value })}
            />
            <Group grow>
              <Select
                label={t.macros.colour}
                data={COLOURS}
                value={draft.colour}
                allowDeselect={false}
                onChange={(v) => v && setDraft({ ...draft, colour: v })}
              />
              <Select
                label={t.macros.position}
                data={Object.entries(t.macros.positions).map(([value, label]) => ({ value, label }))}
                value={draft.position}
                allowDeselect={false}
                onChange={(v) => v && setDraft({ ...draft, position: v as MacroPosition })}
              />
            </Group>
            <MultiSelect
              label={t.macros.categories}
              data={(meta.data?.categories ?? []).map((c) => ({ value: c.id, label: c.title }))}
              value={draft.categoryIds}
              searchable
              onChange={(categoryIds) => setDraft({ ...draft, categoryIds })}
            />
            <Text fw={600}>{t.macros.actions}</Text>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDrag}>
              <SortableContext items={draft.keys} strategy={verticalListSortingStrategy}>
                <Stack gap="xs">
                  {draft.actions.map((a, i) => (
                    <SortableRow key={draft.keys[i]} id={draft.keys[i]!} label={t.macros.types[a.type]!}>
                      {(handle) => (
                        <Paper withBorder p="xs">
                          <Group justify="space-between" mb={4} wrap="nowrap">
                            <Group gap="xs">
                              {handle}
                              <Text size="sm" fw={600}>{`${i + 1}. ${t.macros.types[a.type]}`}</Text>
                            </Group>
                            <Group gap={4}>
                              <ActionIcon
                                variant="subtle"
                                aria-label={t.macros.moveUp}
                                disabled={i === 0}
                                onClick={() => move(i, -1)}
                              >
                                ▲
                              </ActionIcon>
                              <ActionIcon
                                variant="subtle"
                                aria-label={t.macros.moveDown}
                                disabled={i === draft.actions.length - 1}
                                onClick={() => move(i, 1)}
                              >
                                ▼
                              </ActionIcon>
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                aria-label={t.macros.remove}
                                onClick={() =>
                                  setActions(
                                    draft.actions.filter((_, j) => j !== i),
                                    draft.keys.filter((_, j) => j !== i),
                                  )
                                }
                              >
                                ✕
                              </ActionIcon>
                            </Group>
                          </Group>
                          <ActionFields
                            a={a}
                            onChange={(next) =>
                              setActions(
                                draft.actions.map((x, j) => (j === i ? next : x)),
                                draft.keys,
                              )
                            }
                          />
                        </Paper>
                      )}
                    </SortableRow>
                  ))}
                </Stack>
              </SortableContext>
            </DndContext>
            <Select
              aria-label={t.macros.addAction}
              placeholder={t.macros.addAction}
              data={MACRO_ACTION_TYPES.map((type) => ({ value: type, label: t.macros.types[type]! }))}
              value={null}
              onChange={(v) =>
                v && setActions([...draft.actions, defaultAction(v as MacroActionType)], [...draft.keys, key()])
              }
              w={280}
            />
            <Group justify="space-between">
              <Group>
                {draft.id && can('settings_macros', 'delete') && (
                  <Button
                    color="red"
                    variant="light"
                    onClick={() => act.mutate(() => api('DELETE', `/settings/macros/${draft.id}`))}
                  >
                    {t.profiles.delete_}
                  </Button>
                )}
                {draft.id && can('settings_macros', 'create') && (
                  <Button
                    variant="light"
                    onClick={() => act.mutate(() => api('POST', `/settings/macros/${draft.id}/clone`))}
                  >
                    {t.macros.clone}
                  </Button>
                )}
              </Group>
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

import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Drawer,
  Group,
  MultiSelect,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ROUTING_FIELDS, ROUTING_OPS, type RoutingCondition, type RoutingRule } from '@relay-desk/domain';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { UserPicker } from '../../components/FieldInput';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';
import { useTicketMeta } from '../../tickets/hooks';

type Rule = RoutingRule & { description: string; position: number };
type Draft = Omit<Rule, 'id' | 'position'> & { id?: string };
const EMPTY: Draft = { title: '', description: '', direction: 'incoming', active: true, all: [], any: [], actions: {} };
const NEW_CONDITION: RoutingCondition = { field: 'subject', op: 'contains', value: '' };

function ConditionList(props: {
  label: string;
  value: RoutingCondition[];
  onChange: (v: RoutingCondition[]) => void;
  mailboxes: { value: string; label: string }[];
}) {
  const set = (i: number, patch: Partial<RoutingCondition>) =>
    props.onChange(props.value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        {props.label}
      </Text>
      {props.value.map((c, i) => (
        <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
          <Select
            aria-label="Field"
            w={170}
            data={ROUTING_FIELDS.filter((f) => f !== 'contact_field' && f !== 'account_field').map((f) => ({
              value: f,
              label: t.routing.fields[f] ?? f,
            }))}
            value={c.field}
            allowDeselect={false}
            onChange={(v) => v && set(i, { field: v as RoutingCondition['field'], value: '' })}
          />
          <Checkbox
            aria-label={t.routing.not}
            label={t.routing.not}
            checked={!!c.negate}
            onChange={(e) => set(i, { negate: e.currentTarget.checked })}
          />
          <Select
            aria-label="Operator"
            w={150}
            data={ROUTING_OPS.map((o) => ({ value: o, label: t.routing.ops[o] ?? o }))}
            value={c.op}
            allowDeselect={false}
            onChange={(v) => v && set(i, { op: v as RoutingCondition['op'] })}
          />
          {c.op !== 'is_empty' &&
            (c.field === 'queue' ? (
              <Select
                aria-label="Value"
                style={{ flex: 1 }}
                data={props.mailboxes}
                value={c.value ?? null}
                onChange={(v) => set(i, { value: v ?? '' })}
              />
            ) : (
              <TextInput
                aria-label="Value"
                style={{ flex: 1 }}
                value={c.value ?? ''}
                onChange={(e) => set(i, { value: e.currentTarget.value })}
              />
            ))}
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label="Remove condition"
            onClick={() => props.onChange(props.value.filter((_, j) => j !== i))}
          >
            ✕
          </ActionIcon>
        </Group>
      ))}
      <Group>
        <Button size="xs" variant="light" onClick={() => props.onChange([...props.value, { ...NEW_CONDITION }])}>
          {t.routing.addCondition}
        </Button>
      </Group>
    </Stack>
  );
}

/** Settings > Email routing (spec 6.5): every matching rule applies, in order (owner O-3). */
export function RoutingRulesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const meta = useTicketMeta();
  const rules = useQuery({ queryKey: ['routing-rules'], queryFn: () => api<Rule[]>('GET', '/settings/email-routing') });
  const mailboxList = useQuery({
    queryKey: ['my-mailboxes'],
    queryFn: () => api<{ id: string; title: string }[]>('GET', '/mailboxes'),
  });
  const mailboxes = (mailboxList.data ?? []).map((m) => ({ value: m.id, label: m.title }));
  const [draft, setDraft] = useState<Draft | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['routing-rules'] });
  const save = useMutation({
    mutationFn: (d: Draft) => {
      const { id, ...body } = d;
      return id ? api('PUT', `/settings/email-routing/${id}`, body) : api('POST', '/settings/email-routing', body);
    },
    onSuccess: async () => {
      setDraft(null);
      notifyOk();
      await refresh();
    },
    onError: notifyError,
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api('PUT', '/settings/email-routing/order', { ids }),
    onSuccess: refresh,
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/settings/email-routing/${id}`),
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
    onError: notifyError,
  });
  const move = (i: number, by: -1 | 1) => {
    const ids = (rules.data ?? []).map((r) => r.id);
    const j = i + by;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };
  const category = (id?: string) => meta.data?.categories.find((c) => c.id === id)?.title;
  const setAction = (patch: Partial<Draft['actions']>) =>
    draft && setDraft({ ...draft, actions: { ...draft.actions, ...patch } });
  const keep = (data: { value: string; label: string }[]) => [{ value: '', label: t.routing.keep }, ...data];

  return (
    <Stack maw={900}>
      <Group justify="space-between">
        <Title order={2}>{t.routing.title}</Title>
        {can('settings_email_routing', 'create') && <Button onClick={() => setDraft(EMPTY)}>{t.routing.add}</Button>}
      </Group>
      <Text size="sm" c="dimmed">
        {t.routing.help}
      </Text>
      {rules.data?.map((r, i) => (
        <Paper key={r.id} withBorder p="sm">
          <Group justify="space-between" wrap="nowrap">
            <Group gap="xs" style={{ cursor: 'pointer' }} onClick={() => setDraft(r)}>
              <Text fw={600}>{`${i + 1}. ${r.title}`}</Text>
              <Badge variant="light">{t.routing.directions[r.direction]}</Badge>
              {!r.active && (
                <Badge variant="outline" color="gray">
                  Off
                </Badge>
              )}
              {r.actions.categoryId && <Text size="sm" c="dimmed">{`→ ${category(r.actions.categoryId) ?? ''}`}</Text>}
            </Group>
            {can('settings_email_routing', 'update') && (
              <Group gap={4}>
                <ActionIcon variant="default" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                  ▲
                </ActionIcon>
                <ActionIcon
                  variant="default"
                  aria-label="Move down"
                  disabled={i === rules.data!.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ▼
                </ActionIcon>
              </Group>
            )}
          </Group>
          {r.description && (
            <Text size="sm" c="dimmed">
              {r.description}
            </Text>
          )}
        </Paper>
      ))}

      <Drawer
        opened={!!draft}
        onClose={() => setDraft(null)}
        position="right"
        size="xl"
        title={draft?.id ? draft.title : t.routing.add}
      >
        {draft && (
          <Stack>
            <TextInput
              label={t.routing.name}
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
            />
            <TextInput
              label={t.routing.description}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.currentTarget.value })}
            />
            <Group grow>
              <Select
                label={t.routing.direction}
                data={Object.entries(t.routing.directions).map(([value, label]) => ({ value, label }))}
                value={draft.direction}
                allowDeselect={false}
                onChange={(v) => v && setDraft({ ...draft, direction: v as Draft['direction'] })}
              />
              <Checkbox
                mt="lg"
                label={t.routing.active}
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.currentTarget.checked })}
              />
            </Group>
            <ConditionList
              label={t.routing.all}
              value={draft.all}
              mailboxes={mailboxes}
              onChange={(all) => setDraft({ ...draft, all })}
            />
            <ConditionList
              label={t.routing.any}
              value={draft.any}
              mailboxes={mailboxes}
              onChange={(any) => setDraft({ ...draft, any })}
            />
            <Text size="sm" fw={600}>
              {t.routing.actions}
            </Text>
            <Select
              label={t.routing.category}
              data={keep((meta.data?.categories ?? []).map((c) => ({ value: c.id, label: c.title })))}
              value={draft.actions.categoryId ?? ''}
              searchable
              onChange={(v) => setAction({ categoryId: v || undefined })}
            />
            <UserPicker
              label={t.routing.user}
              value={draft.actions.userId ?? null}
              onChange={(v) => setAction({ userId: v ?? undefined })}
            />
            <Group grow>
              <Select
                label={t.routing.priority}
                data={keep(Object.entries(t.tickets.priorities).map(([value, label]) => ({ value, label })))}
                value={draft.actions.priority ?? ''}
                onChange={(v) => setAction({ priority: (v || undefined) as Draft['actions']['priority'] })}
              />
              <Select
                label={t.routing.state}
                data={keep(['open', 'waiting'].map((value) => ({ value, label: t.tickets.states[value]! })))}
                value={draft.actions.state ?? ''}
                onChange={(v) => setAction({ state: (v || undefined) as Draft['actions']['state'] })}
              />
            </Group>
            <MultiSelect
              label={t.routing.statuses}
              data={(meta.data?.statuses ?? []).map((s) => ({ value: s.id, label: s.title }))}
              value={draft.actions.statusIds ?? []}
              onChange={(ids) => setAction({ statusIds: ids.length ? ids : undefined })}
            />
            <Text size="xs" c="dimmed">
              {t.routing.customHelp}
            </Text>
            <Group justify="space-between">
              {draft.id && can('settings_email_routing', 'delete') ? (
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

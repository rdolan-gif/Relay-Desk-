import {
  ActionIcon,
  Alert,
  Button,
  Checkbox,
  Drawer,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';

// ------------------------------------------------------------------ SLAs

interface Target {
  response: number | null;
  solution: number;
}
interface Sla {
  id: string;
  title: string;
  unit: 'hours' | 'minutes';
  basisFieldId: string | null;
  targets: Record<string, Target>;
}
type SlaDraft = Omit<Sla, 'id' | 'targets'> & {
  id?: string;
  targets: Record<string, { response: number | null; solution: number | null }>;
};
interface BasisField {
  id: string;
  name: string;
  options: { value: string; label: string }[];
}

const OTHER = '_other';
const EMPTY_SLA: SlaDraft = { title: '', unit: 'hours', basisFieldId: null, targets: {} };

/** Settings › SLAs (spec 8): Response and Solution per priority, or per value of a select field. */
export function SlasPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['slas'], queryFn: () => api<Sla[]>('GET', '/settings/slas') });
  const fields = useQuery({
    queryKey: ['sla-basis-fields'],
    queryFn: () => api<BasisField[]>('GET', '/settings/slas/basis-fields'),
  });
  const [draft, setDraft] = useState<SlaDraft | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['slas'] });
  const save = useMutation({
    mutationFn: (d: SlaDraft) => {
      const { id, ...body } = d;
      const targets = Object.fromEntries(
        rows(d).map((r) => [
          r.key,
          { response: d.targets[r.key]?.response ?? null, solution: d.targets[r.key]?.solution ?? 0 },
        ]),
      );
      return id
        ? api('PUT', `/settings/slas/${id}`, { ...body, targets })
        : api('POST', '/settings/slas', { ...body, targets });
    },
    onSuccess: async () => {
      setDraft(null);
      notifyOk();
      await refresh();
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/settings/slas/${id}`),
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
    onError: notifyError,
  });

  const rows = (d: SlaDraft): { key: string; label: string }[] => {
    if (!d.basisFieldId)
      return (['low', 'normal', 'high'] as const).map((k) => ({ key: k, label: t.tickets.priorities[k]! }));
    const f = fields.data?.find((x) => x.id === d.basisFieldId);
    return [...(f?.options ?? []).map((o) => ({ key: o.value, label: o.label })), { key: OTHER, label: t.sla.other }];
  };
  const basisName = (s: Sla) =>
    s.basisFieldId ? (fields.data?.find((f) => f.id === s.basisFieldId)?.name ?? '…') : t.sla.priority;
  const setTarget = (key: string, patch: Partial<{ response: number | null; solution: number | null }>) =>
    draft &&
    setDraft({
      ...draft,
      targets: { ...draft.targets, [key]: { response: null, solution: null, ...draft.targets[key], ...patch } },
    });

  return (
    <Stack maw={900}>
      <Group justify="space-between">
        <Title order={2}>{t.sla.title}</Title>
        {can('settings_sla', 'create') && <Button onClick={() => setDraft(EMPTY_SLA)}>{t.sla.add}</Button>}
      </Group>
      <Text size="sm" c="dimmed">
        {t.sla.help}
      </Text>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t.sla.name}</Table.Th>
            <Table.Th>{t.sla.basis}</Table.Th>
            <Table.Th>{t.sla.unit}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {list.data?.map((s) => (
            <Table.Tr
              key={s.id}
              style={{ cursor: 'pointer' }}
              tabIndex={0}
              onClick={() => setDraft(s)}
              onKeyDown={(e) => e.key === 'Enter' && setDraft(s)}
            >
              <Table.Td>{s.title}</Table.Td>
              <Table.Td>{basisName(s)}</Table.Td>
              <Table.Td>{t.sla.units[s.unit]}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Drawer
        opened={!!draft}
        onClose={() => setDraft(null)}
        position="right"
        size="lg"
        title={draft?.id ? draft.title : t.sla.add}
      >
        {draft && (
          <Stack>
            <TextInput
              label={t.sla.name}
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
            />
            <Group grow>
              <Select
                label={t.sla.basis}
                data={[
                  { value: '', label: t.sla.priority },
                  ...(fields.data ?? []).map((f) => ({ value: f.id, label: f.name })),
                ]}
                value={draft.basisFieldId ?? ''}
                allowDeselect={false}
                onChange={(v) => setDraft({ ...draft, basisFieldId: v || null, targets: {} })}
              />
              <Select
                label={t.sla.unit}
                data={Object.entries(t.sla.units).map(([value, label]) => ({ value, label }))}
                value={draft.unit}
                allowDeselect={false}
                onChange={(v) => v && setDraft({ ...draft, unit: v as SlaDraft['unit'] })}
              />
            </Group>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{draft.basisFieldId ? t.sla.target : t.sla.priority}</Table.Th>
                  <Table.Th>{t.sla.response}</Table.Th>
                  <Table.Th>{t.sla.solution}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows(draft).map((r) => (
                  <Table.Tr key={r.key}>
                    <Table.Td>{r.label}</Table.Td>
                    <Table.Td>
                      <NumberInput
                        aria-label={`${t.sla.response}: ${r.label}`}
                        min={0}
                        decimalScale={2}
                        value={draft.targets[r.key]?.response ?? ''}
                        onChange={(v) => setTarget(r.key, { response: v === '' ? null : Number(v) })}
                      />
                    </Table.Td>
                    <Table.Td>
                      <NumberInput
                        aria-label={`${t.sla.solution}: ${r.label}`}
                        min={0}
                        decimalScale={2}
                        required
                        value={draft.targets[r.key]?.solution ?? ''}
                        onChange={(v) => setTarget(r.key, { solution: v === '' ? null : Number(v) })}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Text size="xs" c="dimmed">
              {t.sla.responseHelp}
            </Text>
            <Group justify="space-between">
              {draft.id && can('settings_sla', 'delete') ? (
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

// ------------------------------------------------------------------ Working hours

interface Interval {
  start: string;
  end: string;
}
interface Exception {
  date: string;
  title?: string;
  intervals?: Interval[];
}
interface TimeGroup {
  id: string;
  title: string;
  timezone: string;
  week: Interval[][];
  exceptions: Exception[];
}
type TgDraft = Omit<TimeGroup, 'id'> & { id?: string };
const NINE_FIVE = (): Interval[] => [{ start: '09:00', end: '17:00' }];
const EMPTY_TG = (): TgDraft => ({
  title: '',
  timezone: 'Europe/London',
  week: [NINE_FIVE(), NINE_FIVE(), NINE_FIVE(), NINE_FIVE(), NINE_FIVE(), [], []],
  exceptions: [],
});
const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['Europe/London', 'UTC'];
  }
})();

function Intervals(props: { value: Interval[]; onChange: (v: Interval[]) => void; label: string }) {
  return (
    <Group gap="xs" wrap="wrap">
      {props.value.length === 0 && (
        <Text size="sm" c="dimmed" w={70}>
          {t.timeGroups.closed}
        </Text>
      )}
      {props.value.map((iv, i) => (
        <Group key={i} gap={4} wrap="nowrap">
          <TextInput
            type="time"
            aria-label={`${props.label} ${t.timeGroups.from}`}
            w={110}
            value={iv.start}
            onChange={(e) =>
              props.onChange(props.value.map((x, j) => (j === i ? { ...x, start: e.currentTarget.value } : x)))
            }
          />
          <Text size="sm">–</Text>
          <TextInput
            type="time"
            aria-label={`${props.label} ${t.timeGroups.to}`}
            w={110}
            value={iv.end === '24:00' ? '23:59' : iv.end}
            onChange={(e) =>
              props.onChange(props.value.map((x, j) => (j === i ? { ...x, end: e.currentTarget.value } : x)))
            }
          />
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={`Remove ${props.label} hours`}
            onClick={() => props.onChange(props.value.filter((_, j) => j !== i))}
          >
            ✕
          </ActionIcon>
        </Group>
      ))}
      <Button
        size="compact-xs"
        variant="subtle"
        onClick={() =>
          props.onChange([
            ...props.value,
            props.value.length ? { start: '13:00', end: '17:00' } : { start: '09:00', end: '17:00' },
          ])
        }
      >
        {t.timeGroups.addInterval}
      </Button>
    </Group>
  );
}

/** Settings › Working hours (spec 8): weekly hours, timezone and dated exceptions. */
export function TimeGroupsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['time-groups'], queryFn: () => api<TimeGroup[]>('GET', '/settings/time-groups') });
  const [draft, setDraft] = useState<TgDraft | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['time-groups'] });
  const save = useMutation({
    mutationFn: (d: TgDraft) => {
      const { id, ...body } = d;
      return id
        ? api<TimeGroup>('PUT', `/settings/time-groups/${id}`, body)
        : api<TimeGroup>('POST', '/settings/time-groups', body);
    },
    onSuccess: async () => {
      setDraft(null);
      notifyOk();
      await refresh();
    },
    onError: notifyError,
  });
  const importHolidays = useMutation({
    mutationFn: (id: string) =>
      api<TimeGroup & { added: number; source: string }>('POST', `/settings/time-groups/${id}/import-bank-holidays`),
    onSuccess: async (r) => {
      notifyOk(t.timeGroups.imported(r.added, r.source));
      setDraft((d) => (d ? { ...d, exceptions: r.exceptions } : d));
      await refresh();
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/settings/time-groups/${id}`),
    onSuccess: async () => {
      setDraft(null);
      await refresh();
    },
    onError: notifyError,
  });
  const summary = (tg: TimeGroup) =>
    tg.week
      .map((d, i) =>
        d.length ? `${t.timeGroups.days[i]!.slice(0, 3)} ${d.map((x) => `${x.start}–${x.end}`).join(', ')}` : null,
      )
      .filter(Boolean)
      .join(' · ');
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Stack maw={1000}>
      <Group justify="space-between">
        <Title order={2}>{t.timeGroups.title}</Title>
        {can('settings_time_groups', 'create') && (
          <Button onClick={() => setDraft(EMPTY_TG())}>{t.timeGroups.add}</Button>
        )}
      </Group>
      <Text size="sm" c="dimmed">
        {t.timeGroups.help}
      </Text>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t.timeGroups.name}</Table.Th>
            <Table.Th>{t.timeGroups.title}</Table.Th>
            <Table.Th>{t.timeGroups.timezone}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {list.data?.map((tg) => (
            <Table.Tr
              key={tg.id}
              style={{ cursor: 'pointer' }}
              tabIndex={0}
              onClick={() => setDraft(tg)}
              onKeyDown={(e) => e.key === 'Enter' && setDraft(tg)}
            >
              <Table.Td>{tg.title}</Table.Td>
              <Table.Td>
                <Text size="sm">{summary(tg)}</Text>
              </Table.Td>
              <Table.Td>{tg.timezone}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Drawer
        opened={!!draft}
        onClose={() => setDraft(null)}
        position="right"
        size="xl"
        title={draft?.id ? draft.title : t.timeGroups.add}
      >
        {draft && (
          <Stack>
            <Group grow>
              <TextInput
                label={t.timeGroups.name}
                required
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
              />
              <Select
                label={t.timeGroups.timezone}
                data={TIMEZONES}
                searchable
                allowDeselect={false}
                value={draft.timezone}
                onChange={(v) => v && setDraft({ ...draft, timezone: v })}
              />
            </Group>
            <Stack gap="xs">
              {t.timeGroups.days.map((day, i) => (
                <Group key={day} align="center" wrap="nowrap">
                  <Text size="sm" fw={600} w={100}>
                    {day}
                  </Text>
                  <Intervals
                    label={day}
                    value={draft.week[i] ?? []}
                    onChange={(v) => setDraft({ ...draft, week: draft.week.map((d, j) => (j === i ? v : d)) })}
                  />
                </Group>
              ))}
            </Stack>
            <Group justify="space-between">
              <Text fw={600}>{t.timeGroups.exceptions}</Text>
              <Group gap="xs">
                {draft.id && can('settings_time_groups', 'update') && (
                  <Button
                    size="xs"
                    variant="light"
                    loading={importHolidays.isPending}
                    onClick={() => importHolidays.mutate(draft.id!)}
                  >
                    {t.timeGroups.importHolidays}
                  </Button>
                )}
                <Button
                  size="xs"
                  variant="default"
                  onClick={() =>
                    setDraft({ ...draft, exceptions: [...draft.exceptions, { date: today, title: '', intervals: [] }] })
                  }
                >
                  {t.timeGroups.addException}
                </Button>
              </Group>
            </Group>
            {draft.exceptions.length === 0 && (
              <Alert color="gray" variant="light">
                <Text size="sm">{t.crm.none}</Text>
              </Alert>
            )}
            {draft.exceptions.map((ex, i) => {
              const set = (patch: Partial<Exception>) =>
                setDraft({ ...draft, exceptions: draft.exceptions.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
              const closed = !ex.intervals?.length;
              return (
                <Paper key={i} withBorder p="xs" style={{ opacity: ex.date < today ? 0.6 : 1 }}>
                  <Group align="flex-end" wrap="wrap">
                    <TextInput
                      type="date"
                      label={t.timeGroups.date}
                      value={ex.date}
                      onChange={(e) => set({ date: e.currentTarget.value })}
                      w={170}
                    />
                    <TextInput
                      label={t.timeGroups.reason}
                      value={ex.title ?? ''}
                      onChange={(e) => set({ title: e.currentTarget.value })}
                      style={{ flex: 1 }}
                    />
                    <Checkbox
                      label={t.timeGroups.closedAllDay}
                      checked={closed}
                      onChange={(e) => set({ intervals: e.currentTarget.checked ? [] : NINE_FIVE() })}
                      mb={8}
                    />
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      mb={6}
                      aria-label={`Remove ${ex.date}`}
                      onClick={() => setDraft({ ...draft, exceptions: draft.exceptions.filter((_, j) => j !== i) })}
                    >
                      ✕
                    </ActionIcon>
                  </Group>
                  {!closed && (
                    <Intervals label={ex.date} value={ex.intervals ?? []} onChange={(v) => set({ intervals: v })} />
                  )}
                </Paper>
              );
            })}
            <Group justify="space-between">
              {draft.id && can('settings_time_groups', 'delete') ? (
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

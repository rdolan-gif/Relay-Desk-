import { Badge, Button, Code, Group, Stack, Switch, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useCrmMeta } from '../crm/hooks';
import type { HistoryEntry } from '../crm/types';
import { formatDateTime } from '../format';
import { t } from '../i18n/en-GB';

const SYSTEM_LABELS: Record<string, string> = {
  name: t.crm.name,
  title: t.crm.title,
  emails: t.crm.emails,
  phones: t.crm.phones,
  accountId: t.crm.account,
  contactId: t.crm.contact,
  databaseId: t.crm.database,
  recordTypeId: t.crm.recordType,
  status: t.crm.status,
  stage: t.crm.stage,
  userId: t.crm.owner,
  state: t.tickets.state,
  priority: t.tickets.priority,
  categoryId: t.tickets.category,
  statusIds: t.tickets.status,
  followerIds: t.tickets.followers,
  deadline: t.tickets.deadline,
  reopenAt: t.tickets.reopenAt,
  description: t.tickets.description,
  parentId: t.tickets.parent,
  mergedIntoId: 'Merged into',
  mergedTicketIds: 'Merged tickets',
  activities: 'Activities moved in',
  activityMovedTo: 'Activity moved to ticket',
  activityMovedFrom: 'Activity moved from ticket',
};

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function show(v: unknown): string {
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return t.crm.none;
  if (Array.isArray(v)) return v.join(', ');
  return typeof v === 'string' && v.startsWith('<') ? stripHtml(v) : String(v);
}

export interface HistoryActivity {
  id: string;
  createdAt: string;
  userName: string | null;
  summary: string;
}

interface Props {
  endpoint: string;
  onViewAt: (at: string) => void;
  /** Activities to interleave (tickets), with a "Hide activities" toggle (spec 6.2). */
  activities?: HistoryActivity[];
  /** Turns ids into readable values for a field (e.g. user and status names). */
  describe?: (field: string, value: unknown) => string | undefined;
}

const HIDE_KEY = 'rd.history.hideActivities';

/** Field-change log with old and new values; pick an entry to view the form as it was (spec 6.2, 12.2). */
export function HistoryPanel({ endpoint, onViewAt, activities, describe }: Props) {
  const { me } = useAuth();
  const meta = useCrmMeta();
  const history = useQuery({
    queryKey: [endpoint, 'history'],
    queryFn: () => api<HistoryEntry[]>('GET', `${endpoint}/history`),
  });
  const [hideActivities, setHideActivities] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggleHide = (v: boolean) => {
    setHideActivities(v);
    try {
      localStorage.setItem(HIDE_KEY, v ? '1' : '0');
    } catch {
      /* storage unavailable */
    }
  };
  const fieldName = (key: string) =>
    key.startsWith('custom.')
      ? (meta.data?.customFields.find((f) => f.id === key.slice(7))?.name ?? key)
      : key.startsWith('comment:')
        ? t.tickets.comment
        : (SYSTEM_LABELS[key] ?? key);
  const value = (field: string, v: unknown) => describe?.(field, v) ?? show(v);
  const tz = me!.user.timezone;

  type Row = { kind: 'h'; at: string; h: HistoryEntry } | { kind: 'a'; at: string; a: HistoryActivity };
  const rows: Row[] = [
    ...(history.data ?? []).map((h) => ({ kind: 'h' as const, at: h.createdAt, h })),
    ...(hideActivities ? [] : (activities ?? []).map((a) => ({ kind: 'a' as const, at: a.createdAt, a }))),
  ].sort((x, y) => y.at.localeCompare(x.at));

  return (
    <Stack>
      {activities && (
        <Switch
          label={t.tickets.hideActivities}
          checked={hideActivities}
          onChange={(e) => toggleHide(e.currentTarget.checked)}
        />
      )}
      {rows.length === 0 && <Text c="dimmed">{t.crm.history.empty}</Text>}
      {rows.map((row) =>
        row.kind === 'a' ? (
          <Group key={`a${row.a.id}`} gap="xs" wrap="nowrap">
            <Badge variant="outline">{t.tickets.comment}</Badge>
            <Text size="sm">{formatDateTime(row.a.createdAt, tz)}</Text>
            <Text size="sm" c="dimmed">
              {row.a.userName ?? t.tickets.system}
            </Text>
            <Text size="sm" lineClamp={1} style={{ flex: 1 }}>
              {row.a.summary}
            </Text>
          </Group>
        ) : (
          <Stack key={row.h.id} gap={4}>
            <Group justify="space-between">
              <Group gap="xs">
                <Badge variant="light">{t.crm.history.actions[row.h.action] ?? row.h.action}</Badge>
                <Text size="sm">{formatDateTime(row.h.createdAt, tz)}</Text>
                <Text size="sm" c="dimmed">
                  {row.h.userName ?? t.tickets.system}
                </Text>
              </Group>
              {row.h.action !== 'delete' && (
                <Button size="compact-xs" variant="subtle" onClick={() => onViewAt(row.h.createdAt)}>
                  {t.crm.history.viewAt}
                </Button>
              )}
            </Group>
            {row.h.changes.length > 0 && (
              <Table withTableBorder fz="sm">
                <Table.Tbody>
                  {row.h.changes.map((c) => (
                    <Table.Tr key={c.field}>
                      <Table.Td w="30%">{fieldName(c.field)}</Table.Td>
                      <Table.Td>
                        {c.field.startsWith('comment:') ? (
                          // Side-by-side view of a comment edit (spec 6.2).
                          <Group grow align="flex-start">
                            <Code block>{show(c.old)}</Code>
                            <Code block>{show(c.new)}</Code>
                          </Group>
                        ) : (
                          <>
                            <Code>{value(c.field, c.old)}</Code> → <Code>{value(c.field, c.new)}</Code>
                          </>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Stack>
        ),
      )}
    </Stack>
  );
}

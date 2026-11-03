import { Badge, Button, Code, Group, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
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
};

function show(v: unknown): string {
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) return t.crm.none;
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

/** Field-change log with old and new values; pick an entry to view the form as it was (spec 12.2). */
export function HistoryPanel({ endpoint, onViewAt }: { endpoint: string; onViewAt: (at: string) => void }) {
  const { me } = useAuth();
  const meta = useCrmMeta();
  const history = useQuery({
    queryKey: [endpoint, 'history'],
    queryFn: () => api<HistoryEntry[]>('GET', `${endpoint}/history`),
  });
  const fieldName = (key: string) =>
    key.startsWith('custom.')
      ? (meta.data?.customFields.find((f) => f.id === key.slice(7))?.name ?? key)
      : (SYSTEM_LABELS[key] ?? key);

  if (history.data?.length === 0) return <Text c="dimmed">{t.crm.history.empty}</Text>;
  return (
    <Stack>
      {[...(history.data ?? [])].reverse().map((h) => (
        <Stack key={h.id} gap={4}>
          <Group justify="space-between">
            <Group gap="xs">
              <Badge variant="light">{t.crm.history.actions[h.action] ?? h.action}</Badge>
              <Text size="sm">{formatDateTime(h.createdAt, me!.user.timezone)}</Text>
              <Text size="sm" c="dimmed">
                {h.userName ?? t.crm.none}
              </Text>
            </Group>
            {h.action !== 'delete' && (
              <Button size="compact-xs" variant="subtle" onClick={() => onViewAt(h.createdAt)}>
                {t.crm.history.viewAt}
              </Button>
            )}
          </Group>
          {h.changes.length > 0 && (
            <Table withTableBorder fz="sm">
              <Table.Tbody>
                {h.changes.map((c) => (
                  <Table.Tr key={c.field}>
                    <Table.Td w="30%">{fieldName(c.field)}</Table.Td>
                    <Table.Td>
                      <Code>{show(c.old)}</Code> → <Code>{show(c.new)}</Code>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      ))}
    </Stack>
  );
}

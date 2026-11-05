import { Code, Stack, Table, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { formatDateTime } from '../../format';
import { t } from '../../i18n/en-GB';
import type { AuditEntry } from '../../types';

export function AuditLogPage() {
  const { me } = useAuth();
  const [eventType, setEventType] = useState('');
  const q = useQuery({
    queryKey: ['audit', eventType],
    queryFn: () =>
      api<AuditEntry[]>(
        'GET',
        `/settings/audit-log?limit=200${eventType ? `&eventType=${encodeURIComponent(eventType)}` : ''}`,
      ),
  });
  return (
    <Stack>
      <Title order={2}>{t.audit.title}</Title>
      <TextInput
        label={t.audit.event}
        placeholder="e.g. auth.login_failed"
        value={eventType}
        onChange={(e) => setEventType(e.currentTarget.value)}
        maw={320}
      />
      <Table striped>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t.audit.when}</Table.Th>
            <Table.Th>{t.audit.event}</Table.Th>
            <Table.Th>{t.audit.actor}</Table.Th>
            <Table.Th>{t.audit.target}</Table.Th>
            <Table.Th>{t.audit.ip}</Table.Th>
            <Table.Th>{t.audit.details}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {q.data?.map((e) => (
            <Table.Tr key={e.id}>
              <Table.Td>{formatDateTime(e.createdAt, me!.user.timezone)}</Table.Td>
              <Table.Td>{e.eventType}</Table.Td>
              <Table.Td>{e.actorLabel ?? e.actorUserId ?? '—'}</Table.Td>
              <Table.Td>{e.targetType ? `${e.targetType}:${e.targetId ?? ''}` : '—'}</Table.Td>
              <Table.Td>{e.ip ?? '—'}</Table.Td>
              <Table.Td>
                {Object.keys(e.details).length > 0 && <Code block>{JSON.stringify(e.details, null, 1)}</Code>}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

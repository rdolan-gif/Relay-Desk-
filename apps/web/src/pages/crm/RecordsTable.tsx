import { Badge, Button, Group, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import type { CrmRecord, Page } from '../../crm/types';
import { t } from '../../i18n/en-GB';

/** CRM records linked to a contact or account. */
export function RecordsTable({ endpoint, newRecordQuery }: { endpoint: string; newRecordQuery: string }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const records = useQuery({
    queryKey: [endpoint],
    queryFn: () => api<Page<CrmRecord>>('GET', `${endpoint}?pageSize=200`),
  });
  return (
    <Stack>
      {can('crm_records', 'create') && (
        <Group>
          <Button size="xs" variant="light" onClick={() => nav(`/crm/records/new?${newRecordQuery}`)}>
            {t.crm.newRecord}
          </Button>
        </Group>
      )}
      {records.data?.items.length === 0 ? (
        <Text c="dimmed">{t.crm.noResults}</Text>
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t.crm.title}</Table.Th>
              <Table.Th>{t.crm.recordType}</Table.Th>
              <Table.Th>{t.crm.status}</Table.Th>
              <Table.Th>{t.crm.stage}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {records.data?.items.map((r) => (
              <Table.Tr key={r.id} onClick={() => nav(`/crm/records/${r.id}`)} style={{ cursor: 'pointer' }}>
                <Table.Td>{r.title}</Table.Td>
                <Table.Td>{r.recordTypeTitle}</Table.Td>
                <Table.Td>{r.status ?? t.crm.none}</Table.Td>
                <Table.Td>
                  <Badge color={r.stage === 'open' ? 'teal' : 'gray'} variant="light">
                    {t.crm.stages[r.stage]}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}

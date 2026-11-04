import { Button, Stack, Table, Text, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { Segmented } from '../../components/Segmented';
import { formatDateTime } from '../../format';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';

/** Settings › Deleted items (spec 14): restore within 30 days. Administrators only. */
export function DeletedItemsPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [type, setType] = useState('tickets');
  const list = useQuery({
    queryKey: ['deleted', type],
    queryFn: () => api<{ id: string; title: string; deletedAt: string }[]>('GET', `/deleted/${type}`),
  });
  const restore = useMutation({
    mutationFn: (id: string) => api('POST', `/deleted/${type}/${id}/restore`),
    onSuccess: async () => {
      notifyOk(t.deleted.restored);
      await qc.invalidateQueries({ queryKey: ['deleted', type] });
    },
    onError: notifyError,
  });
  return (
    <Stack maw={900}>
      <Title order={2}>{t.deleted.title}</Title>
      <Text size="sm" c="dimmed">
        {t.deleted.help}
      </Text>
      <Segmented
        label={t.deleted.title}
        data={Object.entries(t.deleted.types).map(([value, label]) => ({ value, label }))}
        value={type}
        onChange={setType}
      />
      {list.data?.length === 0 && <Text c="dimmed">{t.deleted.empty}</Text>}
      <Table>
        <Table.Tbody>
          {list.data?.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>{r.title}</Table.Td>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {t.deleted.when} {formatDateTime(r.deletedAt, me!.user.timezone)}
                </Text>
              </Table.Td>
              <Table.Td>
                <Button
                  size="xs"
                  variant="light"
                  loading={restore.isPending && restore.variables === r.id}
                  onClick={() => restore.mutate(r.id)}
                >
                  {t.deleted.restore}
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

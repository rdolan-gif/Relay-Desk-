import { Badge, Button, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api, downloadFile } from '../api';
import { useAuth } from '../auth';
import { jobSummary, type Job } from '../components/JobModal';
import { formatDateTime } from '../format';
import { t } from '../i18n/en-GB';
import { notifyError } from '../notify';

const COLOURS: Record<string, string> = { queued: 'gray', running: 'blue', done: 'green', failed: 'red' };

/** The person's recent background jobs and their files (spec 14). */
export function JobsPage() {
  const { me } = useAuth();
  const jobs = useQuery({ queryKey: ['jobs'], queryFn: () => api<Job[]>('GET', '/jobs'), refetchInterval: 3000 });
  return (
    <Stack maw={900}>
      <Title order={2}>{t.jobs.title}</Title>
      {jobs.data?.length === 0 && <Text c="dimmed">{t.jobs.empty}</Text>}
      <Table>
        <Table.Tbody>
          {jobs.data?.map((j) => (
            <Table.Tr key={j.id}>
              <Table.Td>
                <Text size="sm" fw={500}>
                  {j.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {formatDateTime(j.createdAt, me!.user.timezone)}
                  {j.status === 'done' && jobSummary(j) ? ` · ${jobSummary(j)}` : ''}
                  {j.error ? ` · ${j.error}` : ''}
                </Text>
              </Table.Td>
              <Table.Td>
                <Badge color={COLOURS[j.status]} variant="light">
                  {t.jobs.statuses[j.status]}
                  {j.status === 'running' ? ` ${t.jobs.progress(j.done, j.total)}` : ''}
                </Badge>
              </Table.Td>
              <Table.Td>
                {j.hasFile && (
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => downloadFile(`/jobs/${j.id}/file`, j.fileName ?? 'download').catch(notifyError)}
                  >
                    {t.jobs.download}
                  </Button>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

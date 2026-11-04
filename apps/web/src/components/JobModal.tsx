import { Alert, Button, Group, Modal, Progress, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api, downloadFile } from '../api';
import { t } from '../i18n/en-GB';
import { notifyError } from '../notify';

export interface Job {
  id: string;
  kind: string;
  title: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  total: number;
  done: number;
  result: Record<string, unknown> | null;
  error: string | null;
  hasFile: boolean;
  fileName: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export const jobSummary = (j: Job) =>
  Object.entries(j.result ?? {})
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');

/** Progress of a background job (spec 14), with its download when finished. */
export function JobModal({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const job = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api<Job>('GET', `/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (q) => (q.state.data && ['done', 'failed'].includes(q.state.data.status) ? false : 1000),
  });
  const j = job.data;
  const pct = j && j.total ? Math.round((j.done / j.total) * 100) : j?.status === 'done' ? 100 : 0;
  return (
    <Modal opened={!!jobId} onClose={onClose} title={j?.title ?? t.jobs.title}>
      {j && (
        <Stack>
          <Text size="sm">
            {t.jobs.statuses[j.status]} · {t.jobs.progress(j.done, j.total)}
          </Text>
          <Progress value={pct} animated={j.status === 'running' || j.status === 'queued'} aria-label={t.jobs.title} />
          {j.status === 'done' && jobSummary(j) && <Text size="sm">{jobSummary(j)}</Text>}
          {j.status === 'failed' && <Alert color="red">{j.error}</Alert>}
          {(j.status === 'queued' || j.status === 'running') && (
            <Text size="xs" c="dimmed">
              {t.jobs.started}
            </Text>
          )}
          <Group justify="flex-end">
            {j.hasFile && (
              <Button onClick={() => downloadFile(`/jobs/${j.id}/file`, j.fileName ?? 'download').catch(notifyError)}>
                {t.jobs.download}
              </Button>
            )}
            <Button variant="default" onClick={onClose}>
              {t.jobs.close}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

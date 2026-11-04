import { Button, Checkbox, Popover, Stack, Text } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { t } from '../i18n/en-GB';
import { notifyError } from '../notify';

interface Queue {
  id: string;
  title: string;
  address: string;
  ready: boolean;
}

/**
 * "Ready for email" (spec 9): the mailboxes this person is logged in to. While ready, new
 * tickets from them can be handed out automatically (if their rights set a limit).
 */
export function ReadyForEmail() {
  const qc = useQueryClient();
  const queues = useQuery({ queryKey: ['me-queues'], queryFn: () => api<Queue[]>('GET', '/me/queues') });
  const set = useMutation({
    mutationFn: (queueIds: string[]) => api<Queue[]>('PUT', '/me/queues', { queueIds }),
    onSuccess: (data) => {
      qc.setQueryData(['me-queues'], data);
      void qc.invalidateQueries({ queryKey: ['/tickets'] });
    },
    onError: notifyError,
  });
  const list = queues.data ?? [];
  if (!list.length) return null;
  const ready = list.filter((q) => q.ready);
  const toggle = (id: string, on: boolean) =>
    set.mutate(on ? [...ready.map((q) => q.id), id] : ready.filter((q) => q.id !== id).map((q) => q.id));
  return (
    <Popover position="bottom-end" withArrow shadow="md">
      <Popover.Target>
        <Button
          size="xs"
          variant={ready.length ? 'filled' : 'default'}
          color={ready.length ? 'green' : undefined}
          aria-label={t.ready.label}
        >
          {ready.length ? t.ready.on(ready.length) : t.ready.off}
        </Button>
      </Popover.Target>
      <Popover.Dropdown maw={320}>
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            {t.ready.label}
          </Text>
          <Text size="xs" c="dimmed">
            {t.ready.help}
          </Text>
          {list.map((q) => (
            <Checkbox
              key={q.id}
              label={`${q.title} (${q.address})`}
              checked={q.ready}
              disabled={set.isPending}
              onChange={(e) => toggle(q.id, e.currentTarget.checked)}
            />
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

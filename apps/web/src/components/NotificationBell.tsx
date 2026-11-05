import { ActionIcon, Button, Group, Indicator, Popover, ScrollArea, Stack, Text, UnstyledButton } from '@mantine/core';
import { notifications as toast } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { formatDateTime } from '../format';
import { t } from '../i18n/en-GB';

interface Notice {
  id: string;
  kind: string;
  ticketId: number | null;
  link?: string | null;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}
interface Inbox {
  items: Notice[];
  unread: number;
}

const Bell = () => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

/**
 * In-app notification centre (spec 13): bell with unread count, newest first, mark read,
 * mark all read, click opens the ticket. New entries arrive live (Server-Sent Events).
 */
export function NotificationBell() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const inbox = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<Inbox>('GET', '/me/notifications'),
    refetchInterval: 120_000,
  });

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource('/api/me/events', { withCredentials: true });
      es.addEventListener('notification', (e) => {
        const n = JSON.parse((e as MessageEvent).data) as Notice;
        toast.show({ title: n.title, message: n.body, autoClose: 6000 });
        void qc.invalidateQueries({ queryKey: ['notifications'] });
      });
      es.addEventListener('unread', () => void qc.invalidateQueries({ queryKey: ['notifications'] }));
    } catch {
      /* EventSource unavailable: the list still refreshes every two minutes */
    }
    return () => es?.close();
  }, [qc]);

  const read = useMutation({
    mutationFn: (id: string | 'all') =>
      api('POST', id === 'all' ? '/me/notifications/read-all' : `/me/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = inbox.data?.unread ?? 0;
  const openItem = (n: Notice) => {
    if (!n.readAt) read.mutate(n.id);
    setOpen(false);
    if (n.ticketId) nav(`/tickets/${n.ticketId}`);
    else if (n.link?.startsWith('/')) nav(n.link);
  };

  return (
    <Popover opened={open} onChange={setOpen} position="bottom-end" withArrow shadow="md" width={360}>
      <Popover.Target>
        <Indicator label={unread > 99 ? '99+' : unread} size={16} disabled={!unread} color="red" offset={4}>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label={t.notifications.open(unread)}
            onClick={() => setOpen((o) => !o)}
          >
            <Bell />
          </ActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Group justify="space-between" p="xs">
          <Text fw={600}>{t.notifications.title}</Text>
          <Button size="compact-xs" variant="subtle" disabled={!unread} onClick={() => read.mutate('all')}>
            {t.notifications.markAll}
          </Button>
        </Group>
        <ScrollArea.Autosize mah={420}>
          <Stack gap={0}>
            {(inbox.data?.items ?? []).length === 0 && (
              <Text size="sm" c="dimmed" p="sm">
                {t.notifications.empty}
              </Text>
            )}
            {inbox.data?.items.map((n) => (
              <UnstyledButton
                key={n.id}
                onClick={() => openItem(n)}
                p="xs"
                style={{
                  borderTop: '1px solid var(--mantine-color-default-border)',
                  background: n.readAt ? undefined : 'var(--mantine-primary-color-light)',
                }}
              >
                <Text size="sm" fw={n.readAt ? 400 : 600}>
                  {n.title}
                </Text>
                {n.body && (
                  <Text size="xs" c="dimmed" lineClamp={2}>
                    {n.body}
                  </Text>
                )}
                <Text size="xs" c="dimmed">
                  {formatDateTime(n.createdAt, me!.user.timezone)}
                </Text>
              </UnstyledButton>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}

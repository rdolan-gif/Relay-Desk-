import { Avatar, Tooltip } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../api';
import { t } from '../i18n/en-GB';

interface Viewer {
  userId: string;
  name: string;
  editing: boolean;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/** Who else has this ticket open (spec 6.2, 13); editors are outlined in amber. */
export function PresenceAvatars({ ticketId, editing }: { ticketId: number; editing: boolean }) {
  const viewers = useQuery({
    queryKey: ['presence', ticketId, editing],
    queryFn: () => api<Viewer[]>('POST', `/tickets/${ticketId}/presence`, { editing }),
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });
  useEffect(
    () => () => {
      void api('POST', `/tickets/${ticketId}/presence/leave`).catch(() => undefined);
    },
    [ticketId],
  );
  if (!viewers.data?.length) return null;
  return (
    <Avatar.Group spacing="xs">
      {viewers.data.map((v) => (
        <Tooltip key={v.userId} label={v.editing ? t.presence.editing(v.name) : t.presence.viewing(v.name)} withArrow>
          <Avatar
            size="sm"
            radius="xl"
            color={v.editing ? 'amber' : 'ricoman'}
            variant={v.editing ? 'filled' : 'light'}
            aria-label={v.editing ? t.presence.editing(v.name) : t.presence.viewing(v.name)}
          >
            {initials(v.name)}
          </Avatar>
        </Tooltip>
      ))}
    </Avatar.Group>
  );
}

import { Group, Stack, Text, Tooltip } from '@mantine/core';
import { useAuth } from '../auth';
import { formatDateTime } from '../format';
import { t } from '../i18n/en-GB';
import type { TicketSla } from '../tickets/types';

/** "2 h 15 min" of working time. */
export function workingTime(minutes: number) {
  const m = Math.abs(Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest} min`;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

const Hand = () => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    style={{ flexShrink: 0 }}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12" />
    <path d="M11 5.5v-2a1.5 1.5 0 0 1 3 0V12" />
    <path d="M14 5.5a1.5 1.5 0 0 1 3 0V12" />
    <path d="M17 7.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 14.2a1.6 1.6 0 0 1 2.6-1.8L8 14" />
  </svg>
);
const Stopwatch = () => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    style={{ flexShrink: 0 }}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <circle cx="12" cy="13" r="8" />
    <path d="M12 9v4l2 2M10 2h4M12 2v3" />
  </svg>
);

const COLOUR: Record<string, string | undefined> = {
  counting: undefined,
  paused: 'dimmed',
  breached: 'red',
  met: 'green',
  missed: 'red',
};

/**
 * SLA icon (spec 6.2): a hand counts down to the first reply, then a stopwatch to the
 * deadline. Black = time left, dimmed = paused (Waiting), red = overdue or missed,
 * green = met. The tooltip has the exact times.
 */
export function SlaIcon(props: {
  sla: TicketSla | null | undefined;
  deadline: string | null;
  closedAt?: string | null;
  showText?: boolean;
}) {
  const { me } = useAuth();
  const tz = me!.user.timezone;
  const ind = props.sla?.indicator;
  if (!ind)
    return props.deadline ? (
      <Text size="sm">{formatDateTime(props.deadline, tz)}</Text>
    ) : (
      <Text size="sm" c="dimmed">
        {t.crm.none}
      </Text>
    );
  const sla = props.sla!;
  const text =
    ind.minutesLeft === null
      ? t.sla.statuses[ind.status]!
      : ind.minutesLeft >= 0
        ? t.sla.left(workingTime(ind.minutesLeft))
        : t.sla.over(workingTime(ind.minutesLeft));
  const label = `${ind.kind === 'response' ? t.sla.firstAnswerDue(formatDateTime(ind.due, tz)) : t.sla.solutionDue(formatDateTime(ind.due, tz))} · ${t.sla.statuses[ind.status]}`;
  return (
    <Tooltip
      withArrow
      multiline
      label={
        <Stack gap={2}>
          <Text size="xs" fw={600}>
            {t.sla.statuses[ind.status]}
            {ind.minutesLeft !== null ? ` · ${text}` : ''}
          </Text>
          {sla.firstAnswerDeadline && (
            <Text size="xs">{t.sla.firstAnswerDue(formatDateTime(sla.firstAnswerDeadline, tz))}</Text>
          )}
          {sla.firstAnswerAt && <Text size="xs">{t.sla.firstAnswerAt(formatDateTime(sla.firstAnswerAt, tz))}</Text>}
          {props.deadline && <Text size="xs">{t.sla.solutionDue(formatDateTime(props.deadline, tz))}</Text>}
          {props.closedAt && <Text size="xs">{t.sla.closedAt(formatDateTime(props.closedAt, tz))}</Text>}
          {sla.deadlineManual && <Text size="xs">{t.sla.manual}</Text>}
        </Stack>
      }
    >
      <Group
        gap={4}
        wrap="nowrap"
        c={COLOUR[ind.status]}
        aria-label={label}
        role="img"
        style={{ display: 'inline-flex' }}
      >
        {ind.kind === 'response' ? <Hand /> : <Stopwatch />}
        {ind.status === 'paused' && (
          <Text span size="xs" fw={700}>
            II
          </Text>
        )}
        {props.showText !== false && (
          <Text span size="sm" c={COLOUR[ind.status]} style={{ whiteSpace: 'nowrap' }}>
            {text}
          </Text>
        )}
      </Group>
    </Tooltip>
  );
}

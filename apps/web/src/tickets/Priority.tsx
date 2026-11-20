import { Badge, Box } from '@mantine/core';
import { t } from '../i18n/en-GB';
import { PRIORITY_COLOURS } from './hooks';

/** Traffic-light priority (owner O-33): low green, normal amber, high red. */
export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <Badge
      color={PRIORITY_COLOURS[priority]}
      variant="filled"
      autoContrast
      style={{ minWidth: 'max-content' }}
      data-priority={priority}
    >
      {t.tickets.priorities[priority] ?? priority}
    </Badge>
  );
}

/** The same colour as a small dot, for the Priority dropdown. */
export function PriorityDot({ priority }: { priority: string }) {
  return (
    <Box
      aria-hidden
      w={10}
      h={10}
      style={{
        borderRadius: '50%',
        flex: 'none',
        background: `var(--mantine-color-${PRIORITY_COLOURS[priority] ?? 'gray'}-filled)`,
      }}
    />
  );
}

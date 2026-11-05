import { ActionIcon, CopyButton, Group, Text, Tooltip } from '@mantine/core';
import { t } from '../i18n/en-GB';

/** A value with a copy-to-clipboard button (Q-P1-11). */
export function CopyValue({ value, display }: { value: string; display?: string }) {
  return (
    <Group gap={4} wrap="nowrap">
      <Text size="sm">{display ?? value}</Text>
      <CopyButton value={value} timeout={1500}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? t.crm.copied : t.crm.copy} withArrow>
            <ActionIcon size="xs" variant="subtle" onClick={copy} aria-label={`${t.crm.copy} ${display ?? value}`}>
              {copied ? '✓' : '⧉'}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}

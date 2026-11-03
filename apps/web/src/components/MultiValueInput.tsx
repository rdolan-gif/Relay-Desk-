import { ActionIcon, Button, CopyButton, Group, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { t } from '../i18n/en-GB';

interface Props {
  label: string;
  addLabel: string;
  values: string[];
  onChange: (values: string[]) => void;
  type?: 'email' | 'tel';
  /** Formats a stored value for display in the input. */
  format?: (v: string) => string;
  readOnly?: boolean;
  error?: string;
}

/** A list of emails or phone numbers, each with a copy button (Q-P1-11). */
export function MultiValueInput({ label, addLabel, values, onChange, type, format, readOnly, error }: Props) {
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        {label}
      </Text>
      {values.map((v, i) => (
        <Group key={i} gap={4} wrap="nowrap">
          <TextInput
            aria-label={`${label} ${i + 1}`}
            type={type}
            value={format ? format(v) : v}
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.currentTarget.value : x)))}
            disabled={readOnly}
            style={{ flex: 1 }}
          />
          <CopyButton value={format ? format(v) : v} timeout={1500}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? t.crm.copied : t.crm.copy} withArrow>
                <ActionIcon variant="subtle" onClick={copy} aria-label={`${t.crm.copy} ${v}`}>
                  {copied ? '✓' : '⧉'}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
          {!readOnly && (
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={`Remove ${v || label}`}
              onClick={() => onChange(values.filter((_, j) => j !== i))}
            >
              ✕
            </ActionIcon>
          )}
        </Group>
      ))}
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
      {!readOnly && (
        <Group>
          <Button size="compact-xs" variant="subtle" onClick={() => onChange([...values, ''])}>
            + {addLabel}
          </Button>
        </Group>
      )}
    </Stack>
  );
}

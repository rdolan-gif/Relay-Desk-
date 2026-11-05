import { Collapse, Group, Paper, Stack, Text, UnstyledButton } from '@mantine/core';
import { useState } from 'react';
import { isFieldVisible, type CustomFieldDef, type FieldValue, type FormLayout } from '@relay-desk/domain';
import type { CustomValues } from '../crm/types';
import { FieldInput } from './FieldInput';

interface Props {
  layout: FormLayout;
  fields: CustomFieldDef[];
  values: CustomValues;
  onChange?: (values: CustomValues) => void;
  readOnly?: boolean;
  errors?: Record<string, string>;
}

/**
 * Renders a custom form from a layout (spec 7.4): sections (optionally collapsed),
 * fields with tooltip, read-only, required and rows, and dynamic visibility.
 * Hidden placements are not rendered.
 */
export function DynamicForm({ layout, fields, values, onChange, readOnly, errors }: Props) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  return (
    <Stack>
      {layout.sections.map((section) => {
        const visible = section.fields.filter(
          (p) => byId.has(p.fieldId) && isFieldVisible(layout, p.fieldId, values as Record<string, FieldValue>),
        );
        if (visible.length === 0) return null;
        return (
          <Section
            key={section.id}
            title={section.title}
            description={section.description}
            collapsed={section.collapsed}
          >
            {visible.map((p) => (
              <FieldInput
                key={p.fieldId}
                def={byId.get(p.fieldId)!}
                placement={p}
                value={values[p.fieldId]}
                readOnly={readOnly}
                error={errors?.[p.fieldId]}
                onChange={(v) => onChange?.({ ...values, [p.fieldId]: v })}
              />
            ))}
          </Section>
        );
      })}
    </Stack>
  );
}

function Section(props: { title: string; description?: string; collapsed?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!props.collapsed);
  return (
    <Paper withBorder p="sm">
      <UnstyledButton onClick={() => setOpen((o) => !o)} aria-expanded={open} w="100%">
        <Group justify="space-between">
          <Text fw={600}>{props.title}</Text>
          <Text size="sm" c="dimmed" aria-hidden>
            {open ? '▾' : '▸'}
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse in={open}>
        <Stack mt="sm" gap="sm">
          {props.description && (
            <Text size="sm" c="dimmed">
              {props.description}
            </Text>
          )}
          {props.children}
        </Stack>
      </Collapse>
    </Paper>
  );
}

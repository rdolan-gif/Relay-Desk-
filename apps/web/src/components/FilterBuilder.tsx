import { ActionIcon, Button, Group, Select, Stack, TextInput } from '@mantine/core';
import { OPS_BY_KIND, type FilterCondition, type FilterFieldDef, type FilterOp } from '@relay-desk/domain';
import { t } from '../i18n/en-GB';

interface Props {
  fields: FilterFieldDef[];
  conditions: FilterCondition[];
  onChange: (c: FilterCondition[]) => void;
  /** Optional choices for ref/option fields, keyed by filter field key. */
  choices?: Record<string, { value: string; label: string }[]>;
}

const NO_VALUE: FilterOp[] = ['empty', 'not_empty'];

/** Condition rows: field, operator, value. All conditions must match. */
export function FilterBuilder({ fields, conditions, onChange, choices }: Props) {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const update = (i: number, patch: Partial<FilterCondition>) =>
    onChange(conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <Stack gap="xs">
      {conditions.map((c, i) => {
        const def = byKey.get(c.field);
        const ops = def ? OPS_BY_KIND[def.kind] : [];
        const fieldChoices = choices?.[c.field];
        return (
          <Group key={i} gap="xs" align="flex-end" wrap="wrap">
            <Select
              aria-label="Field"
              data={fields.map((f) => ({ value: f.key, label: f.label }))}
              value={c.field}
              onChange={(v) => v && update(i, { field: v, op: OPS_BY_KIND[byKey.get(v)!.kind][0]!, value: undefined })}
              searchable
              w={200}
            />
            <Select
              aria-label="Operator"
              data={ops.map((o) => ({ value: o, label: t.crm.ops[o] ?? o }))}
              value={c.op}
              onChange={(v) => v && update(i, { op: v as FilterOp })}
              w={150}
            />
            {!NO_VALUE.includes(c.op) &&
              (def?.kind === 'boolean' ? (
                <Select
                  aria-label="Value"
                  data={[
                    { value: 'true', label: 'Yes' },
                    { value: 'false', label: 'No' },
                  ]}
                  value={c.value === undefined ? null : String(c.value)}
                  onChange={(v) => update(i, { value: v ?? undefined })}
                  w={160}
                />
              ) : fieldChoices && c.op !== 'in_last_days' ? (
                <Select
                  aria-label="Value"
                  data={fieldChoices}
                  value={c.value ? String(c.value) : null}
                  onChange={(v) => update(i, { value: v ?? undefined })}
                  searchable
                  w={200}
                />
              ) : (
                <TextInput
                  aria-label="Value"
                  type={
                    (def?.kind === 'date' || def?.kind === 'datetime') && c.op !== 'in_last_days'
                      ? 'date'
                      : c.op === 'in_last_days'
                        ? 'number'
                        : 'text'
                  }
                  value={c.value === undefined ? '' : String(c.value)}
                  onChange={(e) => update(i, { value: e.currentTarget.value })}
                  w={200}
                />
              ))}
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label="Remove condition"
              onClick={() => onChange(conditions.filter((_, j) => j !== i))}
            >
              ✕
            </ActionIcon>
          </Group>
        );
      })}
      <Group>
        <Button
          variant="light"
          size="xs"
          onClick={() =>
            fields[0] && onChange([...conditions, { field: fields[0].key, op: OPS_BY_KIND[fields[0].kind][0]! }])
          }
        >
          {t.crm.addCondition}
        </Button>
      </Group>
    </Stack>
  );
}

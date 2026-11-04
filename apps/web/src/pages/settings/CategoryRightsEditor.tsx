import { ActionIcon, Checkbox, Group, NumberInput, Select, Stack, Switch, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { t } from '../../i18n/en-GB';
import type { Category } from '../../tickets/types';

type Value = 'all' | { categoryId: string; access: boolean; distribute: boolean; distributionLimit: number | null }[];

/** Category rights: Access yes/no and Distribution limit per category (spec 4, 9). */
export function CategoryRightsEditor({ value, onChange }: { value: Value; onChange: (v: Value) => void }) {
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('GET', '/settings/categories') });
  const title = (id: string) => cats.data?.find((c) => c.id === id)?.title ?? id;
  const rows = value === 'all' ? [] : value;
  const unused = (cats.data ?? []).filter((c) => !rows.some((r) => r.categoryId === c.id));
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        {t.ticketSettings.categoriesRights}
      </Text>
      <Checkbox
        label={t.ticketSettings.allCategories}
        checked={value === 'all'}
        onChange={(e) => onChange(e.currentTarget.checked ? 'all' : [])}
      />
      {value !== 'all' && (
        <>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t.tickets.category}</Table.Th>
                <Table.Th>{t.ticketSettings.access}</Table.Th>
                <Table.Th>{t.ticketSettings.distribute}</Table.Th>
                <Table.Th>{t.ticketSettings.distributionLimit}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r, i) => (
                <Table.Tr key={r.categoryId}>
                  <Table.Td>{title(r.categoryId)}</Table.Td>
                  <Table.Td>
                    <Switch
                      aria-label={`${t.ticketSettings.access}: ${title(r.categoryId)}`}
                      checked={r.access}
                      onChange={(e) =>
                        onChange(rows.map((x, j) => (j === i ? { ...x, access: e.currentTarget.checked } : x)))
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <Switch
                      aria-label={`${t.ticketSettings.distribute}: ${title(r.categoryId)}`}
                      checked={r.distribute}
                      onChange={(e) =>
                        onChange(rows.map((x, j) => (j === i ? { ...x, distribute: e.currentTarget.checked } : x)))
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput
                      disabled={!r.distribute}
                      aria-label={`${t.ticketSettings.distributionLimit}: ${title(r.categoryId)}`}
                      w={90}
                      min={1}
                      placeholder={t.ticketSettings.noLimit}
                      value={r.distributionLimit ?? ''}
                      onChange={(v) =>
                        onChange(
                          rows.map((x, j) => (j === i ? { ...x, distributionLimit: v === '' ? null : Number(v) } : x)),
                        )
                      }
                    />
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={`Remove ${title(r.categoryId)}`}
                      onClick={() => onChange(rows.filter((_, j) => j !== i))}
                    >
                      ✕
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {unused.length > 0 && (
            <Group>
              <Select
                placeholder="Add category"
                aria-label="Add category"
                data={unused.map((c) => ({ value: c.id, label: c.title }))}
                value={null}
                onChange={(id) =>
                  id &&
                  onChange([...rows, { categoryId: id, access: true, distribute: false, distributionLimit: null }])
                }
                w={240}
              />
            </Group>
          )}
        </>
      )}
    </Stack>
  );
}

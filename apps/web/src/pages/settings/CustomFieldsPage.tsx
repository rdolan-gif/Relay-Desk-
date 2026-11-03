import {
  ActionIcon,
  Alert,
  Button,
  Drawer,
  Group,
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  FIELD_TYPES,
  OPTION_FIELD_TYPES,
  type CustomFieldDef,
  type FieldOption,
  type FieldType,
} from '@relay-desk/domain';
import { ApiError, api } from '../../api';
import { useAuth } from '../../auth';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';

type Draft = Omit<CustomFieldDef, 'id'> & { id?: string };
const EMPTY: Draft = { key: '', name: '', type: 'text', options: [], defaultValue: null };

interface Usage {
  contacts: number;
  accounts: number;
  records: number;
  total: number;
  values: string[];
}

/** Settings > Custom fields: the shared field pool (spec 7.3). */
export function CustomFieldsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['custom-fields'],
    queryFn: () => api<CustomFieldDef[]>('GET', '/settings/custom-fields'),
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);

  const save = useMutation({
    mutationFn: ({ d, confirm }: { d: Draft; confirm?: boolean }) => {
      const body = {
        key: d.key,
        name: d.name,
        type: d.type,
        options: d.options,
        defaultValue: d.defaultValue,
        confirmOptionRemoval: confirm,
      };
      return d.id ? api('PUT', `/settings/custom-fields/${d.id}`, body) : api('POST', '/settings/custom-fields', body);
    },
    onSuccess: async () => {
      setDraft(null);
      setUsage(null);
      notifyOk();
      await qc.invalidateQueries({ queryKey: ['custom-fields'] });
      await qc.invalidateQueries({ queryKey: ['crm-meta'] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body.reason === 'options_in_use')
        setUsage((err.body as unknown as { usage: Usage }).usage);
      else notifyError(err);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/settings/custom-fields/${id}`),
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['custom-fields'] });
    },
    onError: notifyError,
  });

  const hasOptions = draft && OPTION_FIELD_TYPES.includes(draft.type);
  const setOption = (i: number, patch: Partial<FieldOption>) =>
    draft && setDraft({ ...draft, options: draft.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.fields.title}</Title>
        {can('settings_custom_fields', 'create') && <Button onClick={() => setDraft(EMPTY)}>{t.fields.add}</Button>}
      </Group>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t.fields.name}</Table.Th>
            <Table.Th>{t.fields.key}</Table.Th>
            <Table.Th>{t.fields.type}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {list.data?.map((f) => (
            <Table.Tr key={f.id} onClick={() => setDraft(f)} style={{ cursor: 'pointer' }}>
              <Table.Td>{f.name}</Table.Td>
              <Table.Td>
                <code>{f.key}</code>
              </Table.Td>
              <Table.Td>{t.fields.types[f.type]}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Drawer
        opened={!!draft}
        onClose={() => (setDraft(null), setUsage(null))}
        position="right"
        size="lg"
        title={draft?.id ? draft.name : t.fields.add}
      >
        {draft && (
          <Stack>
            <TextInput
              label={t.fields.name}
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
            />
            <TextInput
              label={t.fields.key}
              description={t.fields.keyHelp}
              required
              disabled={!!draft.id}
              value={draft.key}
              onChange={(e) =>
                setDraft({ ...draft, key: e.currentTarget.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })
              }
            />
            <Select
              label={t.fields.type}
              disabled={!!draft.id}
              data={FIELD_TYPES.map((ft) => ({ value: ft, label: t.fields.types[ft] ?? ft }))}
              value={draft.type}
              allowDeselect={false}
              onChange={(v) =>
                v &&
                setDraft({
                  ...draft,
                  type: v as FieldType,
                  options: OPTION_FIELD_TYPES.includes(v as FieldType) ? draft.options : [],
                })
              }
            />
            {hasOptions && (
              <Stack gap={4}>
                <Text fw={500} size="sm">
                  {t.fields.options}
                </Text>
                {draft.options.map((o, i) => (
                  <Group key={i} gap={4} wrap="nowrap">
                    <TextInput
                      aria-label={t.fields.label}
                      placeholder={t.fields.label}
                      value={o.label}
                      onChange={(e) => setOption(i, { label: e.currentTarget.value })}
                    />
                    <TextInput
                      aria-label={t.fields.value}
                      placeholder={t.fields.value}
                      value={o.value}
                      onChange={(e) => setOption(i, { value: e.currentTarget.value })}
                    />
                    <NumberInput
                      aria-label="Sort"
                      w={70}
                      value={o.sort}
                      onChange={(v) => setOption(i, { sort: Number(v) || 0 })}
                    />
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label="Remove option"
                      onClick={() => setDraft({ ...draft, options: draft.options.filter((_, j) => j !== i) })}
                    >
                      ✕
                    </ActionIcon>
                  </Group>
                ))}
                <Group>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        options: [...draft.options, { value: '', label: '', sort: draft.options.length + 1 }],
                      })
                    }
                  >
                    + {t.fields.addOption}
                  </Button>
                </Group>
              </Stack>
            )}
            {usage && (
              <Alert color="orange" title={t.fields.optionsInUse}>
                <Text size="sm">
                  {`Removing ${usage.values.join(', ')} affects ${usage.contacts} contact(s), ${usage.accounts} account(s) and ${usage.records} record(s). Their stored values will no longer show.`}
                </Text>
                <Button mt="sm" color="orange" size="xs" onClick={() => save.mutate({ d: draft, confirm: true })}>
                  {t.fields.confirmRemoval}
                </Button>
              </Alert>
            )}
            <Group justify="space-between">
              {draft.id && can('settings_custom_fields', 'delete') ? (
                <Button color="red" variant="light" onClick={() => remove.mutate(draft.id!)}>
                  {t.profiles.delete_}
                </Button>
              ) : (
                <span />
              )}
              <Group>
                <Button variant="default" onClick={() => setDraft(null)}>
                  {t.common.cancel}
                </Button>
                <Button loading={save.isPending} onClick={() => save.mutate({ d: draft })}>
                  {t.profiles.save}
                </Button>
              </Group>
            </Group>
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}

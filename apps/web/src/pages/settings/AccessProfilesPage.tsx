import { Button, Checkbox, Drawer, Group, Stack, Table, Text, TextInput, Textarea, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ACCESS_FLAGS,
  MODULES,
  VERBS,
  type AccessFlagMap,
  type ModuleAccess,
  type ModuleAccessMap,
} from '@relay-desk/domain';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { FLAG_LABELS, MODULE_LABELS, t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';
import type { AccessProfileDto } from '../../types';

type Draft = Omit<AccessProfileDto, 'id'> & { id?: string };
const EMPTY: Draft = { name: '', description: '', modules: {}, flags: {} };
const OFF: ModuleAccess = { enabled: false, create: false, read: false, update: false, delete: false };

export function AccessProfilesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['access-profiles'],
    queryFn: () => api<AccessProfileDto[]>('GET', '/settings/access-profiles'),
  });
  const [draft, setDraft] = useState<Draft | null>(null);

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = { name: d.name, description: d.description, modules: d.modules, flags: d.flags };
      return d.id
        ? api('PUT', `/settings/access-profiles/${d.id}`, body)
        : api('POST', '/settings/access-profiles', body);
    },
    onSuccess: async () => {
      setDraft(null);
      notifyOk();
      await qc.invalidateQueries({ queryKey: ['access-profiles'] });
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/settings/access-profiles/${id}`),
    onSuccess: async () => {
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['access-profiles'] });
    },
    onError: notifyError,
  });

  const setModule = (
    modules: ModuleAccessMap,
    key: (typeof MODULES)[number],
    patch: Partial<ModuleAccess>,
  ): ModuleAccessMap => ({
    ...modules,
    [key]: { ...(modules[key] ?? OFF), ...patch },
  });

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.profiles.accessTitle}</Title>
        {can('settings_access_profiles', 'create') && <Button onClick={() => setDraft(EMPTY)}>{t.profiles.add}</Button>}
      </Group>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t.profiles.name}</Table.Th>
            <Table.Th>{t.profiles.description}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {list.data?.map((p) => (
            <Table.Tr key={p.id} onClick={() => setDraft(p)} style={{ cursor: 'pointer' }}>
              <Table.Td>{p.name}</Table.Td>
              <Table.Td>{p.description}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Drawer
        opened={!!draft}
        onClose={() => setDraft(null)}
        position="right"
        size="xl"
        title={draft?.id ? draft.name : t.profiles.add}
      >
        {draft && (
          <Stack>
            <TextInput
              label={t.profiles.name}
              required
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.currentTarget.value })}
            />
            <Textarea
              label={t.profiles.description}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.currentTarget.value })}
            />
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t.profiles.module}</Table.Th>
                  <Table.Th>{t.profiles.enabled}</Table.Th>
                  {VERBS.map((v) => (
                    <Table.Th key={v}>{t.profiles[v]}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {MODULES.map((m) => {
                  const cur = draft.modules[m] ?? OFF;
                  const label = MODULE_LABELS[m] ?? m;
                  return (
                    <Table.Tr key={m}>
                      <Table.Td>{label}</Table.Td>
                      <Table.Td>
                        <Checkbox
                          aria-label={`${label}: ${t.profiles.enabled}`}
                          checked={cur.enabled}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              modules: setModule(draft.modules, m, { enabled: e.currentTarget.checked }),
                            })
                          }
                        />
                      </Table.Td>
                      {VERBS.map((v) => (
                        <Table.Td key={v}>
                          <Checkbox
                            aria-label={`${label}: ${t.profiles[v]}`}
                            disabled={!cur.enabled}
                            checked={cur[v]}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                modules: setModule(draft.modules, m, { [v]: e.currentTarget.checked }),
                              })
                            }
                          />
                        </Table.Td>
                      ))}
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
            <Text fw={600}>{t.profiles.flags}</Text>
            {ACCESS_FLAGS.map((f) => (
              <Checkbox
                key={f}
                label={FLAG_LABELS[f] ?? f}
                checked={!!draft.flags[f]}
                onChange={(e) =>
                  setDraft({ ...draft, flags: { ...draft.flags, [f]: e.currentTarget.checked } as AccessFlagMap })
                }
              />
            ))}
            <Group justify="space-between">
              {draft.id && can('settings_access_profiles', 'delete') ? (
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
                <Button loading={save.isPending} onClick={() => save.mutate(draft)}>
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

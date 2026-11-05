import { Button, Group, Modal, Radio, Select, Stack, Table, Text } from '@mantine/core';
import { useMutation, useQueries } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useCrmMeta } from '../crm/hooks';
import { t } from '../i18n/en-GB';
import { notifyError, notifyOk } from '../notify';

interface Rec {
  id: string;
  name: string;
  path?: string;
  emails: string[];
  phones: string[];
  accountId?: string | null;
  accountName?: string | null;
  branchCode?: string | null;
  addresses?: unknown[];
  customFields: Record<string, unknown>;
}

const show = (v: unknown) =>
  Array.isArray(v) ? v.join(', ') : v === null || v === undefined || v === '' ? '—' : String(v);

/**
 * Merge two or more contacts or accounts (spec 12.4): choose the one to keep and, for each
 * field that differs, whose value wins. Emails, phones and addresses can be combined.
 */
export function MergeModal(props: {
  entity: 'contacts' | 'accounts';
  ids: string[] | null;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const meta = useCrmMeta();
  const ids = props.ids ?? [];
  const recs = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['merge-rec', props.entity, id],
      queryFn: () => api<Rec>('GET', `/crm/${props.entity}/${id}`),
    })),
  });
  const all = recs.map((r) => r.data).filter((r): r is Rec => !!r);
  const [survivor, setSurvivor] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  useEffect(() => {
    setSurvivor(props.ids?.[0] ?? null);
    setChoices({});
  }, [props.ids]);
  const merge = useMutation({
    mutationFn: () => api<{ id: string }>('POST', `/crm/${props.entity}/merge`, { survivorId: survivor, ids, choices }),
    onSuccess: (r) => {
      notifyOk(t.merge.done);
      props.onDone(r.id);
    },
    onError: notifyError,
  });
  const label = (r: Rec) => r.path ?? r.name;
  const fields: { key: string; label: string; get: (r: Rec) => unknown; combinable?: boolean }[] = [
    { key: 'name', label: t.merge.name, get: (r) => r.name },
    { key: 'emails', label: t.merge.emails, get: (r) => r.emails, combinable: true },
    { key: 'phones', label: t.merge.phones, get: (r) => r.phones, combinable: true },
    ...(props.entity === 'contacts'
      ? [{ key: 'accountId', label: t.merge.account, get: (r: Rec) => r.accountName ?? r.accountId }]
      : [
          { key: 'branchCode', label: t.merge.branchCode, get: (r: Rec) => r.branchCode },
          {
            key: 'addresses',
            label: t.merge.addresses,
            get: (r: Rec) => `${r.addresses?.length ?? 0}`,
            combinable: true,
          },
        ]),
    ...(meta.data?.customFields ?? []).map((f) => ({
      key: `custom.${f.id}`,
      label: f.name,
      get: (r: Rec) => r.customFields[f.id],
    })),
  ];
  const differing = fields.filter((f) => new Set(all.map((r) => JSON.stringify(f.get(r) ?? null))).size > 1);

  return (
    <Modal opened={!!props.ids} onClose={props.onClose} title={t.merge.title} size="xl">
      {all.length === ids.length && survivor && (
        <Stack>
          <Radio.Group label={t.merge.keep} description={t.merge.keepHelp} value={survivor} onChange={setSurvivor}>
            <Stack gap={4} mt="xs">
              {all.map((r) => (
                <Radio key={r.id} value={r.id} label={`${label(r)} · ${show(r.emails)}`} />
              ))}
            </Stack>
          </Radio.Group>
          {differing.length > 0 && (
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t.merge.field}</Table.Th>
                  <Table.Th>{t.merge.value}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {differing.map((f) => (
                  <Table.Tr key={f.key}>
                    <Table.Td>{f.label}</Table.Td>
                    <Table.Td>
                      <Select
                        aria-label={f.label}
                        data={[
                          ...(f.combinable ? [{ value: 'all', label: t.merge.all }] : []),
                          ...all.map((r) => ({ value: r.id, label: `${show(f.get(r))} (${label(r)})` })),
                        ]}
                        value={choices[f.key] ?? (f.combinable ? 'all' : survivor)}
                        allowDeselect={false}
                        onChange={(v) => v && setChoices({ ...choices, [f.key]: v })}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          <Text size="xs" c="dimmed">
            {t.merge.keepHelp}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={props.onClose}>
              {t.common.cancel}
            </Button>
            <Button color="red" loading={merge.isPending} onClick={() => merge.mutate()}>
              {t.merge.run}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

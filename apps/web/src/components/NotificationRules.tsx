import { Alert, Button, Checkbox, Group, Paper, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n/en-GB';
import { notifyError, notifyOk } from '../notify';

interface Rule {
  categoryId: string;
  title: string;
  owner: boolean;
  followed: boolean;
  new: boolean;
  activity: boolean;
}
interface Rules {
  notificationEmail: string | null;
  defaultEmail: string;
  emailAvailable: boolean;
  categories: Rule[];
}
const COLS = ['owner', 'followed', 'new', 'activity'] as const;

/** My account › Email notifications: per category, per user (spec 13). */
export function NotificationRulesSection() {
  const qc = useQueryClient();
  const data = useQuery({
    queryKey: ['notification-rules'],
    queryFn: () => api<Rules>('GET', '/me/notification-rules'),
  });
  const [draft, setDraft] = useState<Rules | null>(null);
  useEffect(() => {
    if (data.data) setDraft(data.data);
  }, [data.data]);
  const save = useMutation({
    mutationFn: (d: Rules) =>
      api<Rules>('PUT', '/me/notification-rules', {
        notificationEmail: d.notificationEmail?.trim() || null,
        rules: d.categories,
      }),
    onSuccess: (r) => {
      qc.setQueryData(['notification-rules'], r);
      notifyOk();
    },
    onError: notifyError,
  });
  if (!draft) return null;
  const setRule = (i: number, k: (typeof COLS)[number], v: boolean) =>
    setDraft({ ...draft, categories: draft.categories.map((r, j) => (j === i ? { ...r, [k]: v } : r)) });
  return (
    <Paper withBorder p="md" component="section" aria-labelledby="notify-h">
      <Stack>
        <Title order={3} id="notify-h">
          {t.notifications.settings}
        </Title>
        <Text size="sm" c="dimmed">
          {t.notifications.settingsHelp}
        </Text>
        {!draft.emailAvailable && (
          <Alert color="amber" variant="light">
            <Text size="sm">{t.notifications.unavailable}</Text>
          </Alert>
        )}
        <TextInput
          label={t.notifications.address}
          description={t.notifications.addressHelp}
          type="email"
          placeholder={draft.defaultEmail}
          value={draft.notificationEmail ?? ''}
          onChange={(e) => setDraft({ ...draft, notificationEmail: e.currentTarget.value })}
        />
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              {COLS.map((c) => (
                <Table.Th key={c} title={t.notifications[`${c}Help`]}>
                  {t.notifications[c]}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {draft.categories.map((r, i) => (
              <Table.Tr key={r.categoryId}>
                <Table.Td>{r.title}</Table.Td>
                {COLS.map((c) => (
                  <Table.Td key={c}>
                    <Checkbox
                      aria-label={`${t.notifications[c]}: ${r.title}`}
                      checked={r[c]}
                      onChange={(e) => setRule(i, c, e.currentTarget.checked)}
                    />
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Stack gap={2}>
          {COLS.map((c) => (
            <Text key={c} size="xs" c="dimmed">
              <b>{t.notifications[c]}</b>: {t.notifications[`${c}Help`]}
            </Text>
          ))}
        </Stack>
        <Group justify="flex-end">
          <Button loading={save.isPending} onClick={() => save.mutate(draft)}>
            {t.profiles.save}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

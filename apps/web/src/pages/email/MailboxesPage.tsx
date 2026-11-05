import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Drawer,
  Group,
  MultiSelect,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { useCrmMeta, useUserDirectory } from '../../crm/hooks';
import type { EmailTemplate } from '../../email/types';
import { formatDateTime } from '../../format';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';
import { useTicketMeta } from '../../tickets/hooks';

interface Mailbox {
  id: string;
  title: string;
  address: string;
  senderName: string;
  provider: 'gmail' | 'fake';
  defaultCategoryId: string;
  defaultUserId: string | null;
  headerThreading: boolean;
  active: boolean;
  autoResponseEnabled: boolean;
  autoResponseNewOnly: boolean;
  sendsNotifications: boolean;
  autoResponseTemplateId: string | null;
  defaultBodyTemplateId: string | null;
  crmDatabaseIds: string[];
  connected: boolean;
  connectedAs: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}
type Draft = Omit<Mailbox, 'id' | 'connected' | 'connectedAs' | 'lastSyncAt' | 'lastError'> & { id?: string };
const EMPTY = (categoryId: string): Draft => ({
  title: '',
  address: '',
  senderName: '',
  provider: 'gmail',
  defaultCategoryId: categoryId,
  defaultUserId: null,
  headerThreading: true,
  active: true,
  autoResponseEnabled: false,
  autoResponseNewOnly: true,
  sendsNotifications: false,
  autoResponseTemplateId: null,
  defaultBodyTemplateId: null,
  crmDatabaseIds: [],
});

/** Settings > Mailboxes (spec 11.1): Gmail inboxes connected with Google sign-in (owner O-2). */
export function MailboxesPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const meta = useTicketMeta();
  const crm = useCrmMeta();
  const users = useUserDirectory();
  // Every category, not only the ones this person works in: a mailbox can feed a personal
  // inbox category the administrator doesn't see (falls back to their own categories).
  const allCategories = useQuery({
    queryKey: ['categories'],
    queryFn: () => api<{ id: string; title: string }[]>('GET', '/settings/categories'),
    retry: false,
  });
  const categoryList = allCategories.data ?? meta.data?.categories ?? [];
  const list = useQuery({
    queryKey: ['mailbox-settings'],
    queryFn: () =>
      api<{ mailboxes: Mailbox[]; googleConfigured: boolean; redirectUri: string }>('GET', '/settings/mailboxes'),
  });
  const templates = useQuery({ queryKey: ['templates-all'], queryFn: () => api<EmailTemplate[]>('GET', '/templates') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const log = useQuery({
    queryKey: ['mailbox-log', draft?.id],
    queryFn: () =>
      api<{ id: number; outcome: string; ticketId: number | null; createdAt: string; detail: string | null }[]>(
        'GET',
        `/settings/mailboxes/${draft!.id}/log`,
      ),
    enabled: !!draft?.id,
  });

  useEffect(() => {
    const connected = params.get('connected');
    const error = params.get('error');
    if (connected) notifyOk(t.mailboxes.connectedNotice(connected));
    if (error) notifyError(new Error(error));
    if (connected || error) setParams({}, { replace: true });
  }, []);

  const refresh = () => qc.invalidateQueries({ queryKey: ['mailbox-settings'] });
  const save = useMutation({
    mutationFn: (d: Draft) => {
      const { id, ...body } = d;
      return id ? api('PUT', `/settings/mailboxes/${id}`, body) : api('POST', '/settings/mailboxes', body);
    },
    onSuccess: async () => {
      setDraft(null);
      notifyOk();
      await refresh();
    },
    onError: notifyError,
  });
  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: notifyError,
  });
  const connect = async (id: string) => {
    try {
      const { url } = await api<{ url: string }>('POST', `/settings/mailboxes/${id}/connect`);
      window.location.href = url;
    } catch (err) {
      notifyError(err);
    }
  };
  const category = (id: string) => categoryList.find((c) => c.id === id)?.title ?? id;
  const autoTemplates = (templates.data ?? [])
    .filter((x) => x.kind === 'auto_response')
    .map((x) => ({ value: x.id, label: x.title }));
  const bodyTemplates = (templates.data ?? [])
    .filter((x) => x.kind === 'default_body')
    .map((x) => ({ value: x.id, label: x.title }));
  const editing = draft?.id ? list.data?.mailboxes.find((m) => m.id === draft.id) : undefined;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.mailboxes.title}</Title>
        {can('settings_mailbox_queues', 'create') && meta.data && (
          <Button onClick={() => setDraft(EMPTY(meta.data!.categories[0]?.id ?? ''))}>{t.mailboxes.add}</Button>
        )}
      </Group>
      {list.data && !list.data.googleConfigured && (
        <Alert color="amber">
          <Text size="sm">{t.mailboxes.googleMissing}</Text>
          <Code>{list.data.redirectUri}</Code>
        </Alert>
      )}
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t.mailboxes.name}</Table.Th>
            <Table.Th>{t.mailboxes.address}</Table.Th>
            <Table.Th>{t.mailboxes.defaultCategory}</Table.Th>
            <Table.Th>{t.mailboxes.status}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {list.data?.mailboxes.map((m) => (
            <Table.Tr key={m.id}>
              <Table.Td style={{ cursor: 'pointer' }} onClick={() => setDraft(m)}>
                {m.title}
              </Table.Td>
              <Table.Td>{m.address}</Table.Td>
              <Table.Td>{category(m.defaultCategoryId)}</Table.Td>
              <Table.Td>
                <Stack gap={2}>
                  {m.provider === 'fake' ? (
                    <Badge variant="light" color="gray">
                      {t.mailboxes.demo}
                    </Badge>
                  ) : m.connected ? (
                    <Badge variant="light" color="green">
                      {t.mailboxes.connected(m.connectedAs ?? '')}
                    </Badge>
                  ) : (
                    <Badge variant="light" color="amber">
                      {t.mailboxes.notConnected}
                    </Badge>
                  )}
                  {!m.active && (
                    <Badge variant="outline" color="gray">
                      {t.mailboxes.notReceiving}
                    </Badge>
                  )}
                  {m.lastSyncAt && (
                    <Text size="xs" c="dimmed">
                      {t.mailboxes.lastSync(formatDateTime(m.lastSyncAt, me!.user.timezone))}
                    </Text>
                  )}
                  {m.lastError && (
                    <Text size="xs" c="red">
                      {m.lastError}
                    </Text>
                  )}
                </Stack>
              </Table.Td>
              <Table.Td>
                <Group gap="xs" justify="flex-end">
                  {m.provider === 'gmail' && can('settings_mailbox_queues', 'update') && (
                    <Button size="xs" variant={m.connected ? 'default' : 'filled'} onClick={() => connect(m.id)}>
                      {m.connected ? t.mailboxes.reconnect : t.mailboxes.connect}
                    </Button>
                  )}
                  {(m.connected || m.provider === 'fake') && can('settings_mailbox_queues', 'update') && (
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => action.mutate(() => api('POST', `/settings/mailboxes/${m.id}/sync`))}
                    >
                      {t.mailboxes.syncNow}
                    </Button>
                  )}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Drawer
        opened={!!draft}
        onClose={() => setDraft(null)}
        position="right"
        size="lg"
        title={draft?.id ? draft.title : t.mailboxes.add}
      >
        {draft && (
          <Stack>
            <TextInput
              label={t.mailboxes.name}
              required
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
            />
            <TextInput
              label={t.mailboxes.address}
              type="email"
              required
              value={draft.address}
              onChange={(e) => setDraft({ ...draft, address: e.currentTarget.value })}
            />
            <TextInput
              label={t.mailboxes.senderName}
              value={draft.senderName}
              onChange={(e) => setDraft({ ...draft, senderName: e.currentTarget.value })}
            />
            <Select
              label={t.mailboxes.defaultCategory}
              data={categoryList.map((c) => ({ value: c.id, label: c.title }))}
              value={draft.defaultCategoryId}
              allowDeselect={false}
              searchable
              onChange={(v) => v && setDraft({ ...draft, defaultCategoryId: v })}
            />
            <Select
              label={t.mailboxes.defaultUser}
              description={t.mailboxes.defaultUserHelp}
              placeholder={t.mailboxes.noDefaultUser}
              data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
              value={draft.defaultUserId ?? null}
              clearable
              searchable
              onChange={(v) => setDraft({ ...draft, defaultUserId: v })}
            />
            <MultiSelect
              label={t.mailboxes.crmDatabases}
              data={(crm.data?.databases ?? []).map((d) => ({ value: d.id, label: d.title }))}
              value={draft.crmDatabaseIds}
              onChange={(crmDatabaseIds) => setDraft({ ...draft, crmDatabaseIds })}
            />
            <Checkbox
              label={t.mailboxes.active}
              checked={draft.active}
              onChange={(e) => setDraft({ ...draft, active: e.currentTarget.checked })}
            />
            <Checkbox
              label={t.mailboxes.headerThreading}
              checked={draft.headerThreading}
              onChange={(e) => setDraft({ ...draft, headerThreading: e.currentTarget.checked })}
            />
            <Checkbox
              label={t.mailboxes.sendsNotifications}
              description={t.mailboxes.sendsNotificationsHelp}
              checked={draft.sendsNotifications}
              onChange={(e) => setDraft({ ...draft, sendsNotifications: e.currentTarget.checked })}
            />
            <Checkbox
              label={t.mailboxes.autoResponse}
              checked={draft.autoResponseEnabled}
              onChange={(e) => setDraft({ ...draft, autoResponseEnabled: e.currentTarget.checked })}
            />
            {draft.autoResponseEnabled && (
              <>
                <Select
                  label={t.mailboxes.autoResponseTemplate}
                  data={autoTemplates}
                  value={draft.autoResponseTemplateId}
                  onChange={(v) => setDraft({ ...draft, autoResponseTemplateId: v })}
                />
                <Checkbox
                  label={t.mailboxes.autoResponseNewOnly}
                  checked={draft.autoResponseNewOnly}
                  onChange={(e) => setDraft({ ...draft, autoResponseNewOnly: e.currentTarget.checked })}
                />
              </>
            )}
            <Select
              label={t.mailboxes.defaultBodyTemplate}
              data={bodyTemplates}
              value={draft.defaultBodyTemplateId}
              clearable
              onChange={(v) => setDraft({ ...draft, defaultBodyTemplateId: v })}
            />
            {editing?.connected && (
              <Group>
                <Button
                  size="xs"
                  color="red"
                  variant="subtle"
                  onClick={() => action.mutate(() => api('POST', `/settings/mailboxes/${editing.id}/disconnect`))}
                >
                  {t.mailboxes.disconnect}
                </Button>
              </Group>
            )}
            {draft.id && (log.data?.length ?? 0) > 0 && (
              <Stack gap={4}>
                <Text size="sm" fw={600}>
                  {t.mailboxes.log}
                </Text>
                {log.data!.map((l) => (
                  <Text key={l.id} size="xs">
                    {formatDateTime(l.createdAt, me!.user.timezone)} · {t.mailboxes.outcomes[l.outcome] ?? l.outcome}
                    {l.ticketId ? ` #${l.ticketId}` : ''}
                    {l.detail ? ` · ${l.detail}` : ''}
                  </Text>
                ))}
              </Stack>
            )}
            <Group justify="space-between">
              {draft.id && can('settings_mailbox_queues', 'delete') ? (
                <Button
                  color="red"
                  variant="light"
                  onClick={() =>
                    action.mutate(async () => {
                      await api('DELETE', `/settings/mailboxes/${draft.id}`);
                      setDraft(null);
                    })
                  }
                >
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

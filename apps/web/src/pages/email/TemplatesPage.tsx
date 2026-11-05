import { Badge, Button, Drawer, Group, MultiSelect, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { RichTextEditor } from '../../components/RichTextEditor';
import type { EmailTemplate, MyMailbox } from '../../email/types';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';
import { useTicketMeta } from '../../tickets/hooks';

type Draft = Omit<EmailTemplate, 'id' | 'createdById' | 'authorName'> & { id?: string; createdById?: string | null };
const EMPTY: Draft = { kind: 'reply', title: '', subject: null, bodyHtml: '', queueIds: [], categoryIds: [] };

/** Templates and auto-responses written by the team (owner O-6). */
export function TemplatesPage() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const meta = useTicketMeta();
  const mailboxes = useQuery({ queryKey: ['my-mailboxes'], queryFn: () => api<MyMailbox[]>('GET', '/mailboxes') });
  const list = useQuery({ queryKey: ['templates-all'], queryFn: () => api<EmailTemplate[]>('GET', '/templates') });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const invalidate = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['templates-all'] }),
      qc.invalidateQueries({ queryKey: ['templates'] }),
    ]);
  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = {
        kind: d.kind,
        title: d.title,
        subject: d.subject,
        bodyHtml: d.bodyHtml,
        queueIds: d.queueIds,
        categoryIds: d.categoryIds,
      };
      return d.id ? api('PUT', `/templates/${d.id}`, body) : api('POST', '/templates', body);
    },
    onSuccess: async () => {
      setDraft(null);
      notifyOk();
      await invalidate();
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api('DELETE', `/templates/${id}`),
    onSuccess: async () => {
      setDraft(null);
      await invalidate();
    },
    onError: notifyError,
  });
  const canEdit = (d: Draft) => !d.id || d.createdById === me!.user.id || me!.user.type === 'administrator';
  const open = (d: Draft) => {
    setDraft(d);
    setEditorKey((k) => k + 1);
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{t.templates.title}</Title>
        {can('tickets', 'update') && <Button onClick={() => open(EMPTY)}>{t.templates.add}</Button>}
      </Group>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t.templates.name}</Table.Th>
            <Table.Th>{t.templates.kind}</Table.Th>
            <Table.Th>{t.templates.author}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {list.data?.map((tp) => (
            <Table.Tr key={tp.id} onClick={() => open(tp)} style={{ cursor: 'pointer' }}>
              <Table.Td>{tp.title}</Table.Td>
              <Table.Td>
                <Badge variant="light">{t.templates.kinds[tp.kind]}</Badge>
              </Table.Td>
              <Table.Td>{tp.authorName ?? t.crm.none}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Drawer
        opened={!!draft}
        onClose={() => setDraft(null)}
        position="right"
        size="xl"
        title={draft?.id ? draft.title : t.templates.add}
      >
        {draft && (
          <Stack>
            <Group grow>
              <TextInput
                label={t.templates.name}
                required
                value={draft.title}
                disabled={!canEdit(draft)}
                onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
              />
              <Select
                label={t.templates.kind}
                data={Object.entries(t.templates.kinds).map(([value, label]) => ({ value, label }))}
                value={draft.kind}
                disabled={!canEdit(draft)}
                allowDeselect={false}
                onChange={(v) => v && setDraft({ ...draft, kind: v as Draft['kind'] })}
              />
            </Group>
            <TextInput
              label={t.templates.subject}
              value={draft.subject ?? ''}
              disabled={!canEdit(draft)}
              onChange={(e) => setDraft({ ...draft, subject: e.currentTarget.value || null })}
            />
            <Text size="xs" c="dimmed">
              {t.templates.placeholders}
            </Text>
            <RichTextEditor
              key={editorKey}
              label={t.templates.body}
              value={draft.bodyHtml}
              onChange={(bodyHtml) => setDraft({ ...draft, bodyHtml })}
              minHeight={200}
            />
            <MultiSelect
              label={t.templates.mailboxes}
              data={(mailboxes.data ?? []).map((m) => ({ value: m.id, label: m.title }))}
              value={draft.queueIds}
              disabled={!canEdit(draft)}
              onChange={(queueIds) => setDraft({ ...draft, queueIds })}
            />
            <MultiSelect
              label={t.templates.categories}
              data={(meta.data?.categories ?? []).map((c) => ({ value: c.id, label: c.title }))}
              value={draft.categoryIds}
              disabled={!canEdit(draft)}
              searchable
              onChange={(categoryIds) => setDraft({ ...draft, categoryIds })}
            />
            {canEdit(draft) && (
              <Group justify="space-between">
                {draft.id ? (
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
            )}
          </Stack>
        )}
      </Drawer>
    </Stack>
  );
}

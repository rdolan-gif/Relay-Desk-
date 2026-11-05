import {
  ActionIcon,
  Badge,
  Button,
  FileButton,
  Group,
  Paper,
  Select,
  Stack,
  TagsInput,
  Text,
  TextInput,
} from '@mantine/core';
import { KbPanel } from '../kb/KbPanel';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { replyRecipients, replySubject, signatureHtml } from '@relay-desk/domain';
import { api, apiUpload } from '../api';
import { useAuth } from '../auth';
import { RichTextEditor } from '../components/RichTextEditor';
import { formatDateTime } from '../format';
import { t } from '../i18n/en-GB';
import { notifyError, notifyOk } from '../notify';
import type { Activity } from '../tickets/types';
import type { EmailTemplate, MyMailbox } from './types';

export type ComposeMode = 'reply' | 'reply_all' | 'forward' | 'new';

interface Props {
  mode: ComposeMode;
  ticket?: { id: number; title: string; categoryId: string } | null;
  source?: Activity | null;
  /** When the ticket form has unsaved changes, sending saves it first (spec 6.2). */
  formDirty?: boolean;
  saveForm?: () => Promise<unknown>;
  /** `close`: the person chose "Send and close ticket". */
  onSent: (r: { ticketId: number; status: string }, close: boolean) => void;
  /** Offer "Send and close ticket" (a ticket that isn't closed yet). */
  canClose?: boolean;
  onCancel: () => void;
  /** Pre-fill with this template (a macro's "Insert template", spec 10). */
  initialTemplateId?: string | null;
}

const fmtAddr = (a: { name?: string; address: string }) => (a.name ? `${a.name} <${a.address}>` : a.address);

/** Writes and sends an email from a ticket, or a new email (spec 11.4). */
export function EmailComposer({
  mode,
  ticket,
  source,
  formDirty,
  saveForm,
  onSent,
  canClose,
  onCancel,
  initialTemplateId,
}: Props) {
  const { me } = useAuth();
  const mailboxes = useQuery({ queryKey: ['my-mailboxes'], queryFn: () => api<MyMailbox[]>('GET', '/mailboxes') });
  const ours = (mailboxes.data ?? []).map((m) => m.address);
  const initial = useMemo(() => {
    const e = source?.email;
    let to: string[] = [];
    let cc: string[] = [];
    if (e && (mode === 'reply' || mode === 'reply_all')) {
      const r = replyRecipients({
        kind: mode,
        from: source!.direction === 'out' ? e.to : [e.from],
        replyTo: source!.direction === 'out' ? [] : e.replyTo,
        to: e.to,
        cc: e.cc,
        ourAddresses: ours,
      });
      to = r.to;
      cc = r.cc;
    }
    const subject = ticket
      ? replySubject(
          mode === 'forward' ? 'forward' : mode === 'new' ? 'new' : 'reply',
          e?.subject ?? ticket.title,
          ticket.id,
        )
      : '';
    const sig = signatureHtml(me!.user.signature);
    const quote =
      source && mode !== 'new'
        ? mode === 'forward'
          ? `<p>${t.email.forwarded}<br>${t.email.from}: ${escape(fmtAddr(e!.from))}<br>${t.email.subject}: ${escape(e!.subject)}</p>${source.bodyHtml}`
          : `<p>${escape(t.email.onWrote(formatDateTime(source.createdAt, me!.user.timezone), e ? fmtAddr(e.from) : ''))}</p><blockquote>${source.bodyHtml}</blockquote>`
        : '';
    return { to, cc, subject, body: `<p></p>${sig}${quote}` };
  }, [mode, source, ticket, me, ours.join()]);

  const [from, setFrom] = useState<string | null>(source?.email?.queueId ?? null);
  const [to, setTo] = useState<string[]>(initial.to);
  const [cc, setCc] = useState<string[]>(initial.cc);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState(initial.cc.length > 0);
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [editorKey, setEditorKey] = useState(0);
  const [files, setFiles] = useState<{ id: string; filename: string; size: number }[]>(
    mode === 'forward'
      ? (source?.attachments ?? []).map((a) => ({ id: a.id, filename: a.filename, size: a.size }))
      : [],
  );

  const queueId = from && mailboxes.data?.some((m) => m.id === from) ? from : (mailboxes.data?.[0]?.id ?? null);
  const templates = useQuery({
    queryKey: ['templates', 'reply', queueId, ticket?.categoryId],
    queryFn: () =>
      api<EmailTemplate[]>(
        'GET',
        `/templates?kind=reply${queueId ? `&queueId=${queueId}` : ''}${ticket ? `&categoryId=${ticket.categoryId}` : ''}`,
      ),
  });

  const insertTemplate = async (id: string | null) => {
    if (!id) return;
    try {
      const r = await api<{ subject: string | null; bodyHtml: string }>('POST', `/templates/${id}/render`, {
        ticketId: ticket?.id ?? null,
      });
      setBody(`${r.bodyHtml}${body}`);
      setEditorKey((k) => k + 1);
      if (r.subject && !subject.trim()) setSubject(r.subject);
    } catch (err) {
      notifyError(err);
    }
  };

  useEffect(() => {
    if (initialTemplateId) void insertTemplate(initialTemplateId);
  }, [initialTemplateId]);

  const send = useMutation({
    mutationFn: async (_close: boolean) => {
      if (formDirty && saveForm) await saveForm();
      return api<{ ticketId: number; status: string; error: string | null }>('POST', '/emails', {
        queueId,
        ticketId: ticket?.id ?? null,
        kind: mode,
        replyToActivityId: source?.id ?? null,
        to,
        cc,
        bcc,
        subject,
        bodyHtml: body,
        attachmentIds: files.map((f) => f.id),
      });
    },
    onSuccess: (r, close) => {
      if (r.status === 'failed') notifyError(new Error(t.email.failedBecause(r.error ?? '')));
      else if (!close) notifyOk(t.email.sent);
      onSent(r, close);
    },
    onError: notifyError,
  });

  if (mailboxes.data && mailboxes.data.length === 0) {
    return (
      <Paper withBorder p="sm">
        <Text size="sm">{t.email.noMailbox}</Text>
      </Paper>
    );
  }

  return (
    <Paper withBorder p="sm" style={{ borderTop: '3px solid var(--mantine-primary-color-filled)' }}>
      <Stack gap="xs">
        <Group grow align="flex-end">
          <Select
            label={t.email.from}
            data={(mailboxes.data ?? []).map((m) => ({
              value: m.id,
              label: `${m.senderName || m.title} <${m.address}>`,
            }))}
            value={queueId}
            allowDeselect={false}
            onChange={setFrom}
          />
          <Select
            label={t.email.insertTemplate}
            placeholder={t.email.insertTemplate}
            data={(templates.data ?? []).map((tp) => ({ value: tp.id, label: tp.title }))}
            value={null}
            onChange={insertTemplate}
            searchable
          />
        </Group>
        <Group gap="xs">
          <KbPanel
            onInsert={(html) => {
              setBody(`${html}${body}`);
              setEditorKey((k) => k + 1);
            }}
          />
        </Group>
        <TagsInput label={t.email.to} value={to} onChange={setTo} splitChars={[',', ' ', ';']} clearable />
        {showCc ? (
          <Group grow>
            <TagsInput label={t.email.cc} value={cc} onChange={setCc} splitChars={[',', ' ', ';']} />
            <TagsInput label={t.email.bcc} value={bcc} onChange={setBcc} splitChars={[',', ' ', ';']} />
          </Group>
        ) : (
          <Group>
            <Button size="compact-xs" variant="subtle" onClick={() => setShowCc(true)}>
              {t.email.cc} / {t.email.bcc}
            </Button>
          </Group>
        )}
        <TextInput
          label={t.email.subject}
          value={subject}
          onChange={(e) => setSubject(e.currentTarget.value)}
          required
        />
        <RichTextEditor key={editorKey} label={t.email.body} value={body} onChange={setBody} minHeight={160} />
        <Group gap="xs">
          {files.map((f) => (
            <Badge
              key={f.id}
              variant="light"
              rightSection={
                <ActionIcon
                  size="xs"
                  variant="transparent"
                  aria-label={`Remove ${f.filename}`}
                  onClick={() => setFiles(files.filter((x) => x.id !== f.id))}
                >
                  ✕
                </ActionIcon>
              }
            >
              {f.filename} ({Math.ceil(f.size / 1024)} KB)
            </Badge>
          ))}
        </Group>
        <Group justify="space-between">
          <FileButton
            onChange={async (file) => {
              if (!file) return;
              try {
                const up = await apiUpload<{ id: string; filename: string; size: number }>('/attachments', file);
                setFiles((fs) => [...fs, up]);
              } catch (err) {
                notifyError(err);
              }
            }}
          >
            {(props) => (
              <Button {...props} size="xs" variant="default">
                {t.email.attach}
              </Button>
            )}
          </FileButton>
          <Group>
            <Button variant="default" onClick={onCancel}>
              {t.email.discard}
            </Button>
            <Button
              variant={canClose ? 'default' : 'filled'}
              loading={send.isPending && !send.variables}
              disabled={!queueId || !to.length || !subject.trim()}
              onClick={() => send.mutate(false)}
            >
              {formDirty ? t.email.saveAndSend : t.email.send}
            </Button>
            {canClose && (
              <Button
                loading={send.isPending && !!send.variables}
                disabled={!queueId || !to.length || !subject.trim()}
                onClick={() => send.mutate(true)}
              >
                {t.email.sendAndClose}
              </Button>
            )}
          </Group>
        </Group>
      </Stack>
    </Paper>
  );
}

function escape(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
}

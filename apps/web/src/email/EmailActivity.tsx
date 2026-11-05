import { Anchor, Badge, Button, Group, Paper, Stack, Text } from '@mantine/core';
import { useEffect, useRef, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth } from '../auth';
import { formatDateTime } from '../format';
import { t } from '../i18n/en-GB';
import type { Activity, MailAddress } from '../tickets/types';
import type { ComposeMode } from './EmailComposer';

const addr = (a: MailAddress) => (a.name ? `${a.name} <${a.address}>` : a.address);

/**
 * One email in the ticket feed. The (already sanitised) HTML is shown in a sandboxed
 * frame with scripts disabled, so email styles can't leak into the app.
 */
export function EmailActivity({
  a,
  onCompose,
  actions,
}: {
  a: Activity;
  onCompose: (mode: ComposeMode, source: Activity) => void;
  actions?: React.ReactNode;
}) {
  const { me, can } = useAuth();
  const e = a.email!;
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);
  const [expanded, setExpanded] = useState(false);
  const recipients = e.to.length + e.cc.length;
  const automated = e.classification.startsWith('automated');

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const fit = () => setHeight(Math.min(el.contentDocument?.body?.scrollHeight ?? 120, 4000) + 16);
    el.addEventListener('load', fit);
    return () => el.removeEventListener('load', fit);
  }, [a.bodyHtml]);

  const srcDoc = `<!doctype html><html><head><base target="_blank"><style>body{font:14px/1.5 system-ui,sans-serif;margin:0;color:#16201f;word-wrap:break-word}img{max-width:100%;height:auto}blockquote{border-left:3px solid #ccd;margin:0 0 0 4px;padding-left:10px;color:#555}</style></head><body>${a.bodyHtml}</body></html>`;

  return (
    <Paper
      withBorder
      p="sm"
      id={`activity-${a.id}`}
      style={{
        borderLeft: `4px solid ${a.direction === 'in' ? 'var(--mantine-color-amber-6)' : 'var(--mantine-primary-color-filled)'}`,
      }}
    >
      <Stack gap={4}>
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Group gap="xs">
              <Badge size="xs" variant="light" color={a.direction === 'in' ? 'amber' : 'ricoman'}>
                {a.direction === 'in' ? t.email.incoming : t.email.outgoing}
              </Badge>
              <Text size="sm" fw={600}>
                {a.direction === 'in' ? addr(e.from) : (a.userName ?? e.from.name ?? e.from.address)}
              </Text>
              <Text size="xs" c="dimmed">
                {formatDateTime(a.createdAt, me!.user.timezone)}
              </Text>
              {a.direction === 'out' && (
                <Badge
                  size="xs"
                  color={a.status === 'failed' ? 'red' : a.status === 'sent' ? 'green' : 'gray'}
                  variant="light"
                >
                  {t.email.statuses[a.status] ?? a.status}
                </Badge>
              )}
              {a.isAutomatic && (
                <Badge size="xs" variant="outline">
                  {t.email.automatic}
                </Badge>
              )}
              {automated && (
                <Badge size="xs" variant="outline" color="gray">
                  {t.email.automated}
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed" truncate>
              {t.email.to}: {e.to.map(addr).join(', ')}
              {e.cc.length ? ` · ${t.email.cc}: ${e.cc.map(addr).join(', ')}` : ''}
            </Text>
            <Text size="sm" fw={500}>
              {e.subject}
            </Text>
          </Stack>
          {actions}
        </Group>
        {a.status === 'failed' && a.error && (
          <Text size="xs" c="red">
            {t.email.failedBecause(a.error)}
          </Text>
        )}
        <div style={{ maxHeight: expanded ? undefined : 400, overflow: 'hidden', position: 'relative' }}>
          <iframe
            ref={frame}
            title={e.subject || 'Email'}
            sandbox="allow-same-origin allow-popups"
            srcDoc={srcDoc}
            style={{ width: '100%', height, border: 0, background: 'white' }}
          />
        </div>
        {height > 400 && (
          <Group>
            <Button size="compact-xs" variant="subtle" onClick={() => setExpanded(!expanded)}>
              {expanded ? t.email.hide : t.email.show}
            </Button>
          </Group>
        )}
        {a.attachments.filter((f) => !f.inline).length > 0 && (
          <Group gap="xs">
            {a.attachments
              .filter((f) => !f.inline)
              .map((f) => (
                <Anchor key={f.id} href={`/api/attachments/${f.id}`} size="sm">
                  📎 {f.filename} ({Math.ceil(f.size / 1024)} KB)
                </Anchor>
              ))}
          </Group>
        )}
        <Group gap="xs">
          <Button size="compact-xs" variant="light" onClick={() => onCompose('reply', a)}>
            {t.email.reply}
          </Button>
          {recipients > 1 && (
            <Button size="compact-xs" variant="light" onClick={() => onCompose('reply_all', a)}>
              {t.email.replyAll}
            </Button>
          )}
          <Button size="compact-xs" variant="light" onClick={() => onCompose('forward', a)}>
            {t.email.forward}
          </Button>
          {can('knowledge_base', 'create') && (
            <Button
              size="compact-xs"
              variant="subtle"
              component={RouterLink}
              to={`/kb/articles/new?fromActivity=${a.id}`}
            >
              {t.kb.createArticle}
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}

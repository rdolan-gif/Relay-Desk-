import { Button, Group, Popover, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { t } from '../i18n/en-GB';
import { notifyError } from '../notify';
import type { KbArticle, KbArticleSummary } from './types';

/** Article images live inside Relay Desk, so they are left out of emails to customers. */
function withoutImages(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('img').forEach((i) => i.remove());
  return doc.body.innerHTML;
}

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** KB panel in the reply editor (spec 15): search articles, insert their text or a link. */
export function KbPanel({ onInsert }: { onInsert: (html: string) => void }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debounced] = useDebouncedValue(q, 300);
  const results = useQuery({
    queryKey: ['kb-panel', debounced],
    queryFn: () =>
      api<KbArticleSummary[]>(
        'GET',
        `/kb/articles?limit=20${debounced.trim().length >= 2 ? `&q=${encodeURIComponent(debounced)}` : ''}`,
      ),
    enabled: open,
  });
  if (!can('knowledge_base', 'read')) return null;
  const insertText = async (id: string) => {
    try {
      const a = await api<KbArticle>('GET', `/kb/articles/${id}`);
      onInsert(withoutImages(a.bodyHtml));
      setOpen(false);
    } catch (err) {
      notifyError(err);
    }
  };
  const insertLink = (a: KbArticleSummary) => {
    onInsert(`<p><a href="${window.location.origin}/kb/articles/${a.id}">${escape(a.title)}</a></p>`);
    setOpen(false);
  };
  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" width={420} shadow="md" withArrow>
      <Popover.Target>
        <Button variant="default" size="xs" onClick={() => setOpen((o) => !o)}>
          {t.kb.panel}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            {t.kb.panelHelp}
          </Text>
          <TextInput
            placeholder={t.kb.search}
            aria-label={t.kb.search}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
            data-autofocus
          />
          <ScrollArea.Autosize mah={300}>
            <Stack gap={6}>
              {results.data?.length === 0 && (
                <Text size="sm" c="dimmed">
                  {t.kb.noArticles}
                </Text>
              )}
              {results.data?.map((a) => (
                <Stack
                  key={a.id}
                  gap={2}
                  p={6}
                  style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 6 }}
                >
                  <Text size="sm" fw={600}>
                    {a.title}
                  </Text>
                  <Text size="xs" c="dimmed" lineClamp={2}>
                    {a.snippet}
                  </Text>
                  <Group gap="xs">
                    <Button
                      size="compact-xs"
                      variant="light"
                      onClick={() => insertText(a.id)}
                      aria-label={`${t.kb.insertText}: ${a.title}`}
                    >
                      {t.kb.insertText}
                    </Button>
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      onClick={() => insertLink(a)}
                      aria-label={`${t.kb.insertLink}: ${a.title}`}
                    >
                      {t.kb.insertLink}
                    </Button>
                  </Group>
                </Stack>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

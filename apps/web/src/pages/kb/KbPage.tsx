import {
  ActionIcon,
  Badge,
  Button,
  Grid,
  Group,
  Menu,
  NavLink,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { qs } from '../../crm/hooks';
import { formatDateTime } from '../../format';
import { t } from '../../i18n/en-GB';
import type { KbArticleSummary, KbFolder } from '../../kb/types';
import { notifyError } from '../../notify';

/** Knowledge base (spec 15): folder tree, search, tags, articles. */
export function KbPage() {
  const { me, can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const folderId = params.get('folder');
  const tag = params.get('tag');
  const [q, setQ] = useState('');
  const [debounced] = useDebouncedValue(q, 300);
  const folders = useQuery({ queryKey: ['kb-folders'], queryFn: () => api<KbFolder[]>('GET', '/kb/folders') });
  const tags = useQuery({ queryKey: ['kb-tags'], queryFn: () => api<{ tag: string; n: number }[]>('GET', '/kb/tags') });
  const articles = useQuery({
    queryKey: ['kb-articles', folderId, tag, debounced],
    queryFn: () =>
      api<KbArticleSummary[]>(
        'GET',
        `/kb/articles${qs({ folderId: folderId ?? undefined, tag: tag ?? undefined, q: debounced.trim().length >= 2 ? debounced : undefined })}`,
      ),
    placeholderData: (p) => p,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['kb-folders'] });
  const folderAction = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: notifyError,
  });
  const all = folders.data ?? [];
  const current = all.find((f) => f.id === folderId);
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  const ask = (label: string, initial = '') => window.prompt(label, initial)?.trim();
  const canTop = me?.user.type === 'administrator';

  const Tree = ({ parentId, depth }: { parentId: string | null; depth: number }) => (
    <>
      {all
        .filter((f) => f.parentId === parentId)
        .map((f) => (
          <div key={f.id}>
            <NavLink
              label={f.title}
              pl={8 + depth * 14}
              active={f.id === folderId}
              onClick={() => set('folder', f.id)}
              rightSection={
                f.articles ? (
                  <Badge size="xs" variant="light" color="gray">
                    {f.articles}
                  </Badge>
                ) : undefined
              }
            />
            {all.some((c) => c.parentId === f.id) && <Tree parentId={f.id} depth={depth + 1} />}
          </div>
        ))}
    </>
  );

  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 3 }}>
        <Stack gap="xs">
          <Group justify="space-between">
            <Text fw={600}>{t.kb.folders}</Text>
            {canTop && can('knowledge_base', 'create') && (
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => {
                  const title = ask(t.kb.folderName);
                  if (title) folderAction.mutate(() => api('POST', '/kb/folders', { title, parentId: null }));
                }}
              >
                {t.kb.newFolder}
              </Button>
            )}
          </Group>
          <NavLink label={t.kb.all} active={!folderId} onClick={() => set('folder', null)} />
          <Tree parentId={null} depth={0} />
          {(tags.data?.length ?? 0) > 0 && (
            <>
              <Text fw={600} mt="md">
                {t.kb.tags}
              </Text>
              <Group gap={6}>
                {tags.data!.map((x) => (
                  <UnstyledButton
                    key={x.tag}
                    onClick={() => set('tag', tag === x.tag ? null : x.tag)}
                    aria-pressed={tag === x.tag}
                  >
                    <Badge variant={tag === x.tag ? 'filled' : 'light'}>{x.tag}</Badge>
                  </UnstyledButton>
                ))}
              </Group>
            </>
          )}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 9 }}>
        <Stack>
          <Group justify="space-between">
            <Title order={2}>{current?.title ?? t.kb.title}</Title>
            <Group>
              {current && (current.rights.create || current.rights.update || current.rights.delete) && (
                <Menu>
                  <Menu.Target>
                    <ActionIcon variant="default" size="lg" aria-label={t.kb.folders}>
                      ⋯
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    {current.rights.create && can('knowledge_base', 'create') && (
                      <Menu.Item
                        onClick={() => {
                          const title = ask(t.kb.folderName);
                          if (title)
                            folderAction.mutate(() => api('POST', '/kb/folders', { title, parentId: current.id }));
                        }}
                      >
                        {t.kb.newSubfolder}
                      </Menu.Item>
                    )}
                    {current.rights.update && can('knowledge_base', 'update') && (
                      <Menu.Item
                        onClick={() => {
                          const title = ask(t.kb.folderName, current.title);
                          if (title)
                            folderAction.mutate(() =>
                              api('PUT', `/kb/folders/${current.id}`, {
                                title,
                                parentId: current.parentId,
                                position: current.position,
                              }),
                            );
                        }}
                      >
                        {t.kb.renameFolder}
                      </Menu.Item>
                    )}
                    {current.rights.delete && can('knowledge_base', 'delete') && (
                      <Menu.Item
                        color="red"
                        onClick={() =>
                          window.confirm(t.crm.confirmDelete) &&
                          folderAction.mutate(async () => {
                            await api('DELETE', `/kb/folders/${current.id}`);
                            set('folder', null);
                          })
                        }
                      >
                        {t.kb.deleteFolder}
                      </Menu.Item>
                    )}
                  </Menu.Dropdown>
                </Menu>
              )}
              {can('knowledge_base', 'create') && all.some((f) => f.rights.create) && (
                <Button onClick={() => nav(`/kb/articles/new${folderId ? `?folderId=${folderId}` : ''}`)}>
                  {t.kb.newArticle}
                </Button>
              )}
            </Group>
          </Group>
          <TextInput
            placeholder={t.kb.search}
            aria-label={t.kb.search}
            value={q}
            onChange={(e) => setQ(e.currentTarget.value)}
          />
          {articles.data?.length === 0 && <Text c="dimmed">{t.kb.noArticles}</Text>}
          {articles.data?.map((a) => (
            <UnstyledButton
              key={a.id}
              onClick={() => nav(`/kb/articles/${a.id}`)}
              style={{ display: 'block', width: '100%' }}
            >
              <Paper withBorder p="sm">
                <Group justify="space-between" wrap="nowrap">
                  <Text fw={600}>{a.title}</Text>
                  <Text size="xs" c="dimmed">
                    {formatDateTime(a.updatedAt, me!.user.timezone)}
                  </Text>
                </Group>
                <Text size="sm" c="dimmed" lineClamp={2}>
                  {a.snippet}
                </Text>
                {a.tags.length > 0 && (
                  <Group gap={4} mt={4}>
                    {a.tags.map((x) => (
                      <Badge key={x} size="xs" variant="light">
                        {x}
                      </Badge>
                    ))}
                  </Group>
                )}
              </Paper>
            </UnstyledButton>
          ))}
        </Stack>
      </Grid.Col>
    </Grid>
  );
}

import {
  Alert,
  Anchor,
  Badge,
  Button,
  Drawer,
  FileButton,
  Group,
  Paper,
  Select,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Title,
  TypographyStylesProvider,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, apiUpload, downloadFile } from '../../api';
import { useAuth } from '../../auth';
import { RichTextEditor } from '../../components/RichTextEditor';
import { formatDateTime } from '../../format';
import { t } from '../../i18n/en-GB';
import { folderPaths, type KbArticle, type KbFolder } from '../../kb/types';
import { notifyError, notifyOk } from '../../notify';

interface Draft {
  folderId: string;
  title: string;
  bodyHtml: string;
  tags: string[];
  sourceActivityId?: string | null;
}

/** One article: read, edit, files and version history (spec 15). */
export function KbArticlePage() {
  const { id, mode } = useParams();
  const isNew = id === 'new';
  const editing = isNew || mode === 'edit';
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me, can } = useAuth();
  const folders = useQuery({ queryKey: ['kb-folders'], queryFn: () => api<KbFolder[]>('GET', '/kb/folders') });
  const article = useQuery({
    queryKey: ['kb-article', id],
    queryFn: () => api<KbArticle>('GET', `/kb/articles/${id}`),
    enabled: !isNew,
  });
  const versions = useQuery({
    queryKey: ['kb-versions', id],
    queryFn: () =>
      api<{ version: number; title: string; bodyHtml: string; createdAt: string; editedByName: string | null }[]>(
        'GET',
        `/kb/articles/${id}/versions`,
      ),
    enabled: !isNew,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [showVersions, setShowVersions] = useState(false);

  // One effect owns the draft: a new route (article or mode) starts afresh.
  const route = useRef('');
  useEffect(() => {
    const key = `${id}/${mode ?? ''}`;
    const changed = route.current !== key;
    route.current = key;
    if (!editing) {
      if (changed) setDraft(null);
      return;
    }
    if (draft && !changed) return;
    if (isNew) {
      const from = params.get('fromActivity');
      const folderId = params.get('folderId') ?? folders.data?.find((f) => f.rights.create)?.id ?? '';
      if (from)
        api<{ title: string; bodyHtml: string; sourceActivityId: string }>('GET', `/kb/drafts/from-activity/${from}`)
          .then((d) => (setDraft({ folderId, ...d, tags: [] }), setEditorKey((k) => k + 1)))
          .catch(notifyError);
      else if (folders.data) setDraft({ folderId, title: '', bodyHtml: '', tags: [] });
      else setDraft(null);
    } else if (article.data) {
      const a = article.data;
      setDraft({ folderId: a.folderId, title: a.title, bodyHtml: a.bodyHtml, tags: a.tags });
      setEditorKey((k) => k + 1);
    } else setDraft(null);
  }, [editing, isNew, article.data, folders.data, id, mode]);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['kb-article', id] });
    await qc.invalidateQueries({ queryKey: ['kb-versions', id] });
    await qc.invalidateQueries({ queryKey: ['kb-articles'] });
    await qc.invalidateQueries({ queryKey: ['kb-folders'] });
  };
  const save = useMutation({
    mutationFn: (d: Draft) =>
      isNew ? api<{ id: string }>('POST', '/kb/articles', d) : api<{ id: string }>('PUT', `/kb/articles/${id}`, d),
    onSuccess: async (r) => {
      notifyOk();
      await refresh();
      nav(`/kb/articles/${r.id}`, { replace: true });
    },
    onError: notifyError,
  });
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: notifyError,
  });
  const paths = folderPaths(folders.data ?? []);

  if (editing) {
    if (!draft) return <Text>{t.common.loading}</Text>;
    const addImage = (file: File | null) =>
      file &&
      act.mutate(async () => {
        const up = await apiUpload<{ url: string }>(`/kb/articles/${id}/files`, file);
        setDraft((d) =>
          d ? { ...d, bodyHtml: `${d.bodyHtml}<p><img src="${up.url}" alt="${file.name.replace(/"/g, '')}"></p>` } : d,
        );
        setEditorKey((k) => k + 1);
      });
    return (
      <Stack maw={900}>
        <Title order={2}>{isNew ? t.kb.newArticle : t.kb.edit}</Title>
        <TextInput
          label={t.kb.titleLabel}
          required
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.currentTarget.value })}
        />
        <Group grow>
          <Select
            label={t.kb.folder}
            data={(folders.data ?? [])
              .filter((f) => f.rights.create || f.id === draft.folderId)
              .map((f) => ({ value: f.id, label: paths.get(f.id) ?? f.title }))}
            value={draft.folderId || null}
            allowDeselect={false}
            onChange={(v) => v && setDraft({ ...draft, folderId: v })}
          />
          <TagsInput
            label={t.kb.tags}
            value={draft.tags}
            onChange={(tags) => setDraft({ ...draft, tags })}
            splitChars={[',', ' ']}
          />
        </Group>
        <RichTextEditor
          key={editorKey}
          label={t.kb.body}
          value={draft.bodyHtml}
          onChange={(bodyHtml) => setDraft({ ...draft, bodyHtml })}
          minHeight={300}
          images
        />
        {isNew ? (
          <Text size="xs" c="dimmed">
            {t.kb.saveFirst}
          </Text>
        ) : (
          <Group>
            <FileButton onChange={addImage} accept="image/png,image/jpeg,image/gif,image/webp">
              {(props) => (
                <Button size="xs" variant="light" {...props}>
                  {t.kb.addImage}
                </Button>
              )}
            </FileButton>
          </Group>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => nav(isNew ? '/kb' : `/kb/articles/${id}`)}>
            {t.common.cancel}
          </Button>
          <Button
            loading={save.isPending}
            disabled={!draft.title.trim() || !draft.folderId}
            onClick={() => save.mutate(draft)}
          >
            {t.kb.save}
          </Button>
        </Group>
      </Stack>
    );
  }

  const a = article.data;
  if (!a) return <Text>{t.common.loading}</Text>;
  const canEdit = a.rights.update && can('knowledge_base', 'update');
  return (
    <Stack maw={900}>
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Anchor size="sm" onClick={() => nav(`/kb?folder=${a.folderId}`)}>
            {paths.get(a.folderId)}
          </Anchor>
          <Title order={2}>{a.title}</Title>
          <Text size="xs" c="dimmed">
            {t.kb.version(a.version)} ·{' '}
            {t.kb.updated(formatDateTime(a.updatedAt, me!.user.timezone), a.updatedByName ?? '')}
          </Text>
          {a.tags.length > 0 && (
            <Group gap={4}>
              {a.tags.map((x) => (
                <Badge key={x} size="sm" variant="light">
                  {x}
                </Badge>
              ))}
            </Group>
          )}
        </Stack>
        <Group>
          <Button variant="default" onClick={() => setShowVersions(true)}>
            {t.kb.versions}
          </Button>
          {canEdit && <Button onClick={() => nav(`/kb/articles/${a.id}/edit`)}>{t.kb.edit}</Button>}
          {a.rights.delete && can('knowledge_base', 'delete') && (
            <Button
              color="red"
              variant="subtle"
              onClick={() =>
                window.confirm(t.crm.confirmDelete) &&
                act.mutate(async () => {
                  await api('DELETE', `/kb/articles/${a.id}`);
                  nav('/kb');
                })
              }
            >
              {t.kb.delete}
            </Button>
          )}
        </Group>
      </Group>
      <Paper withBorder p="md">
        <TypographyStylesProvider>
          {/* Sanitised by the API (allow-list; images only from the article's own files). */}
          <div dangerouslySetInnerHTML={{ __html: a.bodyHtml }} />
        </TypographyStylesProvider>
      </Paper>
      <Paper withBorder p="md">
        <Group justify="space-between" mb="xs">
          <Text fw={600}>{t.kb.files}</Text>
          {canEdit && (
            <FileButton onChange={(f) => f && act.mutate(() => apiUpload(`/kb/articles/${a.id}/files`, f))}>
              {(props) => (
                <Button size="xs" variant="light" {...props}>
                  {t.kb.addFile}
                </Button>
              )}
            </FileButton>
          )}
        </Group>
        {a.files.length === 0 && (
          <Text size="sm" c="dimmed">
            {t.crm.none}
          </Text>
        )}
        {a.files.map((f) => (
          <Group key={f.id} justify="space-between">
            <Anchor size="sm" onClick={() => downloadFile(`/kb/files/${f.id}`, f.filename).catch(notifyError)}>
              {f.filename}
            </Anchor>
            {canEdit && (
              <Button
                size="compact-xs"
                variant="subtle"
                color="red"
                onClick={() => act.mutate(() => api('DELETE', `/kb/files/${f.id}`))}
              >
                {t.profiles.delete_}
              </Button>
            )}
          </Group>
        ))}
      </Paper>
      <Drawer
        opened={showVersions}
        onClose={() => setShowVersions(false)}
        position="right"
        size="lg"
        title={t.kb.versions}
      >
        <Stack>
          {versions.data?.map((v) => (
            <Paper key={v.version} withBorder p="sm">
              <Group justify="space-between">
                <Text fw={600}>{t.kb.version(v.version)}</Text>
                <Text size="xs" c="dimmed">
                  {formatDateTime(v.createdAt, me!.user.timezone)} {v.editedByName ? `· ${v.editedByName}` : ''}
                </Text>
              </Group>
              <Text size="sm">{v.title}</Text>
              {v.version !== a.version && canEdit && (
                <Button
                  size="xs"
                  variant="light"
                  mt="xs"
                  onClick={() =>
                    act.mutate(async () => {
                      await api('POST', `/kb/articles/${a.id}/versions/${v.version}/restore`);
                      notifyOk(t.kb.restored);
                      setShowVersions(false);
                    })
                  }
                >
                  {t.kb.restore}
                </Button>
              )}
            </Paper>
          ))}
          {!canEdit && <Alert color="gray">{t.kb.versions}</Alert>}
        </Stack>
      </Drawer>
    </Stack>
  );
}

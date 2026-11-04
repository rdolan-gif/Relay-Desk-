import {
  Alert,
  Button,
  FileInput,
  Group,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { guessMapping, IMPORT_FIELDS, validateMapping, type ImportEntity } from '@relay-desk/domain';
import { api, apiUpload } from '../../api';
import { JobModal } from '../../components/JobModal';
import { useCrmMeta } from '../../crm/hooks';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';

interface Preview {
  fileId: string;
  filename: string;
  headers: string[];
  rows: string[][];
  total: number;
}
interface Template {
  id: string;
  name: string;
  mapping: Record<string, string>;
}

/**
 * Import contacts or accounts (spec 12.4): upload CSV/XLSX, map columns to fields (or load a
 * saved mapping), choose the database and what to do with duplicates, preview, then run as
 * a background job with a downloadable error report.
 */
export function ImportPage() {
  const entity = (useParams().entity === 'accounts' ? 'accounts' : 'contacts') as ImportEntity;
  const nav = useNavigate();
  const qc = useQueryClient();
  const meta = useCrmMeta();
  const templates = useQuery({
    queryKey: ['import-templates', entity],
    queryFn: () => api<Template[]>('GET', `/imports/templates?entity=${entity}`),
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [databaseId, setDatabaseId] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState('skip');
  const [matchOn, setMatchOn] = useState('email');
  const [templateName, setTemplateName] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const custom = meta.data?.customFields ?? [];
  const entityLabel = entity === 'contacts' ? t.crm.contacts.toLowerCase() : t.crm.accounts.toLowerCase();

  const upload = useMutation({
    mutationFn: (file: File) => apiUpload<Preview>('/imports/upload', file),
    onSuccess: (p) => {
      setPreview(p);
      setMapping(guessMapping(entity, p.headers, custom));
      setDatabaseId(
        (d) => d ?? meta.data?.databases.find((x) => x.isDefault)?.id ?? meta.data?.databases[0]?.id ?? null,
      );
    },
    onError: notifyError,
  });
  const run = useMutation({
    mutationFn: () =>
      api<{ id: string }>('POST', '/imports', {
        fileId: preview!.fileId,
        entity,
        databaseId,
        mapping,
        duplicate,
        matchOn,
      }),
    onSuccess: (j) => setJobId(j.id),
    onError: notifyError,
  });
  const save = useMutation({
    mutationFn: () => api('POST', '/imports/templates', { entity, name: templateName, mapping }),
    onSuccess: async () => {
      setTemplateName('');
      notifyOk();
      await qc.invalidateQueries({ queryKey: ['import-templates', entity] });
    },
    onError: notifyError,
  });

  const targets = [
    { value: '', label: t.importer.ignore },
    ...IMPORT_FIELDS[entity].map((f) => ({ value: f, label: t.importer.fields[f] ?? f })),
    ...custom.map((f) => ({ value: `custom:${f.key}`, label: f.name })),
  ];
  const problems = preview ? validateMapping(entity, mapping) : [];

  return (
    <Stack maw={1000}>
      <Title order={2}>{t.importer.title(entityLabel)}</Title>
      <Paper withBorder p="md">
        <FileInput
          label={t.importer.file}
          description={t.importer.fileHelp}
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(f) => f && upload.mutate(f)}
          disabled={upload.isPending}
        />
      </Paper>
      {preview && (
        <>
          <Paper withBorder p="md">
            <Stack>
              <Group grow align="flex-end">
                <Select
                  label={t.importer.database}
                  data={(meta.data?.databases ?? []).map((d) => ({ value: d.id, label: d.title }))}
                  value={databaseId}
                  allowDeselect={false}
                  onChange={setDatabaseId}
                />
                <Select
                  label={t.importer.template}
                  data={(templates.data ?? []).map((x) => ({ value: x.id, label: x.name }))}
                  value={null}
                  placeholder="—"
                  onChange={(id) => {
                    const tpl = templates.data?.find((x) => x.id === id);
                    if (tpl) setMapping(Object.fromEntries(preview.headers.map((h) => [h, tpl.mapping[h] ?? ''])));
                  }}
                />
              </Group>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t.importer.column}</Table.Th>
                    <Table.Th>{t.importer.example}</Table.Th>
                    <Table.Th>{t.importer.field}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {preview.headers.map((h, i) => (
                    <Table.Tr key={h}>
                      <Table.Td>{h}</Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed" lineClamp={1}>
                          {preview.rows[0]?.[i] ?? ''}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Select
                          aria-label={`${t.importer.field}: ${h}`}
                          data={targets}
                          value={mapping[h] ?? ''}
                          allowDeselect={false}
                          onChange={(v) => setMapping({ ...mapping, [h]: v ?? '' })}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              <Group align="flex-end">
                <TextInput
                  label={t.importer.templateName}
                  value={templateName}
                  onChange={(e) => setTemplateName(e.currentTarget.value)}
                />
                <Button
                  variant="default"
                  disabled={!templateName.trim()}
                  loading={save.isPending}
                  onClick={() => save.mutate()}
                >
                  {t.importer.saveTemplate}
                </Button>
              </Group>
              <Group grow>
                <Select
                  label={t.importer.duplicates}
                  data={Object.entries(t.importer.duplicateModes).map(([value, label]) => ({ value, label }))}
                  value={duplicate}
                  allowDeselect={false}
                  onChange={(v) => v && setDuplicate(v)}
                />
                <Select
                  label={t.importer.matchOn}
                  data={Object.entries(t.importer.matchModes).map(([value, label]) => ({ value, label }))}
                  value={matchOn}
                  allowDeselect={false}
                  onChange={(v) => v && setMatchOn(v)}
                />
              </Group>
            </Stack>
          </Paper>
          <Paper withBorder p="md">
            <Text size="sm" fw={600} mb="xs">
              {t.importer.preview(preview.rows.length, preview.total)}
            </Text>
            <ScrollArea>
              <Table striped withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    {preview.headers.map((h) => (
                      <Table.Th key={h}>{h}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {preview.rows.map((r, i) => (
                    <Table.Tr key={i}>
                      {preview.headers.map((h, j) => (
                        <Table.Td key={h}>{r[j] ?? ''}</Table.Td>
                      ))}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea>
          </Paper>
          {problems.length > 0 && <Alert color="amber">{problems.join(' ')}</Alert>}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => nav(`/crm/${entity}`)}>
              {t.common.cancel}
            </Button>
            <Button disabled={problems.length > 0 || !databaseId} loading={run.isPending} onClick={() => run.mutate()}>
              {t.importer.run}
            </Button>
          </Group>
        </>
      )}
      <JobModal
        jobId={jobId}
        onClose={() => {
          setJobId(null);
          void qc.invalidateQueries({ queryKey: [`/crm/${entity}`] });
          nav(`/crm/${entity}`);
        }}
      />
    </Stack>
  );
}

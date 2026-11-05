import { ActionIcon, Checkbox, Group, Select, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { t } from '../../i18n/en-GB';
import { folderPaths, type KbFolder } from '../../kb/types';

type Grant = { folderId: string; view: boolean; create: boolean; update: boolean; delete: boolean };
type Value = 'all' | Grant[];
const VERBS = ['view', 'create', 'update', 'delete'] as const;
const LABEL = { view: t.kb.view, create: t.kb.create, update: t.kb.update, delete: t.kb.remove };

/** Knowledge-base folder rights (spec 15): a grant also covers the folder's subfolders. */
export function KbRightsEditor({ value, onChange }: { value: Value; onChange: (v: Value) => void }) {
  const folders = useQuery({ queryKey: ['kb-folders'], queryFn: () => api<KbFolder[]>('GET', '/kb/folders') });
  const paths = folderPaths(folders.data ?? []);
  const rows = value === 'all' ? [] : value;
  const unused = (folders.data ?? []).filter((f) => !rows.some((r) => r.folderId === f.id));
  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        {t.kb.rights}
      </Text>
      <Checkbox
        label={t.kb.rightsAll}
        checked={value === 'all'}
        onChange={(e) => onChange(e.currentTarget.checked ? 'all' : [])}
      />
      {value !== 'all' && (
        <>
          <Table>
            <Table.Tbody>
              {rows.map((r, i) => (
                <Table.Tr key={r.folderId}>
                  <Table.Td>{paths.get(r.folderId) ?? r.folderId}</Table.Td>
                  {VERBS.map((v) => (
                    <Table.Td key={v}>
                      <Checkbox
                        label={LABEL[v]}
                        checked={r[v]}
                        onChange={(e) =>
                          onChange(rows.map((x, j) => (j === i ? { ...x, [v]: e.currentTarget.checked } : x)))
                        }
                      />
                    </Table.Td>
                  ))}
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      aria-label={`Remove ${paths.get(r.folderId)}`}
                      onClick={() => onChange(rows.filter((_, j) => j !== i))}
                    >
                      ✕
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {unused.length > 0 && (
            <Group>
              <Select
                placeholder={t.kb.addFolderRight}
                aria-label={t.kb.addFolderRight}
                data={unused.map((f) => ({ value: f.id, label: paths.get(f.id) ?? f.title }))}
                value={null}
                onChange={(id) =>
                  id && onChange([...rows, { folderId: id, view: true, create: false, update: false, delete: false }])
                }
                w={280}
              />
            </Group>
          )}
        </>
      )}
    </Stack>
  );
}

import {
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  Pagination,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import type { FilterCondition, FilterFieldDef } from '@relay-desk/domain';
import { api } from '../api';
import { qs } from '../crm/hooks';
import type { FilterScheme, ListName, Page } from '../crm/types';
import { t } from '../i18n/en-GB';
import { notifyError, notifyOk } from '../notify';
import { FilterBuilder } from './FilterBuilder';

export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  sortKey?: string;
}

interface Props<T extends { id: string | number }> {
  list: ListName;
  title: ReactNode;
  /** Extra query parameters, e.g. the selected ticket view. */
  extraParams?: Record<string, string | undefined>;
  /** Bulk actions for selected rows; enables row checkboxes. */
  bulkActions?: (ids: T['id'][], clear: () => void) => ReactNode;
  endpoint: string;
  columns: Column<T>[];
  defaultColumns: string[];
  filterFields: FilterFieldDef[];
  filterChoices?: Record<string, { value: string; label: string }[]>;
  onOpen: (row: T) => void;
  actions?: ReactNode;
}

const PAGE_SIZE = 50;

/**
 * Shared list screen (spec 6.1, 12.2, 14): search, filter conditions, saved filter
 * schemes, user-chosen columns (persisted per user), sorting and pagination.
 */
export function EntityList<T extends { id: string | number }>(props: Props<T>) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 300);
  const [draft, setDraft] = useState<FilterCondition[]>([]);
  const [applied, setApplied] = useState<FilterCondition[]>([]);
  const [showFilter, setShowFilter] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [schemeName, setSchemeName] = useState('');
  const [selected, setSelected] = useState<T['id'][]>([]);

  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [debounced, applied, JSON.stringify(props.extraParams)]);

  const data = useQuery({
    queryKey: [props.endpoint, debounced, applied, page, sort, props.extraParams],
    queryFn: () =>
      api<Page<T>>(
        'GET',
        `${props.endpoint}${qs({
          ...props.extraParams,
          q: debounced.length >= 2 ? debounced : undefined,
          filter: applied.length ? JSON.stringify(applied) : undefined,
          page,
          pageSize: PAGE_SIZE,
          sort: sort?.key,
          dir: sort?.dir,
        })}`,
      ),
    placeholderData: (prev) => prev,
  });

  const schemes = useQuery({
    queryKey: ['schemes', props.list],
    queryFn: () => api<FilterScheme[]>('GET', `/me/lists/${props.list}/filter-schemes`),
  });
  const columnsPref = useQuery({
    queryKey: ['columns', props.list],
    queryFn: () => api<{ columns: string[] | null }>('GET', `/me/lists/${props.list}/columns`),
  });
  const visibleKeys = columnsPref.data?.columns ?? props.defaultColumns;
  const visibleColumns = visibleKeys.map((k) => props.columns.find((c) => c.key === k)).filter(Boolean) as Column<T>[];

  const saveColumns = useMutation({
    mutationFn: (columns: string[]) => api('PUT', `/me/lists/${props.list}/columns`, { columns }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['columns', props.list] }),
    onError: notifyError,
  });
  const saveScheme = useMutation({
    mutationFn: () =>
      api<FilterScheme>('POST', '/me/lists/filter-schemes', {
        list: props.list,
        name: schemeName,
        conditions: applied,
      }),
    onSuccess: async () => {
      setSaveOpen(false);
      setSchemeName('');
      notifyOk();
      await qc.invalidateQueries({ queryKey: ['schemes', props.list] });
    },
    onError: notifyError,
  });

  const toggleColumn = (key: string, on: boolean) => {
    const next = on
      ? props.columns.map((c) => c.key).filter((k) => k === key || visibleKeys.includes(k))
      : visibleKeys.filter((k) => k !== key);
    if (next.length) saveColumns.mutate(next);
  };

  const clickSort = (c: Column<T>) => {
    const key = c.sortKey;
    if (!key) return;
    setSort((s) => (s && s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>{props.title}</Title>
        {props.actions}
      </Group>
      <Group wrap="wrap">
        <TextInput
          placeholder={t.crm.search}
          aria-label={t.crm.search}
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
          w={260}
        />
        <Button variant={applied.length ? 'filled' : 'default'} onClick={() => setShowFilter((s) => !s)}>
          {t.crm.filter}
          {applied.length ? ` (${applied.length})` : ''}
        </Button>
        <Select
          placeholder={t.crm.savedFilters}
          aria-label={t.crm.savedFilters}
          data={(schemes.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          value={null}
          onChange={(id) => {
            const s = schemes.data?.find((x) => x.id === id);
            if (s) {
              setDraft(s.conditions);
              setApplied(s.conditions);
            }
          }}
          w={200}
        />
        <Menu closeOnItemClick={false}>
          <Menu.Target>
            <Button variant="default">{t.crm.columns}</Button>
          </Menu.Target>
          <Menu.Dropdown>
            {props.columns.map((c) => (
              <Menu.Item key={c.key}>
                <Checkbox
                  label={c.label}
                  checked={visibleKeys.includes(c.key)}
                  onChange={(e) => toggleColumn(c.key, e.currentTarget.checked)}
                />
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </Group>
      {showFilter && (
        <Paper withBorder p="sm">
          <Stack>
            <FilterBuilder
              // Reference fields are only offered where there is a list to pick from.
              fields={props.filterFields.filter((f) => f.kind !== 'ref' || props.filterChoices?.[f.key])}
              conditions={draft}
              onChange={setDraft}
              choices={props.filterChoices}
            />
            <Group>
              <Button size="xs" onClick={() => setApplied(draft)}>
                {t.crm.apply}
              </Button>
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  setDraft([]);
                  setApplied([]);
                }}
              >
                {t.crm.clear}
              </Button>
              <Button size="xs" variant="subtle" disabled={!applied.length} onClick={() => setSaveOpen(true)}>
                {t.crm.saveFilterAs}
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
      {props.bulkActions && selected.length > 0 && (
        <Group>
          <Text size="sm">{`${selected.length} selected`}</Text>
          {props.bulkActions(selected, () => setSelected([]))}
        </Group>
      )}
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            {props.bulkActions && (
              <Table.Th w={36}>
                <Checkbox
                  aria-label="Select all on this page"
                  checked={!!data.data?.items.length && data.data.items.every((r) => selected.includes(r.id))}
                  onChange={(e) =>
                    setSelected(e.currentTarget.checked ? (data.data?.items.map((r) => r.id) ?? []) : [])
                  }
                />
              </Table.Th>
            )}
            {visibleColumns.map((c) => (
              <Table.Th
                key={c.key}
                onClick={() => clickSort(c)}
                style={{ cursor: c.sortKey ? 'pointer' : undefined }}
                aria-sort={
                  c.sortKey && sort?.key === c.sortKey ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined
                }
              >
                {c.label}
                {c.sortKey && sort?.key === c.sortKey ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.data?.items.map((row) => (
            <Table.Tr
              key={row.id}
              onClick={() => props.onOpen(row)}
              style={{ cursor: 'pointer' }}
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && props.onOpen(row)}
            >
              {props.bulkActions && (
                <Table.Td onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    aria-label={`Select ${row.id}`}
                    checked={selected.includes(row.id)}
                    onChange={(e) => {
                      const on = e.currentTarget.checked;
                      setSelected((s) => (on ? [...s, row.id] : s.filter((x) => x !== row.id)));
                    }}
                  />
                </Table.Td>
              )}
              {visibleColumns.map((c) => (
                <Table.Td key={c.key}>{c.render(row)}</Table.Td>
              ))}
            </Table.Tr>
          ))}
          {data.data && data.data.items.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={visibleColumns.length + (props.bulkActions ? 1 : 0)}>
                <Text c="dimmed">{t.crm.noResults}</Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
      {data.data && data.data.total > PAGE_SIZE && (
        <Pagination total={Math.ceil(data.data.total / PAGE_SIZE)} value={page} onChange={setPage} />
      )}
      <Modal opened={saveOpen} onClose={() => setSaveOpen(false)} title={t.crm.saveFilterAs}>
        <Stack>
          <TextInput
            label={t.crm.filterName}
            value={schemeName}
            onChange={(e) => setSchemeName(e.currentTarget.value)}
            data-autofocus
          />
          <Group justify="flex-end">
            <Button disabled={!schemeName.trim()} loading={saveScheme.isPending} onClick={() => saveScheme.mutate()}>
              {t.crm.save}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

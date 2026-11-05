import {
  ActionIcon,
  Badge,
  Button,
  Grid,
  Group,
  Modal,
  NavLink,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core';
import { MyViewsList } from '../../components/MyViewsList';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { FilterCondition } from '@relay-desk/domain';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { EntityList, type Column } from '../../components/EntityList';
import { JobModal } from '../../components/JobModal';
import { SlaIcon } from '../../components/SlaIcon';
import { FilterBuilder } from '../../components/FilterBuilder';
import { useCrmMeta, useUserDirectory } from '../../crm/hooks';
import { formatDateTime } from '../../format';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';
import { PRIORITY_COLOURS, STATE_COLOURS, useTicketMeta } from '../../tickets/hooks';
import type { Sidebar, Ticket } from '../../tickets/types';
import { rememberTicketList } from '../../tickets/lastList';

/** Tickets module (spec 6.1): view sidebar, filterable list, bulk actions. */
export function TicketsPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { me, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  useEffect(() => rememberTicketList(location.search), [location.search]);
  const viewId = params.get('view') ?? undefined;
  const meta = useTicketMeta();
  const crm = useCrmMeta();
  const users = useUserDirectory();
  const sidebar = useQuery({ queryKey: ['ticket-sidebar'], queryFn: () => api<Sidebar>('GET', '/tickets/views') });
  const [newView, setNewView] = useState<{ name: string; conditions: FilterCondition[] } | null>(null);
  const [bulk, setBulk] = useState<{ ids: number[]; clear: () => void } | null>(null);
  const [bulkChanges, setBulkChanges] = useState<{ state?: string; priority?: string; userId?: string | null }>({});

  const saveSidebar = useMutation({
    mutationFn: (items: Sidebar['items']) => api<Sidebar>('PUT', '/tickets/views/sidebar', { items }),
    onSuccess: (data) => qc.setQueryData(['ticket-sidebar'], data),
    onError: notifyError,
  });
  const createView = useMutation({
    mutationFn: (v: { name: string; conditions: FilterCondition[] }) => api('POST', '/tickets/views', v),
    onSuccess: async () => {
      setNewView(null);
      await qc.invalidateQueries({ queryKey: ['ticket-sidebar'] });
    },
    onError: notifyError,
  });
  const bulkEdit = useMutation({
    mutationFn: () =>
      api<{ updated?: number[]; failed?: { id: number }[]; job?: { id: string } }>('POST', '/tickets/bulk-edit', {
        ticketIds: bulk!.ids,
        changes: bulkChanges,
      }),
    onSuccess: async (r) => {
      if (r.job) setJobId(r.job.id);
      else notifyOk(t.tickets.bulkResult(r.updated!.length, r.failed!.length));
      bulk?.clear();
      setBulk(null);
      setBulkChanges({});
      await qc.invalidateQueries({ queryKey: ['/tickets'] });
    },
    onError: notifyError,
  });
  const [jobId, setJobId] = useState<string | null>(null);
  const bulkDelete = useMutation({
    mutationFn: (v: { ids: number[]; clear: () => void }) =>
      api<{ deleted?: number[]; failed?: unknown[]; job?: { id: string } }>('POST', '/tickets/bulk-delete', {
        ids: v.ids,
      }),
    onSuccess: async (r, v) => {
      if (r.job) setJobId(r.job.id);
      else
        notifyOk(
          `${t.data.deleted(r.deleted!.length)}${r.failed!.length ? ` ${t.data.failed(r.failed!.length)}` : ''}`,
        );
      v.clear();
      await qc.invalidateQueries({ queryKey: ['/tickets'] });
    },
    onError: notifyError,
  });
  const bulkMerge = useMutation({
    mutationFn: (ids: number[]) =>
      api<{ id: number }>('POST', '/tickets/merge', { ticketIds: ids, survivorId: Math.min(...ids) }),
    onSuccess: (r) => nav(`/tickets/${r.id}`),
    onError: notifyError,
  });

  if (!meta.data || !sidebar.data) return <Text>{t.common.loading}</Text>;
  const sb = sidebar.data;
  const viewsById = new Map([...sb.teamViews, ...sb.myViews].map((v) => [v.id, v]));
  const items = [...sb.items].sort((a, b) => a.position - b.position);
  const pinned = new Set(items.map((i) => i.viewId));
  const statusTitle = (id: string) => meta.data!.statuses.find((s) => s.id === id)?.title ?? '';
  const tz = me!.user.timezone;
  const columns: Column<Ticket>[] = [
    { key: 'id', label: t.tickets.id, render: (r) => `#${r.id}`, sortKey: 'id' },
    {
      key: 'title',
      label: t.tickets.titleField,
      render: (r) =>
        r.unread ? (
          <Group gap={6} wrap="nowrap">
            <span className="rd-unread-dot" aria-hidden />
            <VisuallyHidden>{t.tickets.unread}: </VisuallyHidden>
            {r.title}
          </Group>
        ) : (
          r.title
        ),
      sortKey: 'title',
    },
    { key: 'contactName', label: t.tickets.contact, render: (r) => r.contactName ?? t.crm.none },
    { key: 'categoryTitle', label: t.tickets.category, render: (r) => r.categoryTitle },
    {
      key: 'state',
      label: t.tickets.state,
      render: (r) => (
        <Badge color={STATE_COLOURS[r.state]} variant="light" style={{ minWidth: 'max-content' }}>
          {t.tickets.states[r.state]}
        </Badge>
      ),
    },
    { key: 'statusIds', label: t.tickets.status, render: (r) => r.statusIds.map(statusTitle).join(', ') || t.crm.none },
    {
      key: 'priority',
      label: t.tickets.priority,
      sortKey: 'priority',
      render: (r) => (
        <Badge color={PRIORITY_COLOURS[r.priority]} variant="dot" style={{ minWidth: 'max-content' }}>
          {t.tickets.priorities[r.priority]}
        </Badge>
      ),
    },
    { key: 'userName', label: t.tickets.user, render: (r) => r.userName ?? t.crm.none },
    {
      key: 'deadline',
      label: t.tickets.deadline,
      render: (r) => <SlaIcon sla={r.sla} deadline={r.deadline} closedAt={r.closedAt} />,
      sortKey: 'deadline',
    },
    {
      key: 'lastActivityAt',
      label: t.tickets.lastActivity,
      render: (r) => formatDateTime(r.lastActivityAt, tz),
      sortKey: 'lastActivityAt',
    },
    {
      key: 'createdAt',
      label: t.tickets.created,
      render: (r) => formatDateTime(r.createdAt, tz),
      sortKey: 'createdAt',
    },
  ];
  const choices: Record<string, { value: string; label: string }[]> = {
    state: Object.entries(t.tickets.states).map(([value, label]) => ({ value, label })),
    priority: Object.entries(t.tickets.priorities).map(([value, label]) => ({ value, label })),
    statusIds: meta.data.statuses.map((s) => ({ value: s.id, label: s.title })),
    categoryId: meta.data.categories.filter((c) => c.canSee).map((c) => ({ value: c.id, label: c.title })),
    userId: [{ value: '@me', label: 'Me' }, ...(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))],
  };
  for (const f of crm.data?.customFields ?? [])
    if (f.options.length) choices[`custom.${f.id}`] = f.options.map((o) => ({ value: o.value, label: o.label }));
  const current = viewId ? viewsById.get(viewId) : undefined;

  return (
    <Grid>
      <Grid.Col span={{ base: 12, md: 3, lg: 2 }}>
        <Stack gap={4} component="nav" aria-label="Ticket views">
          <NavLink label={t.tickets.all} active={!viewId} onClick={() => setParams({})} />
          <Text size="xs" fw={700} c="dimmed" mt="sm">
            {t.tickets.myViews}
          </Text>
          <MyViewsList
            items={items}
            views={viewsById}
            ownViewIds={new Set(sb.myViews.map((v) => v.id))}
            activeId={viewId ?? null}
            saving={saveSidebar.isPending}
            onOpen={(id) => setParams({ view: id })}
            onSaveOrder={(next) => saveSidebar.mutateAsync(next)}
            onDelete={async (item) => {
              if (sb.myViews.some((v) => v.id === item.viewId)) {
                await api('DELETE', `/tickets/views/${item.viewId}`).catch((err) => {
                  notifyError(err);
                  throw err;
                });
                await qc.invalidateQueries({ queryKey: ['ticket-sidebar'] });
                if (viewId === item.viewId) setParams({});
              } else await saveSidebar.mutateAsync(items.filter((x) => x.viewId !== item.viewId));
            }}
          />
          {meta.data.can.createViews && (
            <Button size="compact-xs" variant="subtle" onClick={() => setNewView({ name: '', conditions: [] })}>
              {t.tickets.addView}
            </Button>
          )}
          <Text size="xs" fw={700} c="dimmed" mt="sm">
            {t.tickets.teamViews}
          </Text>
          {sb.teamViews.map((v) => (
            <Group key={v.id} gap={0} wrap="nowrap">
              <NavLink
                label={v.name}
                active={viewId === v.id}
                onClick={() => setParams({ view: v.id })}
                style={{ flex: 1 }}
              />
              {!pinned.has(v.id) && (
                <Tooltip label={t.tickets.pin}>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    aria-label={`${t.tickets.pin}: ${v.name}`}
                    onClick={() =>
                      saveSidebar.mutate([
                        ...items,
                        { viewId: v.id, position: items.length, folder: null, parentViewId: null },
                      ])
                    }
                  >
                    +
                  </ActionIcon>
                </Tooltip>
              )}
            </Group>
          ))}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 9, lg: 10 }}>
        <EntityList<Ticket>
          exportEntity="tickets"
          rowBold={(r) => !!r.unread}
          list="tickets"
          title={current?.name ?? t.tickets.title}
          endpoint="/tickets"
          extraParams={{ viewId }}
          columns={columns}
          defaultColumns={[
            'id',
            'title',
            'contactName',
            'categoryTitle',
            'state',
            'statusIds',
            'priority',
            'userName',
            'deadline',
            'lastActivityAt',
          ]}
          filterFields={meta.data.filterFields}
          filterChoices={choices}
          onOpen={(r) => nav(`/tickets/${r.id}`)}
          actions={
            can('tickets', 'create') && (
              <Group>
                <Button variant="default" onClick={() => nav('/email/new')}>
                  {t.email.newEmail}
                </Button>
                <Button onClick={() => nav('/tickets/new')}>{t.tickets.newTicket}</Button>
              </Group>
            )
          }
          bulkActions={
            meta.data.can.bulkEdit || meta.data.can.merge || meta.data.can.delete
              ? (ids, clear) => (
                  <>
                    {meta.data!.can.delete && (
                      <Button
                        size="xs"
                        variant="light"
                        color="red"
                        onClick={() =>
                          window.confirm(t.data.deleteConfirm(ids.length)) &&
                          bulkDelete.mutate({ ids: ids as number[], clear })
                        }
                      >
                        {t.data.delete}
                      </Button>
                    )}
                    {meta.data!.can.bulkEdit && (
                      <Button size="xs" variant="light" onClick={() => setBulk({ ids: ids as number[], clear })}>
                        {t.tickets.bulkEdit}
                      </Button>
                    )}
                    {meta.data!.can.merge && ids.length >= 2 && (
                      <Button size="xs" variant="light" onClick={() => bulkMerge.mutate(ids as number[])}>
                        {t.tickets.bulkMerge}
                      </Button>
                    )}
                  </>
                )
              : undefined
          }
        />
      </Grid.Col>

      <JobModal jobId={jobId} onClose={() => setJobId(null)} />
      <Modal opened={!!newView} onClose={() => setNewView(null)} title={t.tickets.addView} size="xl">
        {newView && (
          <Stack>
            <TextInput
              label={t.tickets.viewName}
              value={newView.name}
              onChange={(e) => setNewView({ ...newView, name: e.currentTarget.value })}
              data-autofocus
            />
            <Paper withBorder p="sm">
              <FilterBuilder
                fields={meta.data.filterFields.filter((f) => f.kind !== 'ref' || choices[f.key])}
                conditions={newView.conditions}
                onChange={(conditions) => setNewView({ ...newView, conditions })}
                choices={choices}
              />
            </Paper>
            <Group justify="flex-end">
              <Button
                disabled={!newView.name.trim()}
                loading={createView.isPending}
                onClick={() => createView.mutate(newView)}
              >
                {t.crm.save}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <Modal opened={!!bulk} onClose={() => setBulk(null)} title={`${t.tickets.bulkEdit} (${bulk?.ids.length ?? 0})`}>
        <Stack>
          <Select
            label={t.tickets.state}
            data={choices.state!}
            value={bulkChanges.state ?? null}
            onChange={(v) => setBulkChanges({ ...bulkChanges, state: v ?? undefined })}
            clearable
          />
          <Select
            label={t.tickets.priority}
            data={choices.priority!}
            value={bulkChanges.priority ?? null}
            onChange={(v) => setBulkChanges({ ...bulkChanges, priority: v ?? undefined })}
            clearable
          />
          <Select
            label={t.tickets.user}
            data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
            value={bulkChanges.userId ?? null}
            onChange={(v) => setBulkChanges({ ...bulkChanges, userId: v ?? undefined })}
            searchable
            clearable
          />
          <Group justify="flex-end">
            <Button
              disabled={!Object.values(bulkChanges).some((v) => v !== undefined)}
              loading={bulkEdit.isPending}
              onClick={() => bulkEdit.mutate()}
            >
              {t.crm.apply}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Grid>
  );
}

import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  CopyButton,
  Grid,
  Group,
  Menu,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
  TypographyStylesProvider,
} from '@mantine/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { formatPhoneForDisplay, type Priority, type TicketState } from '@relay-desk/domain';
import { ApiError, api } from '../../api';
import { useAuth } from '../../auth';
import { CopyValue } from '../../components/CopyValue';
import { DateTimeField } from '../../components/DateFields';
import { DynamicForm } from '../../components/DynamicForm';
import { ContactPicker, UserPicker } from '../../components/FieldInput';
import { HistoryPanel } from '../../components/HistoryPanel';
import { RichTextEditor } from '../../components/RichTextEditor';
import { Segmented } from '../../components/Segmented';
import { useCrmMeta, useUserDirectory } from '../../crm/hooks';
import { useFieldErrors } from '../../crm/useEntityForm';
import { formatDateTime } from '../../format';
import { t } from '../../i18n/en-GB';
import { notifyError, notifyOk } from '../../notify';
import { PRIORITY_COLOURS, STATE_COLOURS, useTicketMeta } from '../../tickets/hooks';
import type { Activity, TicketDetail } from '../../tickets/types';

interface Draft {
  title: string;
  description: string;
  categoryId: string;
  state: TicketState;
  priority: Priority;
  userId: string | null;
  contactId: string | null;
  statusIds: string[];
  deadline: string | null;
  reopenAt: string | null;
  followerIds: string[];
  customFields: Record<string, unknown>;
}

const LAYOUT_KEY = 'rd.ticket.layout';
const SPANS: Record<string, [number, number]> = { '2:1': [8, 4], '1:1': [6, 6], '1:2': [4, 8] };

function draftOf(tk: TicketDetail): Draft {
  return {
    title: tk.title,
    description: tk.description,
    categoryId: tk.categoryId,
    state: tk.state,
    priority: tk.priority,
    userId: tk.userId,
    contactId: tk.contactId,
    statusIds: tk.statusIds,
    deadline: tk.deadline,
    reopenAt: tk.reopenAt,
    followerIds: tk.followers.map((f) => f.id),
    customFields: tk.customFields,
  };
}

/** Ticket detail (spec 6.2): activities and history on the left, the form on the right. */
export function TicketPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const { me, can } = useAuth();
  const meta = useTicketMeta();
  const crm = useCrmMeta();
  const users = useUserDirectory();
  const fieldErrors = useFieldErrors();
  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api<TicketDetail>('GET', `/tickets/${id}`),
    enabled: !isNew,
  });
  const activities = useQuery({
    queryKey: ['ticket-activities', id],
    queryFn: () => api<Activity[]>('GET', `/tickets/${id}/activities`),
    enabled: !isNew,
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [comment, setComment] = useState({ bodyHtml: '', mentionUserIds: [] as string[], isExternal: false });
  const [conflict, setConflict] = useState(false);
  const [viewAt, setViewAt] = useState<string | null>(null);
  const [layout, setLayout] = useState(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) ?? '1:1';
    } catch {
      return '1:1';
    }
  });
  const [modal, setModal] = useState<
    null | { kind: 'child'; activityId?: string } | { kind: 'merge' } | { kind: 'move'; activityId: string }
  >(null);
  const [modalValue, setModalValue] = useState('');

  useEffect(() => {
    if (isNew && meta.data && !draft) {
      const first = meta.data.categories[0];
      setDraft({
        title: '',
        description: '',
        categoryId: params.get('categoryId') ?? first?.id ?? '',
        state: 'open',
        priority: 'normal',
        userId: null,
        contactId: params.get('contactId'),
        statusIds: [],
        deadline: null,
        reopenAt: null,
        followerIds: [],
        customFields: {},
      });
    }
    if (!isNew && ticket.data) setDraft(draftOf(ticket.data));
  }, [isNew, meta.data, ticket.data]);

  const snapshot = useQuery({
    queryKey: ['ticket-snapshot', id, viewAt],
    queryFn: () => api<Draft>('GET', `/tickets/${id}/snapshot?at=${encodeURIComponent(viewAt!)}`),
    enabled: !!viewAt,
  });

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['ticket', id] });
    await qc.invalidateQueries({ queryKey: ['ticket-activities', id] });
    await qc.invalidateQueries({ queryKey: [`/tickets/${id}`, 'history'] });
    await qc.invalidateQueries({ queryKey: ['/tickets'] });
  };

  const dirty = !!draft && !!ticket.data && JSON.stringify(draft) !== JSON.stringify(draftOf(ticket.data));
  const hasComment = comment.bodyHtml.trim().length > 0;

  const save = useMutation({
    mutationFn: async () => {
      if (isNew)
        return api<TicketDetail>('POST', '/tickets', {
          ...draft,
          deadline: draft!.deadline ?? undefined,
          reopenAt: draft!.reopenAt ?? undefined,
        });
      let saved: TicketDetail | undefined;
      // Form changes are saved first; if the comment then fails, the form is still saved (spec 6.2).
      if (dirty)
        saved = await api<TicketDetail>('PATCH', `/tickets/${id}`, { ...draft, version: ticket.data!.version });
      if (hasComment) await api('POST', `/tickets/${id}/comments`, comment);
      return saved;
    },
    onSuccess: async (saved) => {
      fieldErrors.clear();
      setConflict(false);
      if (isNew) {
        if (saved && saved.visible === false) {
          notifyOk(t.tickets.noVisible);
          nav('/tickets');
        } else if (saved) nav(`/tickets/${saved.id}`, { replace: true });
        return;
      }
      if (saved && saved.visible === false) {
        notifyOk(t.tickets.noVisible);
        nav('/tickets');
        return;
      }
      setComment({ bodyHtml: '', mentionUserIds: [], isExternal: false });
      notifyOk();
      await refresh();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body.reason === 'version_conflict') setConflict(true);
      else fieldErrors.handle(err);
    },
  });
  const action = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: notifyError,
  });

  if (!draft || !meta.data || !crm.data) return <Text>{t.common.loading}</Text>;
  const tk = ticket.data;
  const category = meta.data.categories.find((c) => c.id === draft.categoryId);
  const shown: Draft = viewAt && snapshot.data ? { ...draft, ...snapshot.data } : draft;
  const archived = tk?.state === 'archived';
  const readOnly = !!viewAt || archived || !can('tickets', isNew ? 'create' : 'update');
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const statusOptions = meta.data.statuses
    .filter((s) => category?.statusIds.includes(s.id) || shown.statusIds.includes(s.id))
    .map((s) => ({ value: s.id, label: s.title }));
  const userName = (uid: unknown) =>
    typeof uid === 'string' ? users.data?.find((u) => u.id === uid)?.name : undefined;
  const describe = (field: string, v: unknown) => {
    if (field === 'userId') return userName(v);
    if (field === 'categoryId') return meta.data!.categories.find((c) => c.id === v)?.title;
    if (field === 'statusIds' && Array.isArray(v))
      return v.map((s) => meta.data!.statuses.find((x) => x.id === s)?.title ?? s).join(', ') || undefined;
    if (field === 'followerIds' && Array.isArray(v)) return v.map((u) => userName(u) ?? u).join(', ') || undefined;
    if (field === 'state' && typeof v === 'string') return t.tickets.states[v];
    if (field === 'priority' && typeof v === 'string') return t.tickets.priorities[v];
    if ((field === 'deadline' || field === 'reopenAt') && typeof v === 'string')
      return formatDateTime(v, me!.user.timezone);
    return undefined;
  };
  const [left, right] = SPANS[layout] ?? SPANS['1:1']!;
  const primaryLabel = isNew
    ? t.crm.create
    : hasComment && dirty
      ? t.tickets.saveAndComment
      : hasComment
        ? t.tickets.addComment
        : t.tickets.saveChanges;

  const form = (
    <Stack gap="sm">
      <TextInput
        label={t.tickets.titleField}
        required
        value={shown.title}
        disabled={readOnly}
        onChange={(e) => set({ title: e.currentTarget.value })}
        error={fieldErrors.errors.title}
      />
      {can('crm_contacts', 'read') && (
        <ContactPicker
          label={t.tickets.contact}
          value={shown.contactId}
          disabled={readOnly}
          onChange={(v) => set({ contactId: v })}
        />
      )}
      {tk?.contactCard && <ContactCard card={tk.contactCard} />}
      <Select
        label={t.tickets.category}
        data={groupCategories(meta.data.categories)}
        value={shown.categoryId}
        disabled={readOnly}
        allowDeselect={false}
        onChange={(v) => v && set({ categoryId: v })}
      />
      <Group grow>
        <Select
          label={t.tickets.priority}
          data={Object.entries(t.tickets.priorities).map(([value, label]) => ({ value, label }))}
          value={shown.priority}
          disabled={readOnly}
          allowDeselect={false}
          onChange={(v) => v && set({ priority: v as Priority })}
        />
        <Select
          label={t.tickets.state}
          data={Object.entries(t.tickets.states).map(([value, label]) => ({ value, label }))}
          value={shown.state}
          disabled={readOnly}
          allowDeselect={false}
          onChange={(v) => v && set({ state: v as TicketState })}
        />
      </Group>
      <UserPicker
        label={t.tickets.user}
        value={shown.userId}
        disabled={readOnly}
        onChange={(v) => set({ userId: v })}
        error={fieldErrors.errors.userId}
      />
      <Group grow>
        <DateTimeField
          label={t.tickets.deadline}
          value={shown.deadline}
          disabled={readOnly}
          onChange={(deadline) => set({ deadline })}
        />
        <DateTimeField
          label={t.tickets.reopenAt}
          value={shown.reopenAt}
          disabled={readOnly}
          required={shown.state === 'waiting' && category?.waitingRequiresReopen}
          error={fieldErrors.errors.reopenAt}
          onChange={(reopenAt) => set({ reopenAt })}
        />
      </Group>
      <MultiSelect
        label={t.tickets.followers}
        data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
        value={shown.followerIds}
        disabled={readOnly}
        searchable
        onChange={(v) => set({ followerIds: v })}
      />
      {category?.multipleStatuses ? (
        <MultiSelect
          label={t.tickets.status}
          data={statusOptions}
          value={shown.statusIds}
          disabled={readOnly}
          onChange={(v) => set({ statusIds: v })}
          error={fieldErrors.errors.statusIds}
        />
      ) : (
        <Select
          label={t.tickets.status}
          data={statusOptions}
          value={shown.statusIds[0] ?? null}
          disabled={readOnly}
          clearable
          error={fieldErrors.errors.statusIds}
          onChange={(v) => set({ statusIds: v ? [v] : [] })}
        />
      )}
      {fieldErrors.errors.children && (
        <Alert color="red" p="xs">
          {fieldErrors.errors.children}
        </Alert>
      )}
      <Text size="sm" fw={500}>
        {t.tickets.description}
      </Text>
      {readOnly ? (
        <Paper withBorder p="xs">
          <TypographyStylesProvider>
            <div dangerouslySetInnerHTML={{ __html: shown.description }} />
          </TypographyStylesProvider>
        </Paper>
      ) : (
        <RichTextEditor
          label={t.tickets.description}
          value={draft.description}
          onChange={(description) => set({ description })}
        />
      )}
      {category && (
        <DynamicForm
          layout={category.formLayout}
          fields={crm.data.customFields}
          values={shown.customFields}
          readOnly={readOnly}
          errors={fieldErrors.errors}
          onChange={(customFields) => set({ customFields })}
        />
      )}
    </Stack>
  );

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Stack gap={2}>
          <Group gap="xs">
            {!isNew && (
              <>
                <Text c="dimmed">#{tk?.id}</Text>
                <CopyButton value={`${window.location.origin}/tickets/${tk?.id}`}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? t.crm.copied : t.tickets.copyLink}>
                      <ActionIcon size="sm" variant="subtle" onClick={copy} aria-label={t.tickets.copyLink}>
                        🔗
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
                <Tooltip label={tk?.isFavourite ? t.tickets.unfavourite : t.tickets.favourite}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="yellow"
                    aria-label={tk?.isFavourite ? t.tickets.unfavourite : t.tickets.favourite}
                    aria-pressed={tk?.isFavourite}
                    onClick={() =>
                      action.mutate(() => api(tk?.isFavourite ? 'DELETE' : 'POST', `/tickets/${id}/favourite`))
                    }
                  >
                    {tk?.isFavourite ? '★' : '☆'}
                  </ActionIcon>
                </Tooltip>
                {tk && (
                  <Badge color={STATE_COLOURS[tk.state]} variant="light">
                    {t.tickets.states[tk.state]}
                  </Badge>
                )}
                {tk && (
                  <Badge color={PRIORITY_COLOURS[tk.priority]} variant="dot">
                    {t.tickets.priorities[tk.priority]}
                  </Badge>
                )}
              </>
            )}
          </Group>
          <Title order={2}>{isNew ? t.tickets.newTicket : tk?.title}</Title>
          {tk && (
            <Text size="sm" c="dimmed">
              {t.tickets.created} {formatDateTime(tk.createdAt, me!.user.timezone)} · {t.tickets.user}:{' '}
              {tk.user?.name ?? t.crm.none}
              {tk.parent && (
                <>
                  {' · '}
                  {t.tickets.parent}:{' '}
                  <Anchor component={Link} to={`/tickets/${tk.parent.id}`}>
                    #{tk.parent.id} {tk.parent.title}
                  </Anchor>
                </>
              )}
              {tk.mergedIntoId && (
                <>
                  {' · '}
                  <Anchor component={Link} to={`/tickets/${tk.mergedIntoId}`}>
                    {t.tickets.mergedInto(tk.mergedIntoId)}
                  </Anchor>
                </>
              )}
            </Text>
          )}
        </Stack>
        <Group>
          {!isNew && (
            <>
              <Segmented
                label={t.tickets.layout}
                data={['2:1', '1:1', '1:2'].map((v) => ({ value: v, label: v }))}
                value={layout}
                onChange={(v) => {
                  setLayout(v);
                  try {
                    localStorage.setItem(LAYOUT_KEY, v);
                  } catch {
                    /* storage unavailable */
                  }
                }}
              />
              <Button
                variant="default"
                onClick={() => {
                  const following = tk?.followers.some((f) => f.id === me!.user.id);
                  action.mutate(() => api(following ? 'DELETE' : 'POST', `/tickets/${id}/follow`));
                }}
              >
                {tk?.followers.some((f) => f.id === me!.user.id) ? t.tickets.unfollow : t.tickets.follow}
              </Button>
              <Menu>
                <Menu.Target>
                  <Button variant="default">{t.tickets.actions}</Button>
                </Menu.Target>
                <Menu.Dropdown>
                  {can('tickets', 'create') && (
                    <Menu.Item onClick={() => (setModalValue(''), setModal({ kind: 'child' }))}>
                      {t.tickets.createChild}
                    </Menu.Item>
                  )}
                  {meta.data.can.merge && (
                    <Menu.Item onClick={() => (setModalValue(''), setModal({ kind: 'merge' }))}>
                      {t.tickets.merge}
                    </Menu.Item>
                  )}
                  {meta.data.can.delete && (
                    <Menu.Item
                      color="red"
                      onClick={() =>
                        window.confirm(t.crm.confirmDelete) &&
                        action.mutate(async () => {
                          await api('DELETE', `/tickets/${id}`);
                          nav('/tickets');
                        })
                      }
                    >
                      {t.tickets.delete}
                    </Menu.Item>
                  )}
                </Menu.Dropdown>
              </Menu>
            </>
          )}
          {!readOnly && (
            <Button loading={save.isPending} disabled={!isNew && !dirty && !hasComment} onClick={() => save.mutate()}>
              {primaryLabel}
            </Button>
          )}
        </Group>
      </Group>

      {conflict && (
        <Alert color="orange">
          <Group justify="space-between">
            <Text size="sm">{t.tickets.conflict}</Text>
            <Button
              size="compact-sm"
              onClick={async () => {
                setConflict(false);
                await refresh();
              }}
            >
              {t.tickets.reload}
            </Button>
          </Group>
        </Alert>
      )}
      {params.get('mergedFrom') && (
        <Alert color="blue">{t.tickets.redirectedFromMerge(Number(params.get('mergedFrom')))}</Alert>
      )}
      {archived && (
        <Alert color="gray">
          <Group justify="space-between">
            <Text size="sm">{t.tickets.archivedReadOnly}</Text>
            {can('tickets', 'update') && (
              <Button
                size="compact-sm"
                onClick={() =>
                  action.mutate(() => api('PATCH', `/tickets/${id}`, { state: 'open', version: tk!.version }))
                }
              >
                {t.tickets.unarchive}
              </Button>
            )}
          </Group>
        </Alert>
      )}
      {tk && tk.merges.length > 0 && (
        <Paper withBorder p="xs">
          <Stack gap={4}>
            <Text size="sm" fw={600}>
              {t.tickets.mergedHere}
            </Text>
            {tk.merges.map((m) => (
              <Group key={m.id} justify="space-between">
                <Text size="sm">
                  #{m.mergedId} {m.title} · {formatDateTime(m.createdAt, me!.user.timezone)}
                </Text>
                {meta.data.can.merge && !archived && (
                  <Button
                    size="compact-xs"
                    variant="light"
                    onClick={() => action.mutate(() => api('POST', `/tickets/${id}/merges/${m.id}/undo`))}
                  >
                    {t.tickets.undoMerge}
                  </Button>
                )}
              </Group>
            ))}
          </Stack>
        </Paper>
      )}
      {viewAt && (
        <Alert color="blue">
          <Group justify="space-between">
            <Text size="sm">{t.crm.history.viewingAt(formatDateTime(viewAt, me!.user.timezone))}</Text>
            <Button size="compact-sm" variant="light" onClick={() => setViewAt(null)}>
              {t.crm.history.reset}
            </Button>
          </Group>
        </Alert>
      )}

      {isNew ? (
        <Paper withBorder p="md" maw={720}>
          {form}
        </Paper>
      ) : (
        <Grid>
          <Grid.Col span={{ base: 12, md: left }}>
            <Tabs defaultValue="activities" keepMounted={false}>
              <Tabs.List>
                <Tabs.Tab value="activities">{t.tickets.activities}</Tabs.Tab>
                <Tabs.Tab value="history">{t.tickets.history}</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="activities" pt="md">
                <Stack>
                  {activities.data?.length === 0 && <Text c="dimmed">{t.tickets.noActivities}</Text>}
                  {activities.data?.map((a) => (
                    <ActivityItem
                      key={a.id}
                      a={a}
                      ticketId={Number(id)}
                      mine={a.userId === me!.user.id}
                      canMove={meta.data!.can.moveActivities}
                      onChanged={refresh}
                      onChild={() => (setModalValue(''), setModal({ kind: 'child', activityId: a.id }))}
                      onMove={() => (setModalValue(''), setModal({ kind: 'move', activityId: a.id }))}
                    />
                  ))}
                  {can('tickets', 'update') && !archived && (
                    <Paper withBorder p="sm">
                      <Stack gap="xs">
                        <RichTextEditor
                          label={t.tickets.comment}
                          value={comment.bodyHtml}
                          onChange={(bodyHtml) => setComment({ ...comment, bodyHtml })}
                          minHeight={80}
                        />
                        <Group align="flex-end">
                          <MultiSelect
                            label={t.tickets.mention}
                            data={(users.data ?? [])
                              .filter((u) => u.id !== me!.user.id)
                              .map((u) => ({ value: u.id, label: `@${u.name}` }))}
                            value={comment.mentionUserIds}
                            onChange={(mentionUserIds) => setComment({ ...comment, mentionUserIds })}
                            searchable
                            style={{ flex: 1 }}
                          />
                          {tk?.category.allowExternalComments && (
                            <Checkbox
                              label={t.tickets.external}
                              checked={comment.isExternal}
                              onChange={(e) => setComment({ ...comment, isExternal: e.currentTarget.checked })}
                            />
                          )}
                          <Button disabled={!hasComment} loading={save.isPending} onClick={() => save.mutate()}>
                            {dirty ? t.tickets.saveAndComment : t.tickets.addComment}
                          </Button>
                        </Group>
                      </Stack>
                    </Paper>
                  )}
                </Stack>
              </Tabs.Panel>
              <Tabs.Panel value="history" pt="md">
                <HistoryPanel
                  endpoint={`/tickets/${id}`}
                  onViewAt={setViewAt}
                  describe={describe}
                  activities={(activities.data ?? []).map((a) => ({
                    id: a.id,
                    createdAt: a.createdAt,
                    userName: a.userName,
                    summary: a.bodyHtml.replace(/<[^>]+>/g, ' '),
                  }))}
                />
              </Tabs.Panel>
            </Tabs>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: right }}>
            <Tabs defaultValue="form">
              <Tabs.List>
                <Tabs.Tab value="form">{t.tickets.form}</Tabs.Tab>
              </Tabs.List>
              <Tabs.Panel value="form" pt="md">
                {form}
                {tk && tk.children.length > 0 && (
                  <Stack gap={4} mt="md">
                    <Text size="sm" fw={600}>
                      {t.tickets.children}
                    </Text>
                    {tk.children.map((c) => (
                      <Anchor key={c.id} component={Link} to={`/tickets/${c.id}`} size="sm">
                        #{c.id} {c.title} ({t.tickets.states[c.state]})
                      </Anchor>
                    ))}
                  </Stack>
                )}
              </Tabs.Panel>
            </Tabs>
          </Grid.Col>
        </Grid>
      )}

      <Modal
        opened={!!modal}
        onClose={() => setModal(null)}
        title={
          modal?.kind === 'merge'
            ? t.tickets.merge
            : modal?.kind === 'move'
              ? t.tickets.moveActivity
              : t.tickets.createChild
        }
      >
        <Stack>
          {modal?.kind === 'merge' ? (
            <TextInput
              label={t.tickets.mergeHelp}
              placeholder="12, 15"
              value={modalValue}
              onChange={(e) => setModalValue(e.currentTarget.value)}
              data-autofocus
            />
          ) : modal?.kind === 'move' ? (
            <NumberInput
              label={t.tickets.moveTarget}
              value={modalValue}
              onChange={(v) => setModalValue(String(v))}
              data-autofocus
            />
          ) : (
            <TextInput
              label={t.tickets.childTitle}
              value={modalValue}
              onChange={(e) => setModalValue(e.currentTarget.value)}
              data-autofocus
            />
          )}
          <Group justify="flex-end">
            <Button
              disabled={!modalValue.trim()}
              onClick={() => {
                const m = modal!;
                setModal(null);
                if (m.kind === 'merge') {
                  const others = modalValue
                    .split(/[\s,]+/)
                    .map((x) => Number(x.replace('#', '')))
                    .filter((n) => n > 0);
                  action.mutate(() =>
                    api('POST', '/tickets/merge', { ticketIds: [Number(id), ...others], survivorId: Number(id) }),
                  );
                } else if (m.kind === 'move') {
                  action.mutate(() =>
                    api('POST', `/tickets/${id}/activities/${m.activityId}/move`, {
                      targetTicketId: Number(modalValue),
                    }),
                  );
                } else {
                  action.mutate(async () => {
                    const child = await api<{ id: number }>('POST', `/tickets/${id}/children`, {
                      title: modalValue,
                      activityId: m.activityId,
                    });
                    nav(`/tickets/${child.id}`);
                  });
                }
              }}
            >
              {t.crm.apply}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

/** Category options grouped by their group label (spec 7.1, "groups"). */
function groupCategories(cats: { id: string; title: string; groupName: string }[]) {
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const c of cats) {
    const key = c.groupName || 'Other';
    groups.set(key, [...(groups.get(key) ?? []), { value: c.id, label: c.title }]);
  }
  return [...groups].map(([group, items]) => ({ group, items }));
}

function ContactCard({ card }: { card: NonNullable<TicketDetail['contactCard']> }) {
  return (
    <Paper withBorder p="xs" bg="var(--mantine-color-default-hover)">
      <Stack gap={4}>
        <Anchor component={Link} to={`/crm/contacts/${card.id}`} fw={600}>
          {card.name}
        </Anchor>
        {card.emails[0] && <CopyValue value={card.emails[0]} />}
        {card.phones[0] && <CopyValue value={formatPhoneForDisplay(card.phones[0])} />}
        {card.account && (
          <Anchor component={Link} to={`/crm/accounts/${card.account.id}`} size="sm" fw={500}>
            {card.account.path}
          </Anchor>
        )}
        {card.account?.phones.map((p) => (
          <CopyValue key={p} value={formatPhoneForDisplay(p)} />
        ))}
        {card.account?.emails.map((e) => (
          <CopyValue key={e} value={e} />
        ))}
        {card.account && card.account.deliveryAddresses.length > 0 && (
          <>
            <Text size="xs" fw={600}>
              {t.crm.deliveryAddresses}
            </Text>
            {card.account.deliveryAddresses.map((a, i) => (
              <Text key={i} size="xs">
                <b>{a.label}:</b> {[a.line1, a.line2, a.town, a.county, a.postcode].filter(Boolean).join(', ')}
              </Text>
            ))}
          </>
        )}
        <Text size="xs" c="dimmed">
          {t.tickets.openRecords(card.openRecordCount)}
        </Text>
        {card.otherOpenTickets.length > 0 && (
          <>
            <Text size="xs" fw={600}>
              {t.tickets.otherOpen}
            </Text>
            {card.otherOpenTickets.map((o) => (
              <Anchor key={o.id} component={Link} to={`/tickets/${o.id}`} size="xs">
                #{o.id} {o.title}
              </Anchor>
            ))}
          </>
        )}
      </Stack>
    </Paper>
  );
}

function ActivityItem(props: {
  a: Activity;
  ticketId: number;
  mine: boolean;
  canMove: boolean;
  onChanged: () => void;
  onChild: () => void;
  onMove: () => void;
}) {
  const { me } = useAuth();
  const { a } = props;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(a.bodyHtml);
  const edit = useMutation({
    mutationFn: () =>
      api('PATCH', `/tickets/${props.ticketId}/comments/${a.id}`, { bodyHtml: body, mentionUserIds: a.mentionUserIds }),
    onSuccess: () => {
      setEditing(false);
      props.onChanged();
    },
    onError: notifyError,
  });
  return (
    <Paper withBorder p="sm" id={`activity-${a.id}`}>
      <Group justify="space-between" mb={4}>
        <Group gap="xs">
          <Text size="sm" fw={600}>
            {a.userName ?? t.tickets.system}
          </Text>
          <Text size="xs" c="dimmed">
            {formatDateTime(a.createdAt, me!.user.timezone)}
          </Text>
          {a.editedAt && (
            <Text size="xs" c="dimmed">
              {t.tickets.edited(formatDateTime(a.editedAt, me!.user.timezone))}
            </Text>
          )}
          {a.isExternal && <Badge size="xs">{t.tickets.external}</Badge>}
        </Group>
        <Group gap={4}>
          {props.mine && !editing && (
            <Button size="compact-xs" variant="subtle" onClick={() => setEditing(true)}>
              {t.tickets.edit}
            </Button>
          )}
          <Menu>
            <Menu.Target>
              <ActionIcon size="sm" variant="subtle" aria-label="Activity actions">
                ⋯
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                onClick={() =>
                  navigator.clipboard?.writeText(`${window.location.origin}/tickets/${props.ticketId}#activity-${a.id}`)
                }
              >
                {t.tickets.copyLink}
              </Menu.Item>
              <Menu.Item onClick={props.onChild}>{t.tickets.createChild}</Menu.Item>
              {props.canMove && <Menu.Item onClick={props.onMove}>{t.tickets.moveActivity}</Menu.Item>}
              <Menu.Item onClick={() => window.print()}>Print</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      {editing ? (
        <Stack gap="xs">
          <RichTextEditor label={t.tickets.comment} value={body} onChange={setBody} />
          <Group justify="flex-end">
            <Button size="xs" variant="default" onClick={() => setEditing(false)}>
              {t.tickets.cancel}
            </Button>
            <Button size="xs" loading={edit.isPending} onClick={() => edit.mutate()}>
              {t.tickets.saveComment}
            </Button>
          </Group>
        </Stack>
      ) : (
        <TypographyStylesProvider>
          {/* bodyHtml is sanitised by the API before storage. */}
          <div dangerouslySetInnerHTML={{ __html: a.bodyHtml }} />
        </TypographyStylesProvider>
      )}
    </Paper>
  );
}

import { BarChart } from '@mantine/charts';
import {
  Anchor,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFile } from '../../api';
import { useAuth } from '../../auth';
import { workingTime } from '../../components/SlaIcon';
import { useUserDirectory } from '../../crm/hooks';
import { qs } from '../../crm/hooks';
import { formatDateTime } from '../../format';
import { t } from '../../i18n/en-GB';
import { notifyError } from '../../notify';
import { STATE_COLOURS, useTicketMeta } from '../../tickets/hooks';

interface Summary {
  days: string[];
  created: { day: string; count: number }[];
  closed: { day: string; count: number }[];
  totals: { created: number; closed: number };
  backlog: { day: string; count: number }[];
  firstAnswer: { met: number; decided: number; percent: number | null };
  solution: { met: number; decided: number; percent: number | null };
  medianFirstResponseMinutes: number | null;
  medianResolutionMinutes: number | null;
  reopenRate: { reopened: number; closed: number; percent: number | null };
  workload: { userId: string; name: string; open: number; closed: number }[];
  heatmap: number[][];
  inboundEmails: number;
}
interface DrillTicket {
  id: number;
  title: string;
  state: string;
  createdAt: string;
}

/** Two validated series colours (blue = created, amber = closed) per colour scheme. */
const SERIES = { light: ['#2167c2', '#c07a00'], dark: ['#4a86d6', '#c2831a'] };
/** Sequential blue for the heatmap: empty cells stay surface-coloured. */
const ramp = (v: number, max: number, dark: boolean) => {
  if (!v) return 'transparent';
  const k = 0.15 + 0.85 * (v / max);
  return dark ? `rgba(74, 134, 214, ${k})` : `rgba(33, 103, 194, ${k})`;
};

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

function Tile(props: { label: string; value: ReactNode; detail?: string; onClick?: () => void }) {
  const body = (
    <Paper withBorder p="md" h="100%">
      <Text size="sm" c="dimmed">
        {props.label}
      </Text>
      <Text fz={28} fw={700} lh={1.2}>
        {props.value}
      </Text>
      {props.detail && (
        <Text size="xs" c="dimmed">
          {props.detail}
        </Text>
      )}
    </Paper>
  );
  return props.onClick ? (
    <UnstyledButton onClick={props.onClick} aria-label={`${props.label}: show tickets`} style={{ height: '100%' }}>
      {body}
    </UnstyledButton>
  ) : (
    body
  );
}

/** Reporting (spec 17): filters, headline figures, charts with tables, drill-down and export. */
export function ReportsPage() {
  const { me } = useAuth();
  const meta = useTicketMeta();
  const users = useUserDirectory();
  const dark = useComputedColorScheme('light') === 'dark';
  const colours = dark ? SERIES.dark : SERIES.light;
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(daysAgo(0));
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [queueId, setQueueId] = useState<string | null>(null);
  const [priority, setPriority] = useState<string | null>(null);
  const [asTable, setAsTable] = useState<Record<string, boolean>>({});
  const [drill, setDrill] = useState<{ title: string; params: Record<string, string> } | null>(null);
  const [direction, setDirection] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const mailboxes = useQuery({
    queryKey: ['my-mailboxes'],
    queryFn: () => api<{ id: string; title: string }[]>('GET', '/mailboxes'),
  });

  const params = {
    from: new Date(`${from}T00:00:00`).toISOString(),
    to: new Date(`${to}T23:59:59`).toISOString(),
    categoryId: categoryId ?? undefined,
    userId: userId ?? undefined,
    queueId: queueId ?? undefined,
    priority: priority ?? undefined,
  };
  const summary = useQuery({
    queryKey: ['report', params],
    queryFn: () => api<Summary>('GET', `/reports/summary${qs(params)}`),
    placeholderData: (p) => p,
  });
  const emails = useQuery({
    queryKey: ['report-emails', params, direction, status],
    queryFn: () =>
      api<
        {
          id: string;
          ticketId: number;
          ticketTitle: string;
          direction: string;
          status: string;
          error: string | null;
          createdAt: string;
          subject: string | null;
          queue: string | null;
        }[]
      >('GET', `/reports/emails${qs({ ...params, direction: direction ?? undefined, status: status ?? undefined })}`),
  });
  const drilled = useQuery({
    queryKey: ['report-drill', params, drill?.params],
    queryFn: () => api<DrillTicket[]>('GET', `/reports/tickets${qs({ ...params, ...drill!.params })}`),
    enabled: !!drill,
  });
  const exportSection = (section: string, format: 'csv' | 'xlsx') =>
    downloadFile(`/reports/export${qs({ ...params, section, format })}`, `report-${section}.${format}`).catch(
      notifyError,
    );
  const s = summary.data;
  const show = (title: string, p: Record<string, string>) => setDrill({ title, params: p });
  const pct = (v: number | null) => (v === null ? t.reports.none : `${v}%`);
  const mins = (v: number | null) => (v === null ? t.reports.none : workingTime(v));
  const toggle = (k: string) => setAsTable({ ...asTable, [k]: !asTable[k] });

  const ExportMenu = ({ section }: { section: string }) => (
    <Menu>
      <Menu.Target>
        <Button size="compact-xs" variant="subtle">
          {t.reports.export}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => exportSection(section, 'csv')}>{t.data.exportCsv}</Menu.Item>
        <Menu.Item onClick={() => exportSection(section, 'xlsx')}>{t.data.exportXlsx}</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );

  const daily = (s?.days ?? []).map((d, i) => ({
    day: shortDay(d),
    key: d,
    created: s!.created[i]!.count,
    closed: s!.closed[i]!.count,
    backlog: s!.backlog[i]!.count,
  }));
  const maxCell = Math.max(1, ...(s?.heatmap.flat() ?? [0]));

  return (
    <Stack>
      <Title order={2}>{t.reports.title}</Title>
      <Group align="flex-end" wrap="wrap">
        <TextInput
          type="date"
          label={t.reports.from}
          value={from}
          max={to}
          onChange={(e) => setFrom(e.currentTarget.value)}
        />
        <TextInput
          type="date"
          label={t.reports.to}
          value={to}
          min={from}
          onChange={(e) => setTo(e.currentTarget.value)}
        />
        <Menu>
          <Menu.Target>
            <Button variant="default">…</Button>
          </Menu.Target>
          <Menu.Dropdown>
            {(
              [
                ['week', 6],
                ['month', 29],
                ['quarter', 89],
              ] as const
            ).map(([k, n]) => (
              <Menu.Item key={k} onClick={() => (setFrom(daysAgo(n)), setTo(daysAgo(0)))}>
                {t.reports.presets[k]}
              </Menu.Item>
            ))}
            <Menu.Item onClick={() => (setFrom(`${daysAgo(0).slice(0, 8)}01`), setTo(daysAgo(0)))}>
              {t.reports.presets.thisMonth}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <Select
          aria-label={t.tickets.category}
          placeholder={t.reports.anyCategory}
          data={(meta.data?.categories ?? []).map((c) => ({ value: c.id, label: c.title }))}
          value={categoryId}
          onChange={setCategoryId}
          clearable
          searchable
          w={200}
        />
        <Select
          aria-label={t.reports.user}
          placeholder={t.reports.anyUser}
          data={(users.data ?? []).map((u) => ({ value: u.id, label: u.name }))}
          value={userId}
          onChange={setUserId}
          clearable
          searchable
          w={180}
        />
        <Select
          aria-label={t.reports.mailbox}
          placeholder={t.reports.anyMailbox}
          data={(mailboxes.data ?? []).map((m) => ({ value: m.id, label: m.title }))}
          value={queueId}
          onChange={setQueueId}
          clearable
          w={180}
        />
        <Select
          aria-label={t.tickets.priority}
          placeholder={t.reports.anyPriority}
          data={Object.entries(t.tickets.priorities).map(([value, label]) => ({ value, label }))}
          value={priority}
          onChange={setPriority}
          clearable
          w={150}
        />
      </Group>

      <Tabs defaultValue="overview" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="overview">{t.reports.overview}</Tabs.Tab>
          <Tabs.Tab value="emails">{t.reports.emails}</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          {s && (
            <Stack>
              <SimpleGrid cols={{ base: 2, sm: 4 }}>
                <Tile
                  label={t.reports.created}
                  value={s.totals.created}
                  onClick={() => show(t.reports.created, { metric: 'created' })}
                />
                <Tile
                  label={t.reports.closed}
                  value={s.totals.closed}
                  onClick={() => show(t.reports.closed, { metric: 'closed' })}
                />
                <Tile
                  label={t.reports.firstAnswer}
                  value={pct(s.firstAnswer.percent)}
                  detail={t.reports.ofDecided(s.firstAnswer.met, s.firstAnswer.decided)}
                  onClick={() => show(`${t.reports.firstAnswer}: missed`, { metric: 'first_answer_missed' })}
                />
                <Tile
                  label={t.reports.solution}
                  value={pct(s.solution.percent)}
                  detail={t.reports.ofDecided(s.solution.met, s.solution.decided)}
                  onClick={() => show(`${t.reports.solution}: missed`, { metric: 'solution_missed' })}
                />
                <Tile
                  label={t.reports.medianResponse}
                  value={mins(s.medianFirstResponseMinutes)}
                  detail={t.reports.workingTime}
                />
                <Tile
                  label={t.reports.medianResolution}
                  value={mins(s.medianResolutionMinutes)}
                  detail={t.reports.workingTime}
                />
                <Tile
                  label={t.reports.reopenRate}
                  value={pct(s.reopenRate.percent)}
                  detail={t.reports.ofClosed(s.reopenRate.reopened, s.reopenRate.closed)}
                  onClick={() => show(t.reports.reopenRate, { metric: 'reopened' })}
                />
                <Tile label={t.reports.inbound} value={s.inboundEmails} />
              </SimpleGrid>

              <Paper withBorder p="md">
                <Group justify="space-between" mb="sm">
                  <Text fw={600}>{t.reports.createdClosed}</Text>
                  <Group gap="xs">
                    <Button size="compact-xs" variant="subtle" onClick={() => toggle('daily')}>
                      {asTable.daily ? t.reports.showChart : t.reports.showTable}
                    </Button>
                    <ExportMenu section="daily" />
                  </Group>
                </Group>
                {asTable.daily ? (
                  <ScrollArea h={280}>
                    <Table striped>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{t.reports.day}</Table.Th>
                          <Table.Th>{t.reports.created}</Table.Th>
                          <Table.Th>{t.reports.closed}</Table.Th>
                          <Table.Th>{t.reports.backlog}</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {daily.map((d) => (
                          <Table.Tr key={d.key}>
                            <Table.Td>{d.day}</Table.Td>
                            <Table.Td>
                              <Anchor
                                component="button"
                                onClick={() => show(`${t.reports.created} ${d.day}`, { metric: 'created', day: d.key })}
                              >
                                {d.created}
                              </Anchor>
                            </Table.Td>
                            <Table.Td>
                              <Anchor
                                component="button"
                                onClick={() => show(`${t.reports.closed} ${d.day}`, { metric: 'closed', day: d.key })}
                              >
                                {d.closed}
                              </Anchor>
                            </Table.Td>
                            <Table.Td>{d.backlog}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                ) : (
                  <BarChart
                    h={260}
                    data={daily}
                    dataKey="day"
                    withLegend
                    legendProps={{ verticalAlign: 'top' }}
                    series={[
                      { name: 'created', label: t.reports.created, color: colours[0]! },
                      { name: 'closed', label: t.reports.closed, color: colours[1]! },
                    ]}
                    barProps={{ radius: [4, 4, 0, 0] }}
                    gridAxis="y"
                    tickLine="none"
                    yAxisProps={{ allowDecimals: false, width: 32 }}
                  />
                )}
              </Paper>

              <SimpleGrid cols={{ base: 1, md: 2 }}>
                <Paper withBorder p="md">
                  <Group justify="space-between" mb="sm">
                    <Text fw={600}>{t.reports.backlog}</Text>
                    <ExportMenu section="daily" />
                  </Group>
                  <BarChart
                    h={220}
                    data={daily}
                    dataKey="day"
                    series={[{ name: 'backlog', label: t.reports.backlog, color: colours[0]! }]}
                    barProps={{ radius: [4, 4, 0, 0] }}
                    gridAxis="y"
                    tickLine="none"
                    yAxisProps={{ allowDecimals: false, width: 32 }}
                  />
                </Paper>
                <Paper withBorder p="md">
                  <Group justify="space-between" mb="sm">
                    <Text fw={600}>{t.reports.workload}</Text>
                    <ExportMenu section="workload" />
                  </Group>
                  <Table>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>{t.reports.user}</Table.Th>
                        <Table.Th ta="right">{t.reports.openNow}</Table.Th>
                        <Table.Th ta="right">{t.reports.closedInPeriod}</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {s.workload.map((w) => (
                        <Table.Tr key={w.userId}>
                          <Table.Td>{w.name}</Table.Td>
                          <Table.Td ta="right">
                            <Anchor
                              component="button"
                              onClick={() =>
                                show(`${w.name}: ${t.reports.openNow}`, { metric: 'open_by_user', forUserId: w.userId })
                              }
                            >
                              {w.open}
                            </Anchor>
                          </Table.Td>
                          <Table.Td ta="right">
                            <Anchor
                              component="button"
                              onClick={() =>
                                show(`${w.name}: ${t.reports.closedInPeriod}`, {
                                  metric: 'closed_by_user',
                                  forUserId: w.userId,
                                })
                              }
                            >
                              {w.closed}
                            </Anchor>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Paper>
              </SimpleGrid>

              <Paper withBorder p="md">
                <Group justify="space-between" mb="sm">
                  <Text fw={600}>{t.reports.heatmap}</Text>
                  <ExportMenu section="heatmap" />
                </Group>
                <ScrollArea>
                  <table style={{ borderCollapse: 'separate', borderSpacing: 2 }} aria-label={t.reports.heatmap}>
                    <thead>
                      <tr>
                        <th />
                        {Array.from({ length: 24 }, (_, h) => (
                          <th
                            key={h}
                            style={{ fontSize: 10, fontWeight: 400, color: 'var(--mantine-color-dimmed)', width: 26 }}
                          >
                            {h % 3 === 0 ? String(h).padStart(2, '0') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.heatmap.map((row, d) => (
                        <tr key={d}>
                          <th style={{ fontSize: 12, fontWeight: 400, paddingRight: 6, textAlign: 'left' }}>
                            {t.reports.weekdays[d]}
                          </th>
                          {row.map((n, h) => {
                            const label = t.reports.heatmapCell(
                              t.reports.weekdays[d]!,
                              `${String(h).padStart(2, '0')}:00`,
                              n,
                            );
                            return (
                              <Tooltip key={h} label={label} withArrow openDelay={100}>
                                <td
                                  aria-label={label}
                                  style={{
                                    width: 26,
                                    height: 22,
                                    borderRadius: 4,
                                    background: ramp(n, maxCell, dark),
                                    outline: '1px solid var(--mantine-color-default-border)',
                                  }}
                                />
                              </Tooltip>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollArea>
              </Paper>
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="emails" pt="md">
          <Stack>
            <Group>
              <Select
                aria-label={t.reports.direction}
                placeholder={t.reports.anyDirection}
                data={Object.entries(t.reports.directions).map(([value, label]) => ({ value, label }))}
                value={direction}
                onChange={setDirection}
                clearable
                w={180}
              />
              <Select
                aria-label={t.reports.status}
                placeholder={t.reports.anyStatus}
                data={Object.entries(t.email.statuses).map(([value, label]) => ({ value, label }))}
                value={status}
                onChange={setStatus}
                clearable
                w={180}
              />
              <ExportMenu section="emails" />
            </Group>
            {emails.data?.length === 0 && <Text c="dimmed">{t.reports.noEmails}</Text>}
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t.crm.created}</Table.Th>
                  <Table.Th>{t.reports.ticket}</Table.Th>
                  <Table.Th>{t.reports.subject}</Table.Th>
                  <Table.Th>{t.reports.direction}</Table.Th>
                  <Table.Th>{t.reports.status}</Table.Th>
                  <Table.Th>{t.reports.mailbox}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {emails.data?.map((e) => (
                  <Table.Tr key={e.id}>
                    <Table.Td>{formatDateTime(e.createdAt, me!.user.timezone)}</Table.Td>
                    <Table.Td>
                      <Anchor component={Link} to={`/tickets/${e.ticketId}`}>
                        #{e.ticketId}
                      </Anchor>
                    </Table.Td>
                    <Table.Td>{e.subject ?? e.ticketTitle}</Table.Td>
                    <Table.Td>{t.reports.directions[e.direction] ?? e.direction}</Table.Td>
                    <Table.Td>
                      <Badge
                        variant="light"
                        color={e.status === 'failed' ? 'red' : 'gray'}
                        title={e.error ?? undefined}
                      >
                        {t.email.statuses[e.status] ?? e.status}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{e.queue ?? t.reports.none}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        </Tabs.Panel>
      </Tabs>

      <Modal opened={!!drill} onClose={() => setDrill(null)} title={drill?.title ?? t.reports.drillTitle} size="lg">
        <Table>
          <Table.Tbody>
            {drilled.data?.map((tk) => (
              <Table.Tr key={tk.id}>
                <Table.Td>
                  <Anchor component={Link} to={`/tickets/${tk.id}`}>
                    #{tk.id} {tk.title}
                  </Anchor>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={STATE_COLOURS[tk.state]}>
                    {t.tickets.states[tk.state]}
                  </Badge>
                </Table.Td>
                <Table.Td>{formatDateTime(tk.createdAt, me!.user.timezone)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {drilled.data?.length === 0 && <Text c="dimmed">{t.crm.noResults}</Text>}
      </Modal>
    </Stack>
  );
}

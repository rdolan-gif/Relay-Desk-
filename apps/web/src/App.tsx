import {
  ActionIcon,
  AppShell,
  Burger,
  Center,
  Group,
  Loader,
  NavLink,
  Text,
  Title,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { ReportsPage } from './pages/reports/ReportsPage';
import { KbPage } from './pages/kb/KbPage';
import { KbArticlePage } from './pages/kb/KbArticlePage';
import { JobsPage } from './pages/JobsPage';
import { ImportPage } from './pages/crm/ImportPage';
import { DeletedItemsPage } from './pages/settings/DeletedItemsPage';
import { useDisclosure } from '@mantine/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { NavLink as RouterLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, setCsrfToken } from './api';
import { useAuth } from './auth';
import { t } from './i18n/en-GB';
import { AccountPage } from './pages/AccountPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { AccessProfilesPage } from './pages/settings/AccessProfilesPage';
import { AuditLogPage } from './pages/settings/AuditLogPage';
import { RightsProfilesPage } from './pages/settings/RightsProfilesPage';
import { UsersPage } from './pages/settings/UsersPage';
import { BrandLogo } from './components/BrandLogo';
import { GlobalSearch } from './components/GlobalSearch';
import { AccountPage as CrmAccountPage } from './pages/crm/AccountPage';
import { ContactPage } from './pages/crm/ContactPage';
import { AccountsPage, ContactsPage, RecordsPage } from './pages/crm/ListPages';
import { RecordPage } from './pages/crm/RecordPage';
import { TicketPage } from './pages/tickets/TicketPage';
import { TicketsPage } from './pages/tickets/TicketsPage';
import { CategoriesPage, StatusesPage, TeamViewsPage } from './pages/settings/TicketSettingsPages';
import { CustomFieldsPage } from './pages/settings/CustomFieldsPage';
import { MailboxesPage } from './pages/email/MailboxesPage';
import { NotificationBell } from './components/NotificationBell';
import { ReadyForEmail } from './components/ReadyForEmail';
import { MacrosPage } from './pages/settings/MacrosPage';
import { SlasPage, TimeGroupsPage } from './pages/settings/SlaPages';
import { NewEmailPage } from './pages/email/NewEmailPage';
import { RoutingRulesPage } from './pages/email/RoutingRulesPage';
import { TemplatesPage } from './pages/email/TemplatesPage';
import { CrmDatabasesPage, RecordTypesPage } from './pages/settings/CrmDatabasesPage';

export function App() {
  const { me, loading } = useAuth();
  if (loading) {
    return (
      <Center h="100vh">
        <Loader aria-label={t.common.loading} />
      </Center>
    );
  }
  if (!me) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }
  return <Shell />;
}

function Shell() {
  const { me, can } = useAuth();
  const [opened, { toggle }] = useDisclosure();
  const { toggleColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('light');
  const qc = useQueryClient();
  const location = useLocation();

  const logout = async () => {
    await api('POST', '/auth/logout');
    setCsrfToken(null);
    qc.clear();
    await qc.invalidateQueries({ queryKey: ['me'] });
  };

  const settingsLinks = [
    { to: '/settings/users', label: t.nav.users, module: 'settings_users' as const },
    { to: '/settings/access-profiles', label: t.nav.accessProfiles, module: 'settings_access_profiles' as const },
    { to: '/settings/rights-profiles', label: t.nav.rightsProfiles, module: 'settings_rights_profiles' as const },
    { to: '/settings/categories', label: t.nav.categories, module: 'settings_categories' as const },
    { to: '/settings/statuses', label: t.nav.statuses, module: 'settings_statuses' as const },
    { to: '/settings/ticket-views', label: t.nav.ticketViews, module: 'settings_ticket_views' as const },
    { to: '/settings/mailboxes', label: t.nav.mailboxes, module: 'settings_mailbox_queues' as const },
    { to: '/settings/email-routing', label: t.nav.emailRouting, module: 'settings_email_routing' as const },
    { to: '/settings/slas', label: t.nav.slas, module: 'settings_sla' as const },
    { to: '/settings/working-hours', label: t.nav.timeGroups, module: 'settings_time_groups' as const },
    { to: '/settings/macros', label: t.nav.macros, module: 'settings_macros' as const },
    { to: '/settings/custom-fields', label: t.nav.customFields, module: 'settings_custom_fields' as const },
    { to: '/settings/crm-databases', label: t.nav.crmDatabases, module: 'settings_crm_databases' as const },
    { to: '/settings/crm-record-types', label: t.nav.recordTypes, module: 'settings_crm_record_types' as const },
    { to: '/settings/audit-log', label: t.nav.auditLog, module: 'settings_audit_log' as const },
  ]
    .filter((l) => can(l.module, 'read'))
    .map((l): { to: string; label: string } => ({ to: l.to, label: l.label }))
    .concat(me!.user.type === 'administrator' ? [{ to: '/settings/deleted', label: t.nav.deleted }] : []);
  const crmLinks = [
    { to: '/crm/contacts', label: t.nav.contacts, module: 'crm_contacts' as const },
    { to: '/crm/accounts', label: t.nav.accounts, module: 'crm_accounts' as const },
    { to: '/crm/records', label: t.nav.records, module: 'crm_records' as const },
  ].filter((l) => can(l.module, 'read'));

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header style={{ borderBottom: '3px solid var(--mantine-color-amber-6)' }}>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
            <Group gap="sm" wrap="nowrap">
              <BrandLogo h={22} />
              <Title
                order={4}
                c={scheme === 'dark' ? 'ricoman.2' : 'ricoman.7'}
                visibleFrom="xs"
                style={{ whiteSpace: 'nowrap' }}
              >
                {t.appName}
              </Title>
            </Group>
          </Group>
          {(crmLinks.length > 0 || can('tickets', 'read')) && <GlobalSearch />}
          <Group>
            {can('tickets', 'read') && <ReadyForEmail />}
            <NotificationBell />
            <Text size="sm">{me!.user.name}</Text>
            <ActionIcon variant="default" size="lg" onClick={toggleColorScheme} aria-label={t.common.theme}>
              {scheme === 'dark' ? '☀' : '☾'}
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs" component="nav" aria-label="Main">
        <NavLink component={RouterLink} to="/" label={t.nav.home} active={location.pathname === '/'} />
        {can('tickets', 'read') && (
          <NavLink
            component={RouterLink}
            to="/tickets"
            label={t.nav.tickets}
            active={location.pathname.startsWith('/tickets')}
          />
        )}
        {can('tickets', 'read') && (
          <NavLink
            component={RouterLink}
            to="/templates"
            label={t.nav.templates}
            active={location.pathname === '/templates'}
          />
        )}
        {can('knowledge_base', 'read') && (
          <NavLink component={RouterLink} to="/kb" label={t.nav.kb} active={location.pathname.startsWith('/kb')} />
        )}
        {can('reporting', 'read') && (
          <NavLink
            component={RouterLink}
            to="/reports"
            label={t.nav.reporting}
            active={location.pathname === '/reports'}
          />
        )}
        {crmLinks.length > 0 && (
          <NavLink label={t.nav.crm} defaultOpened>
            {crmLinks.map((l) => (
              <NavLink
                key={l.to}
                component={RouterLink}
                to={l.to}
                label={l.label}
                active={location.pathname.startsWith(l.to)}
              />
            ))}
          </NavLink>
        )}
        <NavLink component={RouterLink} to="/account" label={t.nav.account} active={location.pathname === '/account'} />
        <NavLink component={RouterLink} to="/jobs" label={t.nav.jobs} active={location.pathname === '/jobs'} />
        {settingsLinks.length > 0 && (
          <NavLink label={t.nav.settings} defaultOpened>
            {settingsLinks.map((l) => (
              <NavLink
                key={l.to}
                component={RouterLink}
                to={l.to}
                label={l.label}
                active={location.pathname === l.to}
              />
            ))}
          </NavLink>
        )}
        <NavLink component="button" onClick={logout} label={t.nav.logout} />
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/settings/users" element={<UsersPage />} />
          <Route path="/settings/access-profiles" element={<AccessProfilesPage />} />
          <Route path="/settings/rights-profiles" element={<RightsProfilesPage />} />
          <Route path="/settings/audit-log" element={<AuditLogPage />} />
          <Route path="/settings/custom-fields" element={<CustomFieldsPage />} />
          <Route path="/settings/categories" element={<CategoriesPage />} />
          <Route path="/settings/statuses" element={<StatusesPage />} />
          <Route path="/settings/ticket-views" element={<TeamViewsPage />} />
          <Route path="/tickets" element={<TicketsPage />} />
          <Route path="/tickets/:id" element={<TicketPage />} />
          <Route path="/email/new" element={<NewEmailPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/settings/mailboxes" element={<MailboxesPage />} />
          <Route path="/settings/email-routing" element={<RoutingRulesPage />} />
          <Route path="/settings/slas" element={<SlasPage />} />
          <Route path="/settings/working-hours" element={<TimeGroupsPage />} />
          <Route path="/settings/macros" element={<MacrosPage />} />
          <Route path="/settings/deleted" element={<DeletedItemsPage />} />
          <Route path="/crm/import/:entity" element={<ImportPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/kb" element={<KbPage />} />
          <Route path="/kb/articles/:id" element={<KbArticlePage />} />
          <Route path="/kb/articles/:id/:mode" element={<KbArticlePage />} />
          <Route path="/settings/crm-databases" element={<CrmDatabasesPage />} />
          <Route path="/settings/crm-record-types" element={<RecordTypesPage />} />
          <Route path="/crm/contacts" element={<ContactsPage />} />
          <Route path="/crm/contacts/:id" element={<ContactPage />} />
          <Route path="/crm/accounts" element={<AccountsPage />} />
          <Route path="/crm/accounts/:id" element={<CrmAccountPage />} />
          <Route path="/crm/records" element={<RecordsPage />} />
          <Route path="/crm/records/:id" element={<RecordPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}

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
  useMantineColorScheme,
} from '@mantine/core';
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
    { to: '/settings/audit-log', label: t.nav.auditLog, module: 'settings_audit_log' as const },
  ].filter((l) => can(l.module, 'read'));

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Menu" />
            <Title order={4}>{t.appName}</Title>
          </Group>
          <Group>
            <Text size="sm">{me!.user.name}</Text>
            <ActionIcon variant="subtle" onClick={toggleColorScheme} aria-label={t.common.theme}>
              ◐
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs" component="nav" aria-label="Main">
        <NavLink component={RouterLink} to="/" label={t.nav.home} active={location.pathname === '/'} />
        <NavLink component={RouterLink} to="/account" label={t.nav.account} active={location.pathname === '/account'} />
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}

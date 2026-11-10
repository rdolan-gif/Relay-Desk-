import {
  Alert,
  Anchor,
  Button,
  Center,
  Divider,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError, api, setCsrfToken } from '../api';
import { useAuth } from '../auth';
import { BrandLogo } from '../components/BrandLogo';
import { t } from '../i18n/en-GB';

interface SignInOptions {
  google: boolean;
  googleDomain: string | null;
  password: 'all' | 'administrators' | 'none';
}

/** The error Google sign-in sent back (?signin_error=…), shown once and removed from the address. */
function takeSignInError(): string | null {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('signin_error');
  if (!code) return null;
  params.delete('signin_error');
  const rest = params.toString();
  window.history.replaceState(null, '', `${window.location.pathname}${rest ? `?${rest}` : ''}`);
  return t.login.errors[code] ?? t.login.errors.default!;
}

export function LoginPage() {
  const { refresh } = useAuth();
  const options = useQuery({
    queryKey: ['signin-options'],
    queryFn: () => api<SignInOptions>('GET', '/auth/options'),
    retry: false,
  });
  const google = options.data?.google ? options.data.googleDomain : null;
  const passwordMode = options.data?.password ?? 'all';
  const [showEmergency, setShowEmergency] = useState(false);
  const showPassword = !google || passwordMode === 'all' || (passwordMode === 'administrators' && showEmergency);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(takeSignInError);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ csrfToken: string }>('POST', '/auth/login', {
        email,
        password,
        totpCode: needTotp ? totpCode : undefined,
      });
      setCsrfToken(res.csrfToken);
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.body.reason === 'totp_required') {
        setNeedTotp(true);
      } else {
        setError(err instanceof Error ? err.message : t.common.error);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Center h="100vh" p="md">
      <Paper withBorder p="xl" w={380} component="main" style={{ borderTop: '4px solid var(--mantine-color-amber-6)' }}>
        <Stack>
          <BrandLogo h={40} />
          <Title order={2}>{t.login.title}</Title>
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          {google && (
            <>
              <Button component="a" href="/api/auth/google/start" size="md">
                {t.login.google(google)}
              </Button>
              <Text size="sm" c="dimmed">
                {t.login.googleHelp}
              </Text>
            </>
          )}
          {google && passwordMode === 'administrators' && !showEmergency && (
            <Anchor component="button" type="button" size="sm" onClick={() => setShowEmergency(true)}>
              {t.login.emergency}
            </Anchor>
          )}
          {google && showPassword && <Divider label={passwordMode === 'all' ? t.login.or : t.login.emergency} />}
          {google && passwordMode === 'administrators' && showEmergency && (
            <Text size="sm" c="dimmed">
              {t.login.emergencyHelp}
            </Text>
          )}
        </Stack>
        {showPassword && (
          <form onSubmit={submit}>
            <Stack mt="md">
              <TextInput
                label={t.login.email}
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
              <PasswordInput
                label={t.login.password}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
              />
              {needTotp && (
                <TextInput
                  label={t.login.totp}
                  description={t.login.totpHelp}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  autoFocus
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.currentTarget.value)}
                />
              )}
              <Button type="submit" loading={busy}>
                {t.login.submit}
              </Button>
            </Stack>
          </form>
        )}
      </Paper>
    </Center>
  );
}

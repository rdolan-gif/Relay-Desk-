import { Alert, Button, Center, Paper, PasswordInput, Stack, TextInput, Title } from '@mantine/core';
import { useState, type FormEvent } from 'react';
import { ApiError, api, setCsrfToken } from '../api';
import { useAuth } from '../auth';
import { t } from '../i18n/en-GB';

export function LoginPage() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      <Paper withBorder p="xl" w={380} component="main">
        <form onSubmit={submit}>
          <Stack>
            <Title order={2}>{t.login.title}</Title>
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
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
      </Paper>
    </Center>
  );
}

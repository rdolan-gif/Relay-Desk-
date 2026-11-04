import {
  Alert,
  Button,
  Code,
  Group,
  Image,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import QRCode from 'qrcode';
import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { formatDateTime } from '../format';
import { t } from '../i18n/en-GB';
import { notifyError, notifyOk } from '../notify';

export function AccountPage() {
  return (
    <Stack maw={560}>
      <Title order={2}>{t.account.title}</Title>
      <SignatureSection />
      <PasswordSection />
      <TotpSection />
      <ApiTokenSection />
    </Stack>
  );
}

/** Each person's sign-off for replies (owner answer Q13). */
function SignatureSection() {
  const { me, refresh } = useAuth();
  const [value, setValue] = useState(me!.user.hasCustomSignature ? me!.user.signature : '');
  const save = async () => {
    try {
      await api('PATCH', '/auth/me', { signature: value.trim() ? value : null });
      await refresh();
      notifyOk();
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <Paper withBorder p="md" component="section" aria-labelledby="sig-h">
      <Stack>
        <Title order={3} id="sig-h">
          {t.account.signatureTitle}
        </Title>
        <Textarea
          label={t.account.signatureTitle}
          description={t.account.signatureHelp}
          autosize
          minRows={3}
          placeholder={me!.user.signature}
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
        />
        <Group>
          <Button onClick={save}>{t.account.saveSignature}</Button>
        </Group>
      </Stack>
    </Paper>
  );
}

function PasswordSection() {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const save = async () => {
    try {
      await api('POST', '/auth/password', { currentPassword, newPassword });
      setCurrent('');
      setNew('');
      notifyOk(t.account.passwordChanged);
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <Paper withBorder p="md" component="section" aria-labelledby="pw-h">
      <Stack>
        <Title order={3} id="pw-h">
          {t.account.password}
        </Title>
        <PasswordInput
          label={t.account.currentPassword}
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrent(e.currentTarget.value)}
        />
        <PasswordInput
          label={t.account.newPassword}
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNew(e.currentTarget.value)}
        />
        <Group>
          <Button onClick={save} disabled={!currentPassword || !newPassword}>
            {t.account.savePassword}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}

function TotpSection() {
  const { me, refresh } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  const start = async () => {
    try {
      const res = await api<{ secret: string; otpauthUri: string }>('POST', '/auth/totp/setup');
      setSetup({ secret: res.secret, qr: await QRCode.toDataURL(res.otpauthUri) });
    } catch (err) {
      notifyError(err);
    }
  };
  const confirm = async () => {
    try {
      await api('POST', '/auth/totp/confirm', { code });
      setSetup(null);
      setCode('');
      await refresh();
      notifyOk();
    } catch (err) {
      notifyError(err);
    }
  };
  const disable = async () => {
    try {
      await api('POST', '/auth/totp/disable', { password, code });
      setCode('');
      setPassword('');
      await refresh();
      notifyOk();
    } catch (err) {
      notifyError(err);
    }
  };

  return (
    <Paper withBorder p="md" component="section" aria-labelledby="totp-h">
      <Stack>
        <Title order={3} id="totp-h">
          {t.account.totpTitle}
        </Title>
        <Text>{me!.user.totpEnabled ? t.account.totpOn : t.account.totpOff}</Text>
        {!me!.user.totpEnabled && !setup && (
          <Group>
            <Button onClick={start}>{t.account.totpStart}</Button>
          </Group>
        )}
        {setup && (
          <>
            <Text size="sm">{t.account.totpScan}</Text>
            <Image src={setup.qr} w={180} h={180} alt="QR code for your authenticator app" />
            <Code>{setup.secret}</Code>
            <TextInput
              label={t.login.totp}
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
            />
            <Group>
              <Button onClick={confirm} disabled={code.length !== 6}>
                {t.account.totpConfirm}
              </Button>
            </Group>
          </>
        )}
        {me!.user.totpEnabled && (
          <>
            <PasswordInput
              label={t.login.password}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <TextInput
              label={t.login.totp}
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
            />
            <Group>
              <Button color="red" variant="light" onClick={disable} disabled={!password || code.length !== 6}>
                {t.account.totpDisable}
              </Button>
            </Group>
          </>
        )}
      </Stack>
    </Paper>
  );
}

function ApiTokenSection() {
  const { me, refresh } = useAuth();
  const [token, setToken] = useState<string | null>(null);
  const create = async () => {
    try {
      setToken((await api<{ token: string }>('POST', '/auth/api-token')).token);
      await refresh();
    } catch (err) {
      notifyError(err);
    }
  };
  const revoke = async () => {
    try {
      await api('DELETE', '/auth/api-token');
      setToken(null);
      await refresh();
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <Paper withBorder p="md" component="section" aria-labelledby="api-h">
      <Stack>
        <Title order={3} id="api-h">
          {t.account.apiTitle}
        </Title>
        <Text size="sm">{t.account.apiHelp}</Text>
        <Text>
          {me!.user.apiTokenCreatedAt
            ? t.account.apiExists(formatDateTime(me!.user.apiTokenCreatedAt, me!.user.timezone))
            : t.account.apiNone}
        </Text>
        {token && (
          <Alert color="green">
            <Code block>{token}</Code>
          </Alert>
        )}
        <Group>
          <Button onClick={create}>{t.account.apiCreate}</Button>
          {me!.user.apiTokenCreatedAt && (
            <Button color="red" variant="light" onClick={revoke}>
              {t.account.apiRevoke}
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}

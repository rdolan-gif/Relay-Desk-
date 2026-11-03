import { Stack, Text, Title } from '@mantine/core';
import { useAuth } from '../auth';
import { t } from '../i18n/en-GB';

export function HomePage() {
  const { me } = useAuth();
  return (
    <Stack>
      <Title order={2}>{t.home.welcome(me!.user.name)}</Title>
      <Text>{t.home.phase0}</Text>
    </Stack>
  );
}

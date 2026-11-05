import { Button, Group, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { t } from '../i18n/en-GB';

/** Start page: a greeting and the places people go most. */
export function HomePage() {
  const { me, can } = useAuth();
  return (
    <Stack maw={720}>
      <Title order={2}>{t.home.welcome(me!.user.name)}</Title>
      <Text>{t.home.intro}</Text>
      <Group>
        {can('tickets', 'read') && (
          <Button component={Link} to="/tickets">
            {t.home.tickets}
          </Button>
        )}
        {can('tickets', 'update') && (
          <Button component={Link} to="/email/new" variant="default">
            {t.home.newEmail}
          </Button>
        )}
        {can('knowledge_base', 'read') && (
          <Button component={Link} to="/kb" variant="default">
            {t.home.kb}
          </Button>
        )}
        {can('reporting', 'read') && (
          <Button component={Link} to="/reports" variant="default">
            {t.home.reports}
          </Button>
        )}
      </Group>
      {can('tickets', 'read') && (
        <Text size="sm" c="dimmed">
          {t.home.ready}
        </Text>
      )}
    </Stack>
  );
}

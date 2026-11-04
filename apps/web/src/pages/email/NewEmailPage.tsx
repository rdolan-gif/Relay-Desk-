import { Stack, Title } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { EmailComposer } from '../../email/EmailComposer';
import { t } from '../../i18n/en-GB';

/** A new email not linked to a ticket; sending creates the ticket (spec 6.3). */
export function NewEmailPage() {
  const nav = useNavigate();
  return (
    <Stack maw={900}>
      <Title order={2}>{t.email.newEmail}</Title>
      <EmailComposer mode="new" onSent={(r) => nav(`/tickets/${r.ticketId}`)} onCancel={() => nav('/tickets')} />
    </Stack>
  );
}

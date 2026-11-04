import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { useEffect, useState } from 'react';
import { t } from '../i18n/en-GB';

/** A destructive action the user confirms by typing a phrase (spec 14, GDPR). */
export function ConfirmTyped(props: {
  opened: boolean;
  title: string;
  help: string;
  phrase: string;
  loading?: boolean;
  onClose: () => void;
  onConfirm: (typed: string) => void;
}) {
  const [typed, setTyped] = useState('');
  useEffect(() => setTyped(''), [props.opened]);
  return (
    <Modal opened={props.opened} onClose={props.onClose} title={props.title}>
      <Stack>
        <Alert color="red" variant="light">
          <Text size="sm">{props.help}</Text>
        </Alert>
        <TextInput
          label={t.gdpr.typeToConfirm(props.phrase)}
          value={typed}
          onChange={(e) => setTyped(e.currentTarget.value)}
          data-autofocus
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={props.onClose}>
            {t.common.cancel}
          </Button>
          <Button
            color="red"
            disabled={typed.trim() !== props.phrase}
            loading={props.loading}
            onClick={() => props.onConfirm(typed)}
          >
            {t.gdpr.confirm}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

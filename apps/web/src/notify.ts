import { notifications } from '@mantine/notifications';
import { t } from './i18n/en-GB';

export const notifyError = (err: unknown) =>
  notifications.show({
    color: 'red',
    title: t.common.error,
    message: err instanceof Error ? err.message : String(err),
  });

export const notifyOk = (message: string = t.common.saved) => notifications.show({ color: 'teal', message });

import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { DatesProvider } from '@mantine/dates';
import dayjs from 'dayjs';
import 'dayjs/locale/en-gb';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth';

dayjs.locale('en-gb');

/**
 * Ricoman brand: blue #004a98 (primary, darker #0043a0) with amber #ef9e06 as the accent,
 * on near-white #fefefe. Shade 6 is the exact brand colour.
 */
const theme = createTheme({
  primaryColor: 'ricoman',
  primaryShade: { light: 6, dark: 4 },
  white: '#fefefe',
  colors: {
    ricoman: [
      '#e6eef8',
      '#ccdcf0',
      '#99b9e1',
      '#6696d2',
      '#3373c3',
      '#0d5aad',
      '#004a98',
      '#0043a0',
      '#00346b',
      '#002955',
    ],
    amber: [
      '#fff6e3',
      '#ffecc2',
      '#fcd98a',
      '#f8c552',
      '#f4b228',
      '#f1a514',
      '#ef9e06',
      '#d48b02',
      '#bd7b00',
      '#a36a00',
    ],
  },
  defaultRadius: 'sm',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  headings: { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif', fontWeight: '700' },
});
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <DatesProvider settings={{ locale: 'en-gb', firstDayOfWeek: 1 }}>
        <Notifications />
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </DatesProvider>
    </MantineProvider>
  </StrictMode>,
);

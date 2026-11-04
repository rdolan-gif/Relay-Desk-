import { DatePickerInput, DateTimePicker } from '@mantine/dates';
import '@mantine/dates/styles.css';

type Common = { label: string; disabled?: boolean; required?: boolean; error?: string; description?: string };

const pad = (n: number) => String(n).padStart(2, '0');
/** ISO instant -> local "YYYY-MM-DD HH:mm:ss" (Mantine Dates v8 value format). */
const isoToLocal = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
};
const localToIso = (v: string | null) => (v ? new Date(v.replace(' ', 'T')).toISOString() : null);

/** Date and time in DD/MM/YYYY HH:mm (spec 18), stored as an ISO instant. */
export function DateTimeField(props: Common & { value: string | null; onChange: (iso: string | null) => void }) {
  return (
    <DateTimePicker
      label={props.label}
      description={props.description}
      disabled={props.disabled}
      required={props.required}
      error={props.error}
      valueFormat="DD/MM/YYYY HH:mm"
      placeholder="DD/MM/YYYY HH:mm"
      clearable
      value={isoToLocal(props.value)}
      onChange={(v) => props.onChange(localToIso(v))}
    />
  );
}

/** Calendar date in DD/MM/YYYY, stored as "YYYY-MM-DD". */
export function DateField(props: Common & { value: string | null; onChange: (date: string | null) => void }) {
  return (
    <DatePickerInput
      label={props.label}
      description={props.description}
      disabled={props.disabled}
      required={props.required}
      error={props.error}
      valueFormat="DD/MM/YYYY"
      placeholder="DD/MM/YYYY"
      clearable
      value={props.value}
      onChange={(v) => props.onChange(v)}
    />
  );
}

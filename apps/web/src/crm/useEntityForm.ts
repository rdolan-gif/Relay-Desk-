import { useState } from 'react';
import { ApiError } from '../api';
import { notifyError } from '../notify';

/** Turns a 400 invalid_form response into per-field messages; anything else becomes a toast. */
export function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const handle = (err: unknown) => {
    if (err instanceof ApiError && Array.isArray((err.body as { fieldErrors?: unknown }).fieldErrors)) {
      const list = (err.body as { fieldErrors: { fieldId: string | null; message: string }[] }).fieldErrors;
      setErrors(Object.fromEntries(list.filter((e) => e.fieldId).map((e) => [e.fieldId!, e.message])));
    } else {
      setErrors({});
    }
    notifyError(err);
  };
  return { errors, clear: () => setErrors({}), handle };
}

import { BadRequestException } from '@nestjs/common';
import type { FormInputError } from '@relay-desk/domain';

export function formError(errors: FormInputError[] | string[], reason = 'invalid_form'): BadRequestException {
  const list = errors.map((e) => (typeof e === 'string' ? { fieldId: null, code: 'invalid', message: e } : e));
  return new BadRequestException({ message: list.map((e) => e.message).join(' '), reason, fieldErrors: list });
}

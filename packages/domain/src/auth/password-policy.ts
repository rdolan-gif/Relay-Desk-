import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';

let factory: ZxcvbnFactory | null = null;
/** Built lazily: the dictionaries are large and most importers never check passwords. */
function zxcvbn(): ZxcvbnFactory {
  factory ??= new ZxcvbnFactory({
    dictionary: { ...common.dictionary, ...en.dictionary },
    graphs: common.adjacencyGraphs,
    translations: en.translations,
  });
  return factory;
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
/** zxcvbn score from 0 (weak) to 4 (strong). */
export const PASSWORD_MIN_SCORE = 3;

export type PasswordCheck = { ok: true } | { ok: false; problems: string[] };

/**
 * When a password is set, the system enforces strength: 12-128 characters and a
 * zxcvbn score of at least 3, taking the user's own name and email into account
 * (spec 4, "Authentication"; OWASP ASVS 2.1).
 */
export function checkPasswordStrength(password: string, userInputs: readonly string[] = []): PasswordCheck {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`Password must be at most ${PASSWORD_MAX_LENGTH} characters.`);
  }
  if (problems.length === 0) {
    const inputs = userInputs.flatMap((s) => [s, ...s.split(/[@\s.]+/)]).filter((s) => s.length > 2);
    const result = zxcvbn().check(password, inputs);
    if (result.score < PASSWORD_MIN_SCORE) {
      problems.push(
        result.feedback.warning
          ? `Password is too easy to guess: ${result.feedback.warning}`
          : 'Password is too easy to guess.',
      );
    }
  }
  return problems.length ? { ok: false, problems } : { ok: true };
}

import { describe, expect, it } from 'vitest';
import { checkUserChange, deactivationEffects, normaliseEmail } from './user-rules.js';
import {
  userTypeCanSendExternalCommunication,
  userTypeCanUseInternalApp,
  userTypeCanUseSettings,
  userTypeConsumesSeat,
} from './user-type.js';

describe('user type rules (spec 4)', () => {
  it("when an admin changes a user's type while that user is logged in, the system refuses", () => {
    expect(
      checkUserChange({
        actorId: 'admin',
        targetId: 'u',
        currentType: 'agent',
        newType: 'back_office',
        targetHasActiveSession: true,
      }),
    ).toMatchObject({ allowed: false, code: 'type_change_while_logged_in' });
  });

  it('when the user is logged out, changing their type is allowed', () => {
    expect(
      checkUserChange({
        actorId: 'admin',
        targetId: 'u',
        currentType: 'agent',
        newType: 'back_office',
        targetHasActiveSession: false,
      }),
    ).toEqual({ allowed: true });
  });

  it('setting the same type while logged in is not a type change', () => {
    expect(
      checkUserChange({
        actorId: 'admin',
        targetId: 'u',
        currentType: 'agent',
        newType: 'agent',
        targetHasActiveSession: true,
      }),
    ).toEqual({ allowed: true });
  });

  it('when an admin tries to deactivate themselves, the system refuses', () => {
    expect(
      checkUserChange({
        actorId: 'a',
        targetId: 'a',
        currentType: 'administrator',
        newIsActive: false,
        targetHasActiveSession: true,
      }),
    ).toMatchObject({ allowed: false, code: 'self_lockout' });
  });

  it('when a user is deactivated, the system revokes sessions and API token and removes them as follower', () => {
    expect(deactivationEffects()).toEqual({
      revokeSessions: true,
      revokeApiToken: true,
      removeAsFollower: true,
    });
  });

  it('only administrators may use Settings', () => {
    expect(userTypeCanUseSettings('administrator')).toBe(true);
    expect(userTypeCanUseSettings('agent')).toBe(false);
    expect(userTypeCanUseSettings('back_office')).toBe(false);
    expect(userTypeCanUseSettings('external')).toBe(false);
  });

  it('back-office users cannot send external communication', () => {
    expect(userTypeCanSendExternalCommunication('back_office')).toBe(false);
    expect(userTypeCanSendExternalCommunication('agent')).toBe(true);
    expect(userTypeCanSendExternalCommunication('administrator')).toBe(true);
    expect(userTypeCanSendExternalCommunication('external')).toBe(false);
  });

  it('external users never use the internal app and never consume a seat', () => {
    expect(userTypeCanUseInternalApp('external')).toBe(false);
    expect(userTypeConsumesSeat('external')).toBe(false);
    expect(userTypeConsumesSeat('agent')).toBe(true);
  });

  it('emails are normalised to lower-case and trimmed', () => {
    expect(normaliseEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com');
  });
});

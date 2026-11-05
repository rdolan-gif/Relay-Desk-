/** User types (spec 4, "User types"). */
export const USER_TYPES = ['agent', 'back_office', 'administrator', 'external'] as const;
export type UserType = (typeof USER_TYPES)[number];

export function isUserType(value: string): value is UserType {
  return (USER_TYPES as readonly string[]).includes(value);
}

/** Only Administrators may open the Settings area (subject to their access profile). */
export function userTypeCanUseSettings(type: UserType): boolean {
  return type === 'administrator';
}

/** External users log in to the portal only; never the internal app or API. */
export function userTypeCanUseInternalApp(type: UserType): boolean {
  return type !== 'external';
}

/** Back-office users work tickets internally but cannot send external communication. */
export function userTypeCanSendExternalCommunication(type: UserType): boolean {
  return type === 'agent' || type === 'administrator';
}

/** External users never consume an internal seat. */
export function userTypeConsumesSeat(type: UserType): boolean {
  return type !== 'external';
}

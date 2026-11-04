/** Category rights: Access (can see tickets) and Distribution limit (spec 4, 9). */
export interface CategoryRight {
  categoryId: string;
  access: boolean;
  /** Hand new mailbox tickets in this category out automatically (spec 9). */
  distribute: boolean;
  /** Most Open tickets at once; null = no cap (owner O-16). */
  distributionLimit: number | null;
}

export interface TicketRights {
  /** 'all' = every category with Access = Yes and no distribution limit. */
  categories: 'all' | readonly CategoryRight[];
  /** Team views shown in the user's sidebar. */
  ticketViews: 'all' | readonly string[];
  /** Mailboxes the user can send from and is "logged in to" for distribution (spec 4). */
  mailboxes: 'all' | readonly string[];
  /** Macros the user may run (spec 10, "Availability"). */
  macros: 'all' | readonly string[];
}

export function canUseMacro(rights: TicketRights, macroId: string): boolean {
  return rights.macros === 'all' || rights.macros.includes(macroId);
}

export function canUseMailbox(rights: TicketRights, queueId: string): boolean {
  return rights.mailboxes === 'all' || rights.mailboxes.includes(queueId);
}

/** A user can create tickets in any category in their rights, regardless of Access. */
export function canCreateInCategory(rights: TicketRights, categoryId: string): boolean {
  return rights.categories === 'all' || rights.categories.some((c) => c.categoryId === categoryId);
}

/**
 * A user can see tickets in a category only with Access = Yes. With Access = No they can
 * create a ticket there but not see it after saving (spec 4).
 */
export function canSeeCategory(rights: TicketRights, categoryId: string): boolean {
  return rights.categories === 'all' || rights.categories.some((c) => c.categoryId === categoryId && c.access);
}

export function visibleCategoryIds(rights: TicketRights): 'all' | string[] {
  return rights.categories === 'all' ? 'all' : rights.categories.filter((c) => c.access).map((c) => c.categoryId);
}

export function canSeeTeamView(rights: TicketRights, viewId: string): boolean {
  return rights.ticketViews === 'all' || rights.ticketViews.includes(viewId);
}

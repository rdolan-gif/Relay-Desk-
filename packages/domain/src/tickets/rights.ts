/** Category rights: Access (can see tickets) and Distribution limit (spec 4, 9). */
export interface CategoryRight {
  categoryId: string;
  access: boolean;
  distributionLimit: number | null;
}

export interface TicketRights {
  /** 'all' = every category with Access = Yes and no distribution limit. */
  categories: 'all' | readonly CategoryRight[];
  /** Team views shown in the user's sidebar. */
  ticketViews: 'all' | readonly string[];
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

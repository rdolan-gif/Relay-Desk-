import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { normaliseAccessProfile, type Principal, type RightsProfile, type TicketRights } from '@relay-desk/domain';
import { DB, type Db, type DbOrTx } from '../db/db';
import {
  accessProfiles,
  rightsProfileCategories,
  rightsProfileTicketViews,
  rightsProfileMailboxes,
  rightsProfileMacros,
  rightsProfileCrmDatabases,
  rightsProfileCrmRecordTypes,
  rightsProfileEditableAccessProfiles,
  rightsProfileEditableRightsProfiles,
  rightsProfileVisibleUsers,
  rightsProfiles,
  users,
} from '../db/schema';

export type UserRow = typeof users.$inferSelect;

export const NO_TICKET_RIGHTS: TicketRights = { categories: [], ticketViews: [], mailboxes: [], macros: [] };

const NO_RIGHTS: RightsProfile = {
  userVisibility: 'selected',
  visibleUserIds: [],
  editableAccessProfiles: [],
  editableRightsProfiles: [],
  crmDatabases: [],
  crmRecordTypes: [],
};

/**
 * Loads a user's effective permissions fresh from the database. Called on every
 * request so that profile changes take effect on the user's next request (spec 4).
 */
@Injectable()
export class PermissionsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async load(
    userId: string,
    tx: DbOrTx = this.db,
  ): Promise<{
    user: UserRow;
    principal: Principal;
    rights: RightsProfile;
    ticketRights: TicketRights;
  } | null> {
    const [user] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)));
    if (!user) return null;

    let access = normaliseAccessProfile({});
    if (user.accessProfileId) {
      const [ap] = await tx
        .select()
        .from(accessProfiles)
        .where(and(eq(accessProfiles.id, user.accessProfileId), isNull(accessProfiles.deletedAt)));
      if (ap) access = normaliseAccessProfile({ modules: ap.modules, flags: ap.flags });
    }

    const rights = user.rightsProfileId ? await this.loadRights(user.rightsProfileId, tx) : NO_RIGHTS;
    const ticketRights = user.rightsProfileId
      ? await this.loadTicketRights(user.rightsProfileId, tx)
      : NO_TICKET_RIGHTS;

    return {
      user,
      principal: { userId: user.id, type: user.type, isActive: user.isActive, access },
      rights: rights ?? NO_RIGHTS,
      ticketRights,
    };
  }

  /** Category rights (Access + distribution limit) and visible team views (spec 4). */
  async loadTicketRights(rightsProfileId: string, tx: DbOrTx = this.db): Promise<TicketRights> {
    const [rp] = await tx.select().from(rightsProfiles).where(eq(rightsProfiles.id, rightsProfileId));
    if (!rp || rp.deletedAt) return NO_TICKET_RIGHTS;
    const cats = rp.allCategories
      ? 'all'
      : (await tx.select().from(rightsProfileCategories).where(eq(rightsProfileCategories.rightsProfileId, rp.id))).map(
          (c) => ({
            categoryId: c.categoryId,
            access: c.access,
            distribute: c.distribute,
            distributionLimit: c.distributionLimit,
          }),
        );
    const views = rp.allTicketViews
      ? 'all'
      : (
          await tx
            .select({ id: rightsProfileTicketViews.viewId })
            .from(rightsProfileTicketViews)
            .where(eq(rightsProfileTicketViews.rightsProfileId, rp.id))
        ).map((v) => v.id);
    const mailboxes = rp.allMailboxes
      ? 'all'
      : (
          await tx
            .select({ id: rightsProfileMailboxes.queueId })
            .from(rightsProfileMailboxes)
            .where(eq(rightsProfileMailboxes.rightsProfileId, rp.id))
        ).map((m) => m.id);
    const macroIds = rp.allMacros
      ? 'all'
      : (
          await tx
            .select({ id: rightsProfileMacros.macroId })
            .from(rightsProfileMacros)
            .where(eq(rightsProfileMacros.rightsProfileId, rp.id))
        ).map((m) => m.id);
    return { categories: cats, ticketViews: views, mailboxes, macros: macroIds };
  }

  async loadRights(rightsProfileId: string, tx: DbOrTx = this.db): Promise<RightsProfile | null> {
    const [rp] = await tx
      .select()
      .from(rightsProfiles)
      .where(and(eq(rightsProfiles.id, rightsProfileId), isNull(rightsProfiles.deletedAt)));
    if (!rp) return null;
    // Sequential on purpose: `tx` may be a single transaction client.
    const visible = await tx
      .select({ id: rightsProfileVisibleUsers.userId })
      .from(rightsProfileVisibleUsers)
      .where(eq(rightsProfileVisibleUsers.rightsProfileId, rp.id));
    const editableAp = rp.editAllAccessProfiles
      ? []
      : await tx
          .select({ id: rightsProfileEditableAccessProfiles.accessProfileId })
          .from(rightsProfileEditableAccessProfiles)
          .where(eq(rightsProfileEditableAccessProfiles.rightsProfileId, rp.id));
    const editableRp = rp.editAllRightsProfiles
      ? []
      : await tx
          .select({ id: rightsProfileEditableRightsProfiles.editableRightsProfileId })
          .from(rightsProfileEditableRightsProfiles)
          .where(eq(rightsProfileEditableRightsProfiles.rightsProfileId, rp.id));
    const crmDbs = rp.allCrmDatabases
      ? []
      : await tx
          .select({ id: rightsProfileCrmDatabases.crmDatabaseId })
          .from(rightsProfileCrmDatabases)
          .where(eq(rightsProfileCrmDatabases.rightsProfileId, rp.id));
    const crmTypes = rp.allCrmRecordTypes
      ? []
      : await tx
          .select({ id: rightsProfileCrmRecordTypes.crmRecordTypeId })
          .from(rightsProfileCrmRecordTypes)
          .where(eq(rightsProfileCrmRecordTypes.rightsProfileId, rp.id));
    return {
      crmDatabases: rp.allCrmDatabases ? 'all' : crmDbs.map((r) => r.id),
      crmRecordTypes: rp.allCrmRecordTypes ? 'all' : crmTypes.map((r) => r.id),
      userVisibility: rp.userVisibility,
      visibleUserIds: visible.map((r) => r.id),
      editableAccessProfiles: rp.editAllAccessProfiles ? 'all' : editableAp.map((r) => r.id),
      editableRightsProfiles: rp.editAllRightsProfiles ? 'all' : editableRp.map((r) => r.id),
    };
  }
}

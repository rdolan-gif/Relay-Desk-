import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { normaliseAccessProfile, type Principal, type RightsProfile } from '@relay-desk/domain';
import { DB, type Db, type DbOrTx } from '../db/db';
import {
  accessProfiles,
  rightsProfileEditableAccessProfiles,
  rightsProfileEditableRightsProfiles,
  rightsProfileVisibleUsers,
  rightsProfiles,
  users,
} from '../db/schema';

export type UserRow = typeof users.$inferSelect;

const NO_RIGHTS: RightsProfile = {
  userVisibility: 'selected',
  visibleUserIds: [],
  editableAccessProfiles: [],
  editableRightsProfiles: [],
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

    return {
      user,
      principal: { userId: user.id, type: user.type, isActive: user.isActive, access },
      rights: rights ?? NO_RIGHTS,
    };
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
    return {
      userVisibility: rp.userVisibility,
      visibleUserIds: visible.map((r) => r.id),
      editableAccessProfiles: rp.editAllAccessProfiles ? 'all' : editableAp.map((r) => r.id),
      editableRightsProfiles: rp.editAllRightsProfiles ? 'all' : editableRp.map((r) => r.id),
    };
  }
}

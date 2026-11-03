import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  canCreateProfiles,
  canManageAccessProfile,
  canManageRightsProfile,
  diffFields,
  grantsBeyondActor,
  normaliseAccessProfile,
  type AccessFlagMap,
  type ModuleAccessMap,
} from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from '../common/db-errors';
import type { AuthContext } from '../common/request-context';
import { DB, type Db, type DbOrTx } from '../db/db';
import {
  accessProfiles,
  categories,
  crmDatabases,
  crmRecordTypes,
  rightsProfileCategories,
  rightsProfileTicketViews,
  rightsProfileCrmDatabases,
  rightsProfileCrmRecordTypes,
  rightsProfileEditableAccessProfiles,
  rightsProfileEditableRightsProfiles,
  rightsProfileVisibleUsers,
  rightsProfiles,
  users,
} from '../db/schema';
import { PermissionsService } from '../auth/permissions.service';

export interface AccessProfileInput {
  name: string;
  description?: string;
  modules: Record<string, Partial<Record<'enabled' | 'create' | 'read' | 'update' | 'delete', boolean>>>;
  flags: Record<string, boolean>;
}

export interface RightsProfileInput {
  name: string;
  description?: string;
  userVisibility: 'all' | 'selected';
  visibleUserIds: string[];
  editableAccessProfiles: 'all' | string[];
  editableRightsProfiles: 'all' | string[];
  crmDatabases: 'all' | string[];
  crmRecordTypes: 'all' | string[];
  categories: 'all' | { categoryId: string; access: boolean; distributionLimit: number | null }[];
  ticketViews: 'all' | string[];
}

const forbidden = (message: string, reason: string) => new ForbiddenException({ message, reason });

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
  ) {}

  // ---------- Access profiles ----------

  async listAccess(auth: AuthContext) {
    const rows = await this.db
      .select()
      .from(accessProfiles)
      .where(isNull(accessProfiles.deletedAt))
      .orderBy(accessProfiles.name);
    return rows.filter((r) => canManageAccessProfile(auth.rights, r.id)).map(publicAccess);
  }

  async getAccess(auth: AuthContext, id: string) {
    return publicAccess(await this.findAccess(auth, id));
  }

  async createAccess(auth: AuthContext, input: AccessProfileInput, ip: string | null) {
    if (!canCreateProfiles(auth.rights, 'access')) {
      throw forbidden('You may not create access profiles.', 'profile_not_editable');
    }
    const profile = this.checkGrants(auth, input);
    return this.db
      .transaction(async (tx) => {
        const [row] = await tx
          .insert(accessProfiles)
          .values({ name: input.name, description: input.description ?? '', ...profile })
          .returning();
        await this.audit.record(
          {
            eventType: 'access_profile.created',
            actorUserId: auth.user.id,
            ip,
            targetType: 'access_profile',
            targetId: row!.id,
            changes: diffFields({}, publicAccess(row!)),
          },
          tx,
        );
        return publicAccess(row!);
      })
      .catch(uniqueName);
  }

  async updateAccess(auth: AuthContext, id: string, input: AccessProfileInput, ip: string | null) {
    const before = await this.findAccess(auth, id);
    const profile = this.checkGrants(auth, input);
    return this.db
      .transaction(async (tx) => {
        const [row] = await tx
          .update(accessProfiles)
          .set({ name: input.name, description: input.description ?? '', ...profile, updatedAt: new Date() })
          .where(eq(accessProfiles.id, id))
          .returning();
        await this.audit.record(
          {
            eventType: 'access_profile.updated',
            actorUserId: auth.user.id,
            ip,
            targetType: 'access_profile',
            targetId: id,
            changes: diffFields(publicAccess(before), publicAccess(row!)),
          },
          tx,
        );
        return publicAccess(row!);
      })
      .catch(uniqueName);
  }

  async deleteAccess(auth: AuthContext, id: string, ip: string | null) {
    await this.findAccess(auth, id);
    await this.db.transaction(async (tx) => {
      const inUse = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.accessProfileId, id), isNull(users.deletedAt)))
        .limit(1);
      if (inUse.length)
        throw new ConflictException({ message: 'This profile is assigned to users.', reason: 'profile_in_use' });
      await tx.update(accessProfiles).set({ deletedAt: new Date() }).where(eq(accessProfiles.id, id));
      await this.audit.record(
        {
          eventType: 'access_profile.deleted',
          actorUserId: auth.user.id,
          ip,
          targetType: 'access_profile',
          targetId: id,
        },
        tx,
      );
    });
  }

  private async findAccess(auth: AuthContext, id: string) {
    const [row] = await this.db
      .select()
      .from(accessProfiles)
      .where(and(eq(accessProfiles.id, id), isNull(accessProfiles.deletedAt)));
    if (!row || !canManageAccessProfile(auth.rights, id)) throw new NotFoundException();
    return row;
  }

  private checkGrants(auth: AuthContext, input: AccessProfileInput) {
    const profile = normaliseAccessProfile(input);
    const excess = grantsBeyondActor(auth.principal.access, profile);
    if (excess.length) {
      throw new ForbiddenException({
        message: `You cannot grant access you do not hold yourself: ${excess.join(', ')}.`,
        reason: 'privilege_escalation',
        excess,
      });
    }
    return profile;
  }

  // ---------- Rights profiles ----------

  async listRights(auth: AuthContext) {
    const rows = await this.db
      .select()
      .from(rightsProfiles)
      .where(isNull(rightsProfiles.deletedAt))
      .orderBy(rightsProfiles.name);
    const visible = rows.filter((r) => canManageRightsProfile(auth.rights, r.id));
    return Promise.all(visible.map((r) => this.publicRights(r)));
  }

  async getRights(auth: AuthContext, id: string) {
    return this.publicRights(await this.findRights(auth, id));
  }

  async createRights(auth: AuthContext, input: RightsProfileInput, ip: string | null) {
    if (!canCreateProfiles(auth.rights, 'rights')) {
      throw forbidden('You may not create rights profiles.', 'profile_not_editable');
    }
    await this.checkRightsInput(auth, input);
    return this.db
      .transaction(async (tx) => {
        const [row] = await tx
          .insert(rightsProfiles)
          .values({
            name: input.name,
            description: input.description ?? '',
            userVisibility: input.userVisibility,
            editAllAccessProfiles: input.editableAccessProfiles === 'all',
            editAllRightsProfiles: input.editableRightsProfiles === 'all',
            allCrmDatabases: input.crmDatabases === 'all',
            allCrmRecordTypes: input.crmRecordTypes === 'all',
            allCategories: input.categories === 'all',
            allTicketViews: input.ticketViews === 'all',
          })
          .returning();
        await this.writeRightsLinks(tx, row!.id, input);
        const after = await this.publicRights(row!, tx);
        await this.audit.record(
          {
            eventType: 'rights_profile.created',
            actorUserId: auth.user.id,
            ip,
            targetType: 'rights_profile',
            targetId: row!.id,
            changes: diffFields({}, after),
          },
          tx,
        );
        return after;
      })
      .catch(uniqueName);
  }

  async updateRights(auth: AuthContext, id: string, input: RightsProfileInput, ip: string | null) {
    const beforeRow = await this.findRights(auth, id);
    const before = await this.publicRights(beforeRow);
    await this.checkRightsInput(auth, input);
    return this.db
      .transaction(async (tx) => {
        const [row] = await tx
          .update(rightsProfiles)
          .set({
            name: input.name,
            description: input.description ?? '',
            userVisibility: input.userVisibility,
            editAllAccessProfiles: input.editableAccessProfiles === 'all',
            editAllRightsProfiles: input.editableRightsProfiles === 'all',
            allCrmDatabases: input.crmDatabases === 'all',
            allCrmRecordTypes: input.crmRecordTypes === 'all',
            allCategories: input.categories === 'all',
            allTicketViews: input.ticketViews === 'all',
            updatedAt: new Date(),
          })
          .where(eq(rightsProfiles.id, id))
          .returning();
        await this.writeRightsLinks(tx, id, input, true);
        const after = await this.publicRights(row!, tx);
        await this.audit.record(
          {
            eventType: 'rights_profile.updated',
            actorUserId: auth.user.id,
            ip,
            targetType: 'rights_profile',
            targetId: id,
            changes: diffFields(before, after),
          },
          tx,
        );
        return after;
      })
      .catch(uniqueName);
  }

  async deleteRights(auth: AuthContext, id: string, ip: string | null) {
    await this.findRights(auth, id);
    await this.db.transaction(async (tx) => {
      const inUse = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.rightsProfileId, id), isNull(users.deletedAt)))
        .limit(1);
      if (inUse.length)
        throw new ConflictException({ message: 'This profile is assigned to users.', reason: 'profile_in_use' });
      await tx.update(rightsProfiles).set({ deletedAt: new Date() }).where(eq(rightsProfiles.id, id));
      await this.audit.record(
        {
          eventType: 'rights_profile.deleted',
          actorUserId: auth.user.id,
          ip,
          targetType: 'rights_profile',
          targetId: id,
        },
        tx,
      );
    });
  }

  private async findRights(auth: AuthContext, id: string) {
    const [row] = await this.db
      .select()
      .from(rightsProfiles)
      .where(and(eq(rightsProfiles.id, id), isNull(rightsProfiles.deletedAt)));
    if (!row || !canManageRightsProfile(auth.rights, id)) throw new NotFoundException();
    return row;
  }

  /**
   * A rights profile may only delegate profile-editing the actor holds: 'all' needs
   * 'all', and listed ids must be within the actor's own editable set.
   */
  private async checkRightsInput(auth: AuthContext, input: RightsProfileInput) {
    const check = (kind: 'access' | 'rights', wanted: 'all' | string[]) => {
      const mine = kind === 'access' ? auth.rights.editableAccessProfiles : auth.rights.editableRightsProfiles;
      if (mine === 'all') return;
      if (wanted === 'all' || wanted.some((id) => !mine.includes(id))) {
        throw forbidden(`You cannot delegate ${kind} profiles you may not edit yourself.`, 'privilege_escalation');
      }
    };
    check('access', input.editableAccessProfiles);
    check('rights', input.editableRightsProfiles);
    // Data scopes can only be delegated from what the actor can see.
    const checkScope = (label: string, mine: 'all' | readonly string[], wanted: 'all' | string[]) => {
      if (mine === 'all') return;
      if (wanted === 'all' || wanted.some((id) => !mine.includes(id))) {
        throw forbidden(`You cannot grant ${label} you cannot see yourself.`, 'privilege_escalation');
      }
    };
    checkScope('CRM databases', auth.rights.crmDatabases, input.crmDatabases);
    checkScope('CRM record types', auth.rights.crmRecordTypes, input.crmRecordTypes);
    const myCategories =
      auth.ticketRights.categories === 'all' ? 'all' : auth.ticketRights.categories.map((c) => c.categoryId);
    checkScope(
      'categories',
      myCategories,
      input.categories === 'all' ? 'all' : input.categories.map((c) => c.categoryId),
    );
    checkScope('team views', auth.ticketRights.ticketViews, input.ticketViews);
    await this.assertExist(
      categories,
      input.categories === 'all' ? 'all' : input.categories.map((c) => c.categoryId),
      'category',
    );
    await this.assertExist(crmDatabases, input.crmDatabases, 'CRM database');
    await this.assertExist(crmRecordTypes, input.crmRecordTypes, 'CRM record type');

    await this.assertExist(accessProfiles, input.editableAccessProfiles, 'access profile');
    await this.assertExist(rightsProfiles, input.editableRightsProfiles, 'rights profile');
    if (input.visibleUserIds.length) {
      const found = await this.db.select({ id: users.id }).from(users).where(inArray(users.id, input.visibleUserIds));
      if (found.length !== new Set(input.visibleUserIds).size) {
        throw new NotFoundException({ message: 'Unknown user in visible users.', reason: 'unknown_reference' });
      }
    }
  }

  private async assertExist(
    table:
      typeof accessProfiles | typeof rightsProfiles | typeof crmDatabases | typeof crmRecordTypes | typeof categories,
    ids: 'all' | string[],
    label: string,
  ) {
    if (ids === 'all' || ids.length === 0) return;
    const found = await this.db
      .select({ id: table.id })
      .from(table)
      .where(and(inArray(table.id, ids), isNull(table.deletedAt)));
    if (found.length !== new Set(ids).size) {
      throw new NotFoundException({ message: `Unknown ${label}.`, reason: 'unknown_reference' });
    }
  }

  private async writeRightsLinks(tx: DbOrTx, id: string, input: RightsProfileInput, replace = false) {
    if (replace) {
      await tx.delete(rightsProfileVisibleUsers).where(eq(rightsProfileVisibleUsers.rightsProfileId, id));
      await tx
        .delete(rightsProfileEditableAccessProfiles)
        .where(eq(rightsProfileEditableAccessProfiles.rightsProfileId, id));
      await tx
        .delete(rightsProfileEditableRightsProfiles)
        .where(eq(rightsProfileEditableRightsProfiles.rightsProfileId, id));
      await tx.delete(rightsProfileCrmDatabases).where(eq(rightsProfileCrmDatabases.rightsProfileId, id));
      await tx.delete(rightsProfileCrmRecordTypes).where(eq(rightsProfileCrmRecordTypes.rightsProfileId, id));
      await tx.delete(rightsProfileCategories).where(eq(rightsProfileCategories.rightsProfileId, id));
      await tx.delete(rightsProfileTicketViews).where(eq(rightsProfileTicketViews.rightsProfileId, id));
    }
    if (input.categories !== 'all' && input.categories.length) {
      const seen = new Set<string>();
      const rows = input.categories.filter((c) => !seen.has(c.categoryId) && seen.add(c.categoryId));
      await tx.insert(rightsProfileCategories).values(rows.map((c) => ({ rightsProfileId: id, ...c })));
    }
    if (input.ticketViews !== 'all' && input.ticketViews.length) {
      await tx
        .insert(rightsProfileTicketViews)
        .values([...new Set(input.ticketViews)].map((viewId) => ({ rightsProfileId: id, viewId })));
    }
    if (input.crmDatabases !== 'all' && input.crmDatabases.length) {
      await tx
        .insert(rightsProfileCrmDatabases)
        .values([...new Set(input.crmDatabases)].map((crmDatabaseId) => ({ rightsProfileId: id, crmDatabaseId })));
    }
    if (input.crmRecordTypes !== 'all' && input.crmRecordTypes.length) {
      await tx
        .insert(rightsProfileCrmRecordTypes)
        .values(
          [...new Set(input.crmRecordTypes)].map((crmRecordTypeId) => ({ rightsProfileId: id, crmRecordTypeId })),
        );
    }
    const visible = [...new Set(input.visibleUserIds)];
    if (input.userVisibility === 'selected' && visible.length) {
      await tx.insert(rightsProfileVisibleUsers).values(visible.map((userId) => ({ rightsProfileId: id, userId })));
    }
    if (input.editableAccessProfiles !== 'all' && input.editableAccessProfiles.length) {
      await tx.insert(rightsProfileEditableAccessProfiles).values(
        [...new Set(input.editableAccessProfiles)].map((accessProfileId) => ({
          rightsProfileId: id,
          accessProfileId,
        })),
      );
    }
    if (input.editableRightsProfiles !== 'all' && input.editableRightsProfiles.length) {
      await tx.insert(rightsProfileEditableRightsProfiles).values(
        [...new Set(input.editableRightsProfiles)].map((editableRightsProfileId) => ({
          rightsProfileId: id,
          editableRightsProfileId,
        })),
      );
    }
  }

  private async publicRights(row: typeof rightsProfiles.$inferSelect, tx: DbOrTx = this.db) {
    const rights = await this.permissions.loadRights(row.id, tx);
    const tickets = await this.permissions.loadTicketRights(row.id, tx);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      userVisibility: row.userVisibility,
      visibleUserIds: [...(rights?.visibleUserIds ?? [])].sort(),
      editableAccessProfiles:
        rights?.editableAccessProfiles === 'all' ? 'all' : [...(rights?.editableAccessProfiles ?? [])].sort(),
      editableRightsProfiles:
        rights?.editableRightsProfiles === 'all' ? 'all' : [...(rights?.editableRightsProfiles ?? [])].sort(),
      crmDatabases: rights?.crmDatabases === 'all' ? 'all' : [...(rights?.crmDatabases ?? [])].sort(),
      crmRecordTypes: rights?.crmRecordTypes === 'all' ? 'all' : [...(rights?.crmRecordTypes ?? [])].sort(),
      categories:
        tickets.categories === 'all'
          ? 'all'
          : [...tickets.categories].sort((a, b) => a.categoryId.localeCompare(b.categoryId)),
      ticketViews: tickets.ticketViews === 'all' ? 'all' : [...tickets.ticketViews].sort(),
    };
  }
}

function publicAccess(row: typeof accessProfiles.$inferSelect): {
  id: string;
  name: string;
  description: string;
  modules: ModuleAccessMap;
  flags: AccessFlagMap;
} {
  return { id: row.id, name: row.name, description: row.description, modules: row.modules, flags: row.flags };
}

function uniqueName(err: unknown): never {
  if (isUniqueViolation(err)) {
    throw new ConflictException({ message: 'A profile with this name already exists.', reason: 'duplicate_name' });
  }
  throw err;
}

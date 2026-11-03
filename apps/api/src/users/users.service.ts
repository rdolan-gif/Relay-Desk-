import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  canManageAccessProfile,
  canManageRightsProfile,
  canSeeUser,
  checkUserChange,
  diffFields,
  filterVisibleUsers,
  normaliseEmail,
  type UserType,
} from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import { isUniqueViolation } from '../common/db-errors';
import { AuthService } from '../auth/auth.service';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import type { AuthContext } from '../common/request-context';
import { DB, type Db } from '../db/db';
import { accessProfiles, rightsProfiles, users } from '../db/schema';

export interface CreateUserInput {
  email: string;
  name: string;
  type: UserType;
  password?: string;
  accessProfileId?: string | null;
  rightsProfileId?: string | null;
  timezone?: string;
}

export type UpdateUserInput = Partial<CreateUserInput> & { isActive?: boolean };

type UserRow = typeof users.$inferSelect;

/** The fields of a user that are safe to return and to diff in the audit log. */
function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    type: u.type,
    accessProfileId: u.accessProfileId,
    rightsProfileId: u.rightsProfileId,
    isActive: u.isActive,
    totpEnabled: u.totpEnabled,
    timezone: u.timezone,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  /** Returns only users visible under the caller's rights (spec 4, "User visibility"). */
  async list(auth: AuthContext) {
    const rows = await this.db.select().from(users).where(isNull(users.deletedAt)).orderBy(users.name);
    return filterVisibleUsers(auth.rights, auth.user.id, rows).map(publicUser);
  }

  /**
   * Active users visible under the caller's rights, for owner and user pickers. Open to
   * every internal user, unlike the Settings > Users list.
   */
  async directory(auth: AuthContext) {
    const rows = await this.db
      .select()
      .from(users)
      .where(and(isNull(users.deletedAt), eq(users.isActive, true)))
      .orderBy(users.name);
    return filterVisibleUsers(auth.rights, auth.user.id, rows)
      .filter((u) => u.type !== 'external')
      .map((u) => ({ id: u.id, name: u.name, email: u.email }));
  }

  async get(auth: AuthContext, id: string) {
    return publicUser(await this.find(auth, id));
  }

  async create(auth: AuthContext, input: CreateUserInput, ip: string | null) {
    const email = normaliseEmail(input.email);
    await this.checkProfiles(auth, input.type, input.accessProfileId ?? null, input.rightsProfileId ?? null);
    if (input.type !== 'external' && !input.password) {
      throw new BadRequestException({ message: 'A password is required.', reason: 'password_required' });
    }
    if (input.password) this.authService.assertStrong(input.password, { email, name: input.name });
    const passwordHash = input.password ? await this.passwords.hash(input.password) : null;

    return this.db
      .transaction(async (tx) => {
        const [row] = await tx
          .insert(users)
          .values({
            email,
            name: input.name,
            type: input.type,
            passwordHash,
            passwordChangedAt: passwordHash ? new Date() : null,
            accessProfileId: input.accessProfileId ?? null,
            rightsProfileId: input.rightsProfileId ?? null,
            timezone: input.timezone ?? 'Europe/London',
          })
          .returning();
        const created = publicUser(row!);
        await this.audit.record(
          {
            eventType: 'user.created',
            actorUserId: auth.user.id,
            ip,
            targetType: 'user',
            targetId: row!.id,
            changes: diffFields({}, created),
          },
          tx,
        );
        return created;
      })
      .catch(duplicateEmail);
  }

  async update(auth: AuthContext, id: string, input: UpdateUserInput, ip: string | null) {
    const before = await this.find(auth, id);
    const nextType = input.type ?? before.type;
    const nextAccess = input.accessProfileId !== undefined ? input.accessProfileId : before.accessProfileId;
    const nextRights = input.rightsProfileId !== undefined ? input.rightsProfileId : before.rightsProfileId;

    const decision = checkUserChange({
      actorId: auth.user.id,
      targetId: id,
      currentType: before.type,
      newType: input.type,
      newIsActive: input.isActive,
      targetHasActiveSession: await this.sessions.hasActiveSession(id),
    });
    if (!decision.allowed) throw new ConflictException({ message: decision.message, reason: decision.code });

    // Re-check profiles whenever they or the type change; you also may not touch a user
    // whose current profiles you could not have assigned yourself.
    await this.checkProfiles(auth, nextType, nextAccess, nextRights);
    if (before.accessProfileId && !canManageAccessProfile(auth.rights, before.accessProfileId)) {
      throw new ForbiddenException({
        message: 'You may not edit users with this access profile.',
        reason: 'profile_not_editable',
      });
    }
    if (before.rightsProfileId && !canManageRightsProfile(auth.rights, before.rightsProfileId)) {
      throw new ForbiddenException({
        message: 'You may not edit users with this rights profile.',
        reason: 'profile_not_editable',
      });
    }

    const email = input.email !== undefined ? normaliseEmail(input.email) : before.email;
    const name = input.name ?? before.name;
    if (input.password) this.authService.assertStrong(input.password, { email, name });
    const passwordHash = input.password ? await this.passwords.hash(input.password) : undefined;

    const deactivating = input.isActive === false && before.isActive;
    const reactivating = input.isActive === true && !before.isActive;

    return this.db
      .transaction(async (tx) => {
        const [row] = await tx
          .update(users)
          .set({
            email,
            name,
            type: nextType,
            accessProfileId: nextAccess,
            rightsProfileId: nextRights,
            timezone: input.timezone ?? before.timezone,
            isActive: input.isActive ?? before.isActive,
            ...(passwordHash ? { passwordHash, passwordChangedAt: new Date() } : {}),
            // Deactivation revokes the API token as well as sessions.
            ...(deactivating ? { apiTokenHash: null, apiTokenCreatedAt: null } : {}),
            updatedAt: new Date(),
          })
          .where(eq(users.id, id))
          .returning();
        if (deactivating || passwordHash) await this.sessions.revokeAllForUser(id, tx);
        // TODO(Phase 2): remove the user as follower from all tickets on deactivation.

        const after = publicUser(row!);
        const changes = diffFields(publicUser(before), after).filter((c) => c.field !== 'updatedAt');
        if (passwordHash) changes.push({ field: 'password', old: '[redacted]', new: '[redacted]' });
        await this.audit.record(
          {
            eventType: deactivating ? 'user.deactivated' : reactivating ? 'user.reactivated' : 'user.updated',
            actorUserId: auth.user.id,
            ip,
            targetType: 'user',
            targetId: id,
            changes,
          },
          tx,
        );
        return after;
      })
      .catch(duplicateEmail);
  }

  private async find(auth: AuthContext, id: string): Promise<UserRow> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)));
    if (!row || !canSeeUser(auth.rights, auth.user.id, id)) throw new NotFoundException();
    return row;
  }

  /**
   * Internal users need both profiles; external users need neither. The caller may
   * only assign profiles in their own editable lists (privilege escalation guard).
   */
  private async checkProfiles(
    auth: AuthContext,
    type: UserType,
    accessProfileId: string | null,
    rightsProfileId: string | null,
  ) {
    if (type !== 'external' && (!accessProfileId || !rightsProfileId)) {
      throw new BadRequestException({
        message: 'Internal users need an access profile and a rights profile.',
        reason: 'profiles_required',
      });
    }
    if (accessProfileId) {
      const [ap] = await this.db
        .select({ id: accessProfiles.id })
        .from(accessProfiles)
        .where(and(eq(accessProfiles.id, accessProfileId), isNull(accessProfiles.deletedAt)));
      if (!ap) throw new BadRequestException({ message: 'Unknown access profile.', reason: 'unknown_reference' });
      if (!canManageAccessProfile(auth.rights, accessProfileId)) {
        throw new ForbiddenException({
          message: 'You may not assign this access profile.',
          reason: 'profile_not_editable',
        });
      }
    }
    if (rightsProfileId) {
      const [rp] = await this.db
        .select({ id: rightsProfiles.id })
        .from(rightsProfiles)
        .where(and(eq(rightsProfiles.id, rightsProfileId), isNull(rightsProfiles.deletedAt)));
      if (!rp) throw new BadRequestException({ message: 'Unknown rights profile.', reason: 'unknown_reference' });
      if (!canManageRightsProfile(auth.rights, rightsProfileId)) {
        throw new ForbiddenException({
          message: 'You may not assign this rights profile.',
          reason: 'profile_not_editable',
        });
      }
    }
  }
}

function duplicateEmail(err: unknown): never {
  if (isUniqueViolation(err)) {
    throw new ConflictException({ message: 'A user with this email already exists.', reason: 'duplicate_email' });
  }
  throw err;
}

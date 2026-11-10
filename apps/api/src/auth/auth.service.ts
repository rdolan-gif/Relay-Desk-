import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, gte, isNull } from 'drizzle-orm';
import {
  LOGIN_WINDOW_MS,
  checkPasswordStrength,
  isLoginLocked,
  normaliseEmail,
  userTypeCanUseInternalApp,
} from '@relay-desk/domain';
import { AuditService } from '../audit/audit.service';
import { CONFIG, type AppConfig } from '../config/config';
import { SECRET_BOX, SecretBox, randomToken, sha256 } from '../common/crypto';
import { DB, type Db } from '../db/db';
import { loginAttempts, users } from '../db/schema';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { newTotpSecret, totpUri, verifyTotp } from './totp';

/** Per-IP ceiling across all emails, to slow credential stuffing. */
const MAX_FAILURES_PER_IP = 20;

const INVALID = () =>
  new UnauthorizedException({ message: 'Email or password is incorrect.', reason: 'invalid_credentials' });

export interface LoginInput {
  email: string;
  password: string;
  totpCode?: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: LoginInput, ip: string | null, userAgent: string | null) {
    const email = normaliseEmail(input.email);
    await this.assertNotThrottled(email, ip);

    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt)));
    const passwordOk = await this.passwords.verify(user?.passwordHash ?? null, input.password);

    if (!user || !passwordOk || !user.isActive || !userTypeCanUseInternalApp(user.type)) {
      await this.recordFailure(
        email,
        ip,
        user?.id ?? null,
        !user ? 'unknown_user' : !passwordOk ? 'bad_password' : 'not_allowed',
      );
      throw INVALID();
    }

    // With Google sign-in on, passwords can be limited (PASSWORD_SIGNIN). Checked only after the
    // password is right, so the answer never reveals whether an account exists.
    const policy = this.config.PASSWORD_SIGNIN;
    if (policy === 'none' || (policy === 'administrators' && user.type !== 'administrator')) {
      await this.recordFailure(email, ip, user.id, 'password_signin_disabled');
      throw new UnauthorizedException({
        message: 'Sign in with your Google account instead.',
        reason: 'use_google_signin',
      });
    }
    if (policy === 'administrators' && !user.totpEnabled) {
      await this.recordFailure(email, ip, user.id, 'emergency_needs_2fa');
      throw new UnauthorizedException({
        message: 'Password sign-in is only for administrators with two-factor turned on. Sign in with Google.',
        reason: 'use_google_signin',
      });
    }

    if (user.totpEnabled) {
      if (!input.totpCode) {
        throw new UnauthorizedException({
          message: 'Enter the 6-digit code from your authenticator app.',
          reason: 'totp_required',
        });
      }
      const secret = this.secrets.decrypt(user.totpSecretEnc!);
      if (!verifyTotp(secret, input.totpCode)) {
        await this.recordFailure(email, ip, user.id, 'bad_totp');
        throw new UnauthorizedException({ message: 'The code is incorrect.', reason: 'totp_invalid' });
      }
    }

    await this.db.insert(loginAttempts).values({ email, ip, succeeded: true });
    const session = await this.sessions.create(user.id, ip, userAgent);
    await this.audit.record({
      eventType: 'auth.login_succeeded',
      actorUserId: user.id,
      ip,
      targetType: 'user',
      targetId: user.id,
    });
    return { user, session };
  }

  /**
   * Signs in someone Google has vouched for (email already checked for the allowed domain).
   * Only existing, active staff accounts: Google sign-in never creates one. Google handles
   * the second factor, so Relay Desk's own two-factor code is not asked for.
   */
  async loginWithGoogle(email: string, ip: string | null, userAgent: string | null) {
    const address = normaliseEmail(email);
    await this.assertNotThrottled(address, ip);
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, address), isNull(users.deletedAt)));
    if (!user || !user.isActive || !userTypeCanUseInternalApp(user.type)) {
      await this.recordFailure(address, ip, user?.id ?? null, !user ? 'google_no_account' : 'google_not_allowed');
      return null;
    }
    await this.db.insert(loginAttempts).values({ email: address, ip, succeeded: true });
    const session = await this.sessions.create(user.id, ip, userAgent);
    await this.audit.record({
      eventType: 'auth.login_succeeded',
      actorUserId: user.id,
      ip,
      targetType: 'user',
      targetId: user.id,
      details: { method: 'google' },
    });
    return { user, session };
  }

  /** Records a Google sign-in refused before an account was looked up (bad state, wrong domain…). */
  async googleRefused(email: string | null, ip: string | null, cause: string) {
    await this.recordFailure(email ?? '(google)', ip, null, `google_${cause}`);
  }

  async logout(sessionId: string, userId: string, ip: string | null) {
    await this.sessions.revoke(sessionId);
    await this.audit.record({
      eventType: 'auth.logout',
      actorUserId: userId,
      ip,
      targetType: 'user',
      targetId: userId,
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    keepSessionId: string | null,
    ip: string | null,
  ) {
    const user = await this.getUser(userId);
    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new BadRequestException({ message: 'Current password is incorrect.', reason: 'invalid_password' });
    }
    this.assertStrong(newPassword, user);
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash: await this.passwords.hash(newPassword),
          passwordChangedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      await this.sessions.revokeAllForUser(userId, tx, keepSessionId ?? undefined);
      await this.audit.record(
        { eventType: 'auth.password_changed', actorUserId: userId, ip, targetType: 'user', targetId: userId },
        tx,
      );
    });
  }

  assertStrong(password: string, user: { email: string; name: string }) {
    const check = checkPasswordStrength(password, [user.email, user.name]);
    if (!check.ok) {
      throw new BadRequestException({
        message: check.problems.join(' '),
        reason: 'weak_password',
        problems: check.problems,
      });
    }
  }

  /** Step 1 of enrolment: generate a pending secret and return the otpauth:// URI. */
  async beginTotpSetup(userId: string) {
    const user = await this.getUser(userId);
    if (user.totpEnabled)
      throw new ConflictException({
        message: 'Two-factor authentication is already on.',
        reason: 'totp_already_enabled',
      });
    const secret = newTotpSecret();
    await this.db
      .update(users)
      .set({ totpPendingSecretEnc: this.secrets.encrypt(secret) })
      .where(eq(users.id, userId));
    return { secret, otpauthUri: totpUri(secret, user.email) };
  }

  /** Step 2: confirm with a code from the app; the pending secret becomes active. */
  async confirmTotpSetup(userId: string, code: string, ip: string | null) {
    const user = await this.getUser(userId);
    if (!user.totpPendingSecretEnc)
      throw new BadRequestException({ message: 'Start setup first.', reason: 'totp_not_started' });
    const secret = this.secrets.decrypt(user.totpPendingSecretEnc);
    if (!verifyTotp(secret, code))
      throw new BadRequestException({ message: 'The code is incorrect.', reason: 'totp_invalid' });
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          totpSecretEnc: user.totpPendingSecretEnc,
          totpPendingSecretEnc: null,
          totpEnabled: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));
      await this.audit.record(
        { eventType: 'auth.totp_enabled', actorUserId: userId, ip, targetType: 'user', targetId: userId },
        tx,
      );
    });
  }

  async disableTotp(userId: string, password: string, code: string, ip: string | null) {
    const user = await this.getUser(userId);
    if (!user.totpEnabled)
      throw new BadRequestException({ message: 'Two-factor authentication is not on.', reason: 'totp_not_enabled' });
    const ok =
      (await this.passwords.verify(user.passwordHash, password)) &&
      verifyTotp(this.secrets.decrypt(user.totpSecretEnc!), code);
    if (!ok)
      throw new BadRequestException({ message: 'Password or code is incorrect.', reason: 'invalid_credentials' });
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabled: false, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await this.audit.record(
        { eventType: 'auth.totp_disabled', actorUserId: userId, ip, targetType: 'user', targetId: userId },
        tx,
      );
    });
  }

  /** Creates (or replaces) the user's personal API token. The raw token is returned once. */
  async createApiToken(userId: string, ip: string | null) {
    const token = `rdk_${randomToken()}`;
    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ apiTokenHash: sha256(token), apiTokenCreatedAt: new Date() })
        .where(eq(users.id, userId));
      await this.audit.record(
        { eventType: 'auth.api_token_created', actorUserId: userId, ip, targetType: 'user', targetId: userId },
        tx,
      );
    });
    return token;
  }

  async revokeApiToken(userId: string, ip: string | null) {
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ apiTokenHash: null, apiTokenCreatedAt: null }).where(eq(users.id, userId));
      await this.audit.record(
        { eventType: 'auth.api_token_revoked', actorUserId: userId, ip, targetType: 'user', targetId: userId },
        tx,
      );
    });
  }

  private async getUser(userId: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new UnauthorizedException();
    return user;
  }

  private async assertNotThrottled(email: string, ip: string | null) {
    const since = new Date(Date.now() - LOGIN_WINDOW_MS);
    const byEmail = await this.db
      .select({ at: loginAttempts.createdAt })
      .from(loginAttempts)
      .where(
        and(eq(loginAttempts.email, email), eq(loginAttempts.succeeded, false), gte(loginAttempts.createdAt, since)),
      );
    let locked = isLoginLocked(
      byEmail.map((r) => r.at.getTime()),
      Date.now(),
    );
    if (!locked && ip) {
      const byIp = await this.db
        .select({ at: loginAttempts.createdAt })
        .from(loginAttempts)
        .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.succeeded, false), gte(loginAttempts.createdAt, since)));
      locked = isLoginLocked(
        byIp.map((r) => r.at.getTime()),
        Date.now(),
        MAX_FAILURES_PER_IP,
      );
    }
    if (locked) {
      throw new HttpException(
        { message: 'Too many failed attempts. Try again in 15 minutes.', reason: 'rate_limited' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async recordFailure(email: string, ip: string | null, userId: string | null, cause: string) {
    await this.db.insert(loginAttempts).values({ email, ip, succeeded: false });
    await this.audit.record({
      eventType: 'auth.login_failed',
      actorUserId: userId,
      actorLabel: email,
      ip,
      targetType: 'user',
      targetId: userId,
      details: { cause },
    });
  }
}

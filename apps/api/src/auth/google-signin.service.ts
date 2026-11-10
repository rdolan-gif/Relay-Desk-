import { Inject, Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { CONFIG, type AppConfig } from '../config/config';

/** Why a Google sign-in was refused; also the `signin_error` code shown on the login page. */
export type GoogleSignInError =
  | 'not_enabled'
  | 'invalid_state'
  | 'state_expired'
  | 'google_refused'
  | 'invalid_token'
  | 'wrong_domain'
  | 'email_not_verified';

export class GoogleSignInRefused extends Error {
  constructor(readonly code: GoogleSignInError) {
    super(code);
  }
}

/** Cookie tying the Google round trip to the browser that started it (stops login CSRF). */
export const GOOGLE_SIGNIN_COOKIE = 'rd_google_signin';
const STATE_MINUTES = 10;
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

interface IdTokenClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  hd?: string;
}

/**
 * Staff sign-in with Google (OpenID Connect), limited to one Workspace domain. Uses the same
 * OAuth client as the Gmail connection, with its own redirect address. The ID token comes
 * straight from Google's token endpoint over TLS with our client secret, so its claims are
 * checked (issuer, audience, expiry, nonce, verified email, Workspace domain) rather than its
 * signature (OpenID Connect Core 3.1.3.7).
 */
@Injectable()
export class GoogleSignInService {
  /** Replaced in tests. */
  http: typeof fetch = (...args) => fetch(...args);

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  get enabled(): boolean {
    return !!(this.config.GOOGLE_SIGNIN_DOMAIN && this.config.GOOGLE_CLIENT_ID && this.config.GOOGLE_CLIENT_SECRET);
  }

  get domain(): string {
    return this.config.GOOGLE_SIGNIN_DOMAIN;
  }

  get redirectUri(): string {
    return `${this.config.PUBLIC_URL.replace(/\/$/, '')}/api/auth/google/callback`;
  }

  /** The Google address to send the browser to, and the nonce to keep in its cookie. */
  start(): { url: string; nonce: string; maxAgeMs: number } {
    if (!this.enabled) throw new GoogleSignInRefused('not_enabled');
    const nonce = randomBytes(24).toString('base64url');
    const state = this.sign({ n: nonce, e: Date.now() + STATE_MINUTES * 60_000 });
    const q = new URLSearchParams({
      client_id: this.config.GOOGLE_CLIENT_ID,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
      hd: this.domain,
      nonce,
      state,
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${q}`, nonce, maxAgeMs: STATE_MINUTES * 60_000 };
  }

  /** Checks the round trip and returns the verified email on the allowed domain. */
  async finish(code: string, state: string, cookieNonce: string | undefined): Promise<string> {
    if (!this.enabled) throw new GoogleSignInRefused('not_enabled');
    const nonce = this.verifyState(state);
    if (!cookieNonce || !this.same(cookieNonce, nonce)) throw new GoogleSignInRefused('invalid_state');

    const res = await this.http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.config.GOOGLE_CLIENT_ID,
        client_secret: this.config.GOOGLE_CLIENT_SECRET,
        redirect_uri: this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = (await res.json().catch(() => ({}))) as { id_token?: string };
    if (!res.ok || !tokens.id_token) throw new GoogleSignInRefused('google_refused');

    const claims = decodeClaims(tokens.id_token);
    if (!claims) throw new GoogleSignInRefused('invalid_token');
    if (
      !ISSUERS.has(claims.iss ?? '') ||
      claims.aud !== this.config.GOOGLE_CLIENT_ID ||
      typeof claims.exp !== 'number' ||
      claims.exp * 1000 < Date.now() ||
      !claims.nonce ||
      !this.same(claims.nonce, nonce)
    ) {
      throw new GoogleSignInRefused('invalid_token');
    }
    const email = (claims.email ?? '').toLowerCase();
    // A Workspace account carries `hd`; a personal Gmail address with the same text does not.
    if (claims.hd?.toLowerCase() !== this.domain || !email.endsWith(`@${this.domain}`)) {
      throw new GoogleSignInRefused('wrong_domain');
    }
    if (claims.email_verified !== true && claims.email_verified !== 'true') {
      throw new GoogleSignInRefused('email_not_verified');
    }
    return email;
  }

  private verifyState(state: string): string {
    const [body, mac] = state.split('.');
    if (!body || !mac || !this.same(mac, this.mac(body))) throw new GoogleSignInRefused('invalid_state');
    let data: { n?: string; e?: number };
    try {
      data = JSON.parse(Buffer.from(body, 'base64url').toString()) as { n?: string; e?: number };
    } catch {
      throw new GoogleSignInRefused('invalid_state');
    }
    if (!data.n || typeof data.e !== 'number') throw new GoogleSignInRefused('invalid_state');
    if (data.e < Date.now()) throw new GoogleSignInRefused('state_expired');
    return data.n;
  }

  private same(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }

  private sign(data: object): string {
    const body = Buffer.from(JSON.stringify(data)).toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  private mac(body: string): string {
    return createHmac('sha256', Buffer.from(this.config.ENCRYPTION_KEY, 'base64'))
      .update(`signin:${body}`)
      .digest('base64url');
  }
}

function decodeClaims(idToken: string): IdTokenClaims | null {
  const part = idToken.split('.')[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString()) as unknown;
    return claims && typeof claims === 'object' ? (claims as IdTokenClaims) : null;
  } catch {
    return null;
  }
}

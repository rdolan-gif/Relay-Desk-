import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CONFIG, type AppConfig } from '../config/config';

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
];

/**
 * Google sign-in for connecting a Gmail mailbox (owner O-2, O-10). With Ricoman's
 * Google Workspace an *internal* OAuth app needs no Google review and its refresh
 * tokens don't expire weekly.
 */
@Injectable()
export class GoogleOAuthService {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  get configured(): boolean {
    return !!(this.config.GOOGLE_CLIENT_ID && this.config.GOOGLE_CLIENT_SECRET);
  }

  get redirectUri(): string {
    return `${this.config.PUBLIC_URL.replace(/\/$/, '')}/api/oauth/google/callback`;
  }

  authUrl(queueId: string, userId: string, loginHint: string): string {
    if (!this.configured) {
      throw new BadRequestException({
        message: 'Google sign-in is not set up yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).',
        reason: 'google_not_configured',
      });
    }
    const q = new URLSearchParams({
      client_id: this.config.GOOGLE_CLIENT_ID,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: GMAIL_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      login_hint: loginHint,
      state: this.sign({ q: queueId, u: userId, e: Date.now() + 10 * 60_000 }),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  /** Verifies the signed state (10-minute expiry) and returns which mailbox and user started the flow. */
  verifyState(state: string): { queueId: string; userId: string } {
    const [body, mac] = state.split('.');
    if (!body || !mac) throw new BadRequestException({ message: 'Invalid sign-in state.', reason: 'invalid_state' });
    const expected = this.mac(body);
    if (expected.length !== mac.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) {
      throw new BadRequestException({ message: 'Invalid sign-in state.', reason: 'invalid_state' });
    }
    const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as { q: string; u: string; e: number };
    if (data.e < Date.now())
      throw new BadRequestException({ message: 'The sign-in took too long. Try again.', reason: 'state_expired' });
    return { queueId: data.q, userId: data.u };
  }

  /** Exchanges the code for tokens and reads which Gmail address was connected. */
  async exchange(code: string, http: typeof fetch = fetch): Promise<{ refreshToken: string; email: string }> {
    const res = await http('https://oauth2.googleapis.com/token', {
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
    const tokens = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
    };
    if (!res.ok || !tokens.access_token || !tokens.refresh_token) {
      throw new BadRequestException({
        message: `Google did not grant access (${tokens.error ?? res.status}).`,
        reason: 'google_refused',
      });
    }
    const profile = await http('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const p = (await profile.json()) as { emailAddress?: string };
    if (!p.emailAddress)
      throw new BadRequestException({ message: 'Could not read the Gmail address.', reason: 'google_refused' });
    return { refreshToken: tokens.refresh_token, email: p.emailAddress.toLowerCase() };
  }

  private sign(data: object): string {
    const body = Buffer.from(JSON.stringify(data)).toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  private mac(body: string): string {
    return createHmac('sha256', Buffer.from(this.config.ENCRYPTION_KEY, 'base64'))
      .update(`oauth:${body}`)
      .digest('base64url');
  }
}

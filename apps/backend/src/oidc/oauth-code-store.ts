import { nanoid } from 'nanoid';

/**
 * One-time codes that stand in for an access token in the redirect back to the web app, so a token never sits in a URL
 * (logs, history). The browser swaps the code at `POST /auth/exchange-oauth-code` within a minute.
 */

const TTL_MS = 60_000;

interface StoredCode {
    access_token: string;
    expires_in: number;
    expiresAt: number;
}

const codes = new Map<string, StoredCode>();

function dropExpiredCodes(): void {
    const now = Date.now();

    for (const [code, data] of codes.entries()) {
        if (data.expiresAt < now) codes.delete(code);
    }
}

export function issueOauthCode(accessToken: string, expiresIn: number): string {
    dropExpiredCodes();

    const code = nanoid(32);

    codes.set(code, { access_token: accessToken, expires_in: expiresIn, expiresAt: Date.now() + TTL_MS });

    return code;
}

/** The token a code stands for, once: the code is spent whether or not it had expired. */
export function redeemOauthCode(code: string): { access_token: string; expires_in: number } | null {
    dropExpiredCodes();

    const data = codes.get(code);

    if (!data) return null;

    codes.delete(code);

    return { access_token: data.access_token, expires_in: data.expires_in };
}

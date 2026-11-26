import type { VaultStatus } from '@reverie/shared';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { vi } from 'vitest';
import { apiClient, initApiAuth } from '../lib/api/client';

export const NO_SECRET: VaultStatus = { unlocked: false, has_password: true, secret_kind: null, ask: 'account_password' };
export const WITH_PIN: VaultStatus = { unlocked: false, has_password: true, secret_kind: 'pin', ask: 'pin' };
export const WITH_PASSWORD: VaultStatus = { unlocked: false, has_password: true, secret_kind: 'password', ask: 'password' };
export const STOPPED_PIN: VaultStatus = { unlocked: false, has_password: true, secret_kind: 'pin', ask: 'account_password' };

export interface Refusal {
    status: number;
    data: object;
}

export function toRefusal(ask: string, triesLeft: number | null, message = 'Refused'): Refusal {
    return { status: 403, data: { statusCode: 403, error: 'invalid_credentials', message, details: { ask, tries_left: triesLeft } } };
}

interface SentRequest {
    url: string;
    body: unknown;
}

/** Stands in for the vault routes behind the app's API client, and keeps count of what reaches it and the session. */
export function startVaultServer(initial: VaultStatus) {
    const server = {
        status: initial,
        /** The refusals still to give; once empty, unlocks and saves succeed. */
        refusals: [] as Refusal[],
        sent: [] as SentRequest[],
        refresh: vi.fn(() => Promise.resolve(true)),
        logout: vi.fn(() => Promise.resolve()),
        /** The bodies sent to one route. */
        sentTo: (url: string) => server.sent.filter((request) => request.url === url).map((request) => request.body),
    };

    apiClient.defaults.adapter = (config: InternalAxiosRequestConfig) => {
        const url = config.url ?? '';
        const body = typeof config.data === 'string' ? JSON.parse(config.data) : undefined;
        const refusal = url === '/vault/status' ? undefined : server.refusals.shift();
        const response = { config, headers: {}, statusText: '', status: refusal?.status ?? 200, data: refusal?.data ?? server.status };

        server.sent.push({ url, body });

        if (refusal) return Promise.reject(new AxiosError('Request failed', AxiosError.ERR_BAD_REQUEST, config, null, response));

        if (url === '/vault/secret') {
            const kind = body.secret?.kind ?? null;

            server.status = { ...server.status, secret_kind: kind, ask: kind ?? 'account_password' };
            response.data = server.status;
        }

        return Promise.resolve(response);
    };

    initApiAuth({ getToken: () => 'token', refresh: server.refresh, logout: server.logout });

    return server;
}

// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { createElement, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findByText, mount, press, settle, typeInto } from '../testing/render';
import { apiClient, initApiAuth } from './api/client';
import { useVault, VaultProvider } from './vault';

vi.mock('./auth', () => ({ useAuth: () => ({ isAuthenticated: false }) }));

const refresh = vi.fn(() => Promise.resolve(true));
const logout = vi.fn(() => Promise.resolve());
let requests: string[] = [];
/** The API's `error` code for each 401 still to answer; once empty, requests succeed. */
let rejections: string[] = [];

function respond(config: InternalAxiosRequestConfig) {
    requests.push(config.url ?? '');
    const error = rejections.shift();
    const response = { config, headers: {}, statusText: '', status: error ? 401 : 200, data: error ? { error } : {} };

    if (error) return Promise.reject(new AxiosError('Request failed', AxiosError.ERR_BAD_REQUEST, config, null, response));

    return Promise.resolve(response);
}

function AskToUnlock() {
    const { requestUnlock } = useVault();

    useEffect(() => {
        void requestUnlock('folder-1');
    }, [requestUnlock]);

    return null;
}

beforeEach(() => {
    requests = [];
    rejections = [];
    refresh.mockClear();
    logout.mockClear();
    apiClient.defaults.adapter = respond;
    initApiAuth({ getToken: () => 'token', refresh, logout });
});

let view: ReturnType<typeof mount> | undefined;

afterEach(() => view?.unmount());

describe('unlocking a private folder', () => {
    it('sends a wrong password once and shows one error', async () => {
        rejections = ['invalid_credentials', 'invalid_credentials'];
        view = mount(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(VaultProvider, null, createElement(AskToUnlock))));
        await settle();

        await typeInto(document.querySelector<HTMLInputElement>('input[type="password"]')!, 'wrong');
        await press(findByText('button', 'Unlock'));
        await settle(10);

        expect(requests).toEqual(['/vault/unlock']);
        expect(refresh).not.toHaveBeenCalled();
        expect(logout).not.toHaveBeenCalled();
        expect(document.querySelectorAll('[role="dialog"] .text-destructive')).toHaveLength(1);
    });

    it('still renews an expired session and sends the request again', async () => {
        rejections = ['token_invalid'];

        await apiClient.post('/vault/unlock', {});

        expect(requests).toEqual(['/vault/unlock', '/vault/unlock']);
        expect(refresh).toHaveBeenCalledTimes(1);
    });
});

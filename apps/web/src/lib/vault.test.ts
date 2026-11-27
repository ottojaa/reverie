// @vitest-environment jsdom
import type { VaultStatus } from '@reverie/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findByText, keyDown, mount, press, settle, typeInto } from '../testing/render';
import { ACCOUNT_PASSWORD_MARKUP, LOCK_SECRET_MARKUP, toSecretMarkup } from '../testing/secret-fields';
import { NO_SECRET, startVaultServer, STOPPED_PIN, toRefusal, WITH_PASSWORD, WITH_PIN } from '../testing/vault-server';
import { apiClient } from './api/client';
import { vaultStatusQuery } from './api/vault';
import { useVault, VaultProvider } from './vault';

vi.mock('./auth', () => ({ useAuth: () => ({ isAuthenticated: false }) }));

// The shake of a refused try measures the page, which jsdom does not do.
window.scrollTo = () => {};

const answered = vi.fn();
const openLockSettings = vi.fn();
let server: ReturnType<typeof startVaultServer>;
let view: ReturnType<typeof mount> | undefined;

function AskToUnlock() {
    const { requestUnlock } = useVault();

    useEffect(() => {
        void requestUnlock('folder-1').then(answered);
    }, [requestUnlock]);

    return null;
}

/** Opens the prompt for a folder. `cached` is a status the app already holds, from before the prompt. */
async function openPrompt(status: VaultStatus, cached?: VaultStatus) {
    server = startVaultServer(status);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    if (cached) client.setQueryData(vaultStatusQuery.queryKey, cached, { updatedAt: Date.now() - 1000 });

    client.setQueryData(['sections', 'tree'], [{ id: 'folder-1', name: 'Taxes', children: [] }]);

    const provider = createElement(VaultProvider, { onOpenLockSettings: openLockSettings }, createElement(AskToUnlock));

    view = mount(createElement(QueryClientProvider, { client }, provider));
    await settle(10);
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const field = () => document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
const errors = () => Array.from(document.querySelectorAll('[role="dialog"] .text-destructive'), (element) => element.textContent);
const unlocks = () => server.sentTo('/vault/unlock');
const sent = (password: string) => ({ password, folder_id: 'folder-1' });

async function enter(typed: string) {
    await typeInto(field(), typed);
    await settle(10);
}

async function submit(typed: string) {
    await typeInto(field(), typed);
    await press(findByText('button', 'Unlock'));
    await settle(10);
}

afterEach(() => {
    view?.unmount();
    vi.clearAllMocks();
});

describe('unlocking a private folder', () => {
    it('names the folder and asks for the account password while no lock secret is set', async () => {
        await openPrompt(NO_SECRET);

        expect(dialog()?.textContent).toContain('Unlock "Taxes"');
        expect(dialog()?.textContent).toContain('Enter your account password to open this folder.');
        expect(field().getAttribute('aria-label')).toBe('Account password');
        expect(findByText('button', 'Forgot it?')).toBeUndefined();
        expect(document.activeElement).toBe(field());

        await submit('correct horse');

        expect(unlocks()).toEqual([sent('correct horse')]);
        expect(answered).toHaveBeenCalledWith(true);
        expect(dialog()).toBeNull();
    });

    it('takes a lock password in a masked field that no password manager reads as a login', async () => {
        await openPrompt(WITH_PASSWORD);

        expect(field().getAttribute('aria-label')).toBe('Lock password');
        expect(toSecretMarkup(field())).toEqual(LOCK_SECRET_MARKUP);
    });

    it.each([NO_SECRET, STOPPED_PIN])('takes the account password in a field that password managers fill', async (status) => {
        await openPrompt(status);

        expect(toSecretMarkup(field())).toEqual(ACCOUNT_PASSWORD_MARKUP);
    });

    it('sends a wrong password once and shows one error', async () => {
        await openPrompt(NO_SECRET);
        server.refusals = [{ status: 401, data: { error: 'invalid_credentials', message: 'Incorrect password' } }];

        await submit('wrong');

        expect(unlocks()).toEqual([sent('wrong')]);
        expect(server.refresh).not.toHaveBeenCalled();
        expect(server.logout).not.toHaveBeenCalled();
        expect(errors()).toEqual(['Incorrect password. Try again.']);
        expect(field().value).toBe('');
    });

    it('takes a PIN in a masked numeric field and sends it on the fourth digit', async () => {
        await openPrompt(WITH_PIN);

        expect(dialog()?.textContent).toContain('Enter your PIN.');
        expect(toSecretMarkup(field())).toEqual(LOCK_SECRET_MARKUP);
        expect(field().inputMode).toBe('numeric');
        expect(findByText('button', 'Unlock')).toBeUndefined();

        await enter('4a8');

        expect(field().value).toBe('48');
        expect(unlocks()).toEqual([]);

        await enter('4821');

        expect(unlocks()).toEqual([sent('4821')]);
        expect(answered).toHaveBeenCalledWith(true);
    });

    it('counts a wrong PIN down in one request, without renewing or ending the session', async () => {
        await openPrompt(WITH_PIN);
        server.refusals = [toRefusal('pin', 7)];

        await enter('0000');

        expect(unlocks()).toEqual([sent('0000')]);
        expect(errors()).toEqual(['Incorrect PIN. 7 tries left.']);
        expect(field().value).toBe('');
        expect(document.activeElement).toBe(field());
        expect(server.refresh).not.toHaveBeenCalled();
        expect(server.logout).not.toHaveBeenCalled();
        expect(answered).not.toHaveBeenCalled();

        await enter('1');

        expect(errors()).toEqual([]);
    });

    it('asks for the lock password, sent with Unlock', async () => {
        await openPrompt(WITH_PASSWORD);
        server.refusals = [toRefusal('password', 1)];

        expect(dialog()?.textContent).toContain('Enter your lock password.');
        expect(field().getAttribute('aria-label')).toBe('Lock password');
        expect((findByText('button', 'Unlock') as HTMLButtonElement).disabled).toBe(true);

        await submit('loud-lantern');

        expect(errors()).toEqual(['Incorrect password. 1 try left.']);

        await submit('quiet-lantern');

        expect(unlocks()).toEqual([sent('loud-lantern'), sent('quiet-lantern')]);
        expect(answered).toHaveBeenCalledWith(true);
    });

    it('turns to the account password when the tries run out', async () => {
        await openPrompt(WITH_PIN);
        server.refusals = [toRefusal('account_password', null), toRefusal('account_password', null)];

        await enter('0000');

        expect(dialog()?.textContent).toContain('Too many wrong tries. Enter your account password.');
        expect(field().getAttribute('aria-label')).toBe('Account password');
        expect(errors()).toEqual([]);

        await submit('not it');

        expect(errors()).toEqual(['Incorrect password. Try again.']);
    });

    it('opens on the stopped state as the status says', async () => {
        await openPrompt(STOPPED_PIN);

        expect(dialog()?.textContent).toContain('Too many wrong tries. Enter your account password.');
        expect(field().getAttribute('aria-label')).toBe('Account password');
        expect(findByText('button', 'Forgot it?')).toBeUndefined();
    });

    it('changes form when a refusal asks for something else', async () => {
        await openPrompt(WITH_PIN);
        server.refusals = [toRefusal('password', 6)];

        await enter('0000');

        expect(dialog()?.textContent).toContain('Enter your lock password.');
        expect(field().getAttribute('aria-label')).toBe('Lock password');
        expect(errors()).toEqual(['Incorrect password. 6 tries left.']);
    });

    it('asks for the kind set elsewhere, from a status fetched as it opens and without spending a try', async () => {
        await openPrompt(WITH_PASSWORD, WITH_PIN);

        expect(server.sent.map((request) => request.url)).toEqual(['/vault/status']);
        expect(field().getAttribute('aria-label')).toBe('Lock password');
    });

    it('shows no field until that status is in, and offers another go when it does not come', async () => {
        server = startVaultServer(WITH_PIN);

        const answerStatus = apiClient.defaults.adapter;
        let isDown = true;
        const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

        client.setQueryData(vaultStatusQuery.queryKey, WITH_PIN, { updatedAt: Date.now() - 1000 });

        apiClient.defaults.adapter = (config) => {
            if (isDown || typeof answerStatus !== 'function') return Promise.reject(new Error('offline'));

            return answerStatus(config);
        };

        view = mount(
            createElement(QueryClientProvider, { client }, createElement(VaultProvider, { onOpenLockSettings: openLockSettings }, createElement(AskToUnlock))),
        );
        await settle(10);

        expect(field()).toBeNull();
        expect(dialog()?.textContent).toContain('Could not check how this folder opens.');

        isDown = false;
        await press(findByText('button', 'Try again'));
        await settle(10);

        expect(field().getAttribute('aria-label')).toBe('PIN');
    });

    it('leads to the lock settings from "Forgot it?"', async () => {
        await openPrompt(WITH_PIN);

        await press(findByText('button', 'Forgot it?'));

        expect(openLockSettings).toHaveBeenCalledTimes(1);
        expect(answered).toHaveBeenCalledWith(false);
        expect(dialog()).toBeNull();
    });

    it.each(['Cancel', 'Escape'])('gives up on %s without sending anything', async (way) => {
        await openPrompt(WITH_PIN);

        if (way === 'Escape') await keyDown(field(), 'Escape');
        else await press(findByText('button', 'Cancel'));

        expect(answered).toHaveBeenCalledWith(false);
        expect(dialog()).toBeNull();
        expect(unlocks()).toEqual([]);
    });

    it('still renews an expired session and sends the request again', async () => {
        server = startVaultServer(WITH_PIN);
        server.refusals = [{ status: 401, data: { error: 'token_invalid' } }];

        await apiClient.post('/vault/unlock', {});

        expect(unlocks()).toHaveLength(2);
        expect(server.refresh).toHaveBeenCalledTimes(1);
    });
});

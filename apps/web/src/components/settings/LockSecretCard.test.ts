// @vitest-environment jsdom
import type { VaultStatus } from '@reverie/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findByText, mount, press, settle, typeInto } from '../../testing/render';
import { ACCOUNT_PASSWORD_MARKUP, LOCK_SECRET_MARKUP, toSecretMarkup } from '../../testing/secret-fields';
import { NO_SECRET, startVaultServer, STOPPED_PIN, toRefusal, WITH_PASSWORD, WITH_PIN } from '../../testing/vault-server';
import { LockSecretCard } from './LockSecretCard';

const toast = vi.hoisted(() => ({ success: vi.fn() }));

vi.mock('sonner', () => ({ toast }));

let server: ReturnType<typeof startVaultServer>;
let view: ReturnType<typeof mount> | undefined;

async function showCard(status: VaultStatus) {
    server = startVaultServer(status);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    view = mount(createElement(QueryClientProvider, { client }, createElement(LockSecretCard)));
    await settle(10);
}

const card = () => document.querySelector<HTMLElement>('#private-folders-lock');
const input = (id: string) => document.querySelector<HTMLInputElement>('#' + id)!;
const radio = (value: string) => document.querySelector<HTMLElement>(`[role="radio"][value="${value}"]`)!;
const saves = () => server.sentTo('/vault/secret');
const alertText = () => document.querySelector('[role="alert"]')?.textContent;

async function fill(values: Record<string, string>) {
    for (const [id, value] of Object.entries(values)) await typeInto(input(id), value);
}

async function save() {
    await press(findByText('button', 'Save'));
    await settle(10);
}

afterEach(() => {
    view?.unmount();
    vi.clearAllMocks();
});

describe('the private folders lock card', () => {
    it.each([
        { status: NO_SECRET, chosen: 'account_password', text: 'They open with your account password now.' },
        { status: WITH_PIN, chosen: 'pin', text: 'They open with your PIN now.' },
        { status: WITH_PASSWORD, chosen: 'password', text: 'They open with your lock password now.' },
        { status: STOPPED_PIN, chosen: 'pin', text: 'Too many wrong tries at your PIN.' },
    ])('shows what is in use: $text', async ({ status, chosen, text }) => {
        await showCard(status);

        expect(card()?.textContent).toContain(text);
        expect(radio(chosen).getAttribute('aria-checked')).toBe('true');
    });

    it('is not there for an account without a password', async () => {
        await showCard({ unlocked: false, has_password: false, secret_kind: null, ask: null });

        expect(card()).toBeNull();
    });

    it('offers nothing to save while the account password stays in use', async () => {
        await showCard(NO_SECRET);

        expect(findByText('button', 'Save')).toBeUndefined();
    });

    it('sets a PIN, proven with the account password', async () => {
        await showCard(NO_SECRET);
        await press(radio('pin'));

        expect(card()?.textContent).toContain('Don’t reuse a PIN that guards something else.');
        expect(input('lock-new').inputMode).toBe('numeric');

        await fill({ 'lock-new': '4821', 'lock-repeat': '4821' });

        expect((findByText('button', 'Save') as HTMLButtonElement).disabled).toBe(true);

        await fill({ 'lock-account-password': 'correct horse' });
        await save();

        expect(saves()).toEqual([{ account_password: 'correct horse', secret: { kind: 'pin', value: '4821' } }]);
        expect(card()?.textContent).toContain('They open with your PIN now.');
        expect(input('lock-account-password').value).toBe('');
        expect(toast.success).toHaveBeenCalledWith('Private folders now open with your PIN');
    });

    it.each(['pin', 'password'])('keeps the new %s out of password managers, and the account password in them', async (kind) => {
        await showCard(NO_SECRET);
        await press(radio(kind));

        expect(toSecretMarkup(input('lock-new'))).toEqual(LOCK_SECRET_MARKUP);
        expect(toSecretMarkup(input('lock-repeat'))).toEqual(LOCK_SECRET_MARKUP);
        expect(toSecretMarkup(input('lock-account-password'))).toEqual(ACCOUNT_PASSWORD_MARKUP);
    });

    // A browser takes the other text fields in a password field's form for user names, and offers to save them with it.
    it('keeps the account password in another form than the lock fields, with Save belonging to theirs', async () => {
        await showCard(WITH_PASSWORD);

        const lockForm = input('lock-new').form;

        expect(input('lock-repeat').form).toBe(lockForm);
        expect((findByText('button', 'Save') as HTMLButtonElement).form).toBe(lockForm);
        expect(input('lock-account-password').form).toBeInstanceOf(HTMLFormElement);
        expect(input('lock-account-password').form).not.toBe(lockForm);
    });

    it('saves when the account password’s form is submitted, as Enter in that field does', async () => {
        await showCard(NO_SECRET);
        await press(radio('password'));
        await fill({ 'lock-new': 'quiet-lantern', 'lock-repeat': 'quiet-lantern', 'lock-account-password': 'correct horse' });
        await act(async () => input('lock-account-password').form!.requestSubmit());
        await settle(10);

        expect(saves()).toEqual([{ account_password: 'correct horse', secret: { kind: 'password', value: 'quiet-lantern' } }]);
    });

    it('changes a PIN and clears the form', async () => {
        await showCard(WITH_PIN);
        await fill({ 'lock-new': '7350', 'lock-repeat': '7350', 'lock-account-password': 'correct horse' });
        await save();

        expect(saves()).toEqual([{ account_password: 'correct horse', secret: { kind: 'pin', value: '7350' } }]);
        expect([input('lock-new').value, input('lock-repeat').value, input('lock-account-password').value]).toEqual(['', '', '']);
    });

    it('switches to a lock password', async () => {
        await showCard(WITH_PIN);
        await press(radio('password'));
        await fill({ 'lock-new': 'quiet-lantern', 'lock-repeat': 'quiet-lantern', 'lock-account-password': 'correct horse' });
        await save();

        expect(saves()).toEqual([{ account_password: 'correct horse', secret: { kind: 'password', value: 'quiet-lantern' } }]);
        expect(card()?.textContent).toContain('They open with your lock password now.');
    });

    it('removes the secret by going back to the account password', async () => {
        await showCard(WITH_PIN);
        await press(radio('account_password'));

        expect(card()?.textContent).toContain('Saving removes your PIN.');

        await fill({ 'lock-account-password': 'correct horse' });
        await save();

        expect(saves()).toEqual([{ account_password: 'correct horse', secret: null }]);
        expect(card()?.textContent).toContain('They open with your account password now.');
        expect(findByText('button', 'Save')).toBeUndefined();
    });

    it('says when the account password is wrong, and keeps the session', async () => {
        await showCard(WITH_PIN);
        server.refusals = [toRefusal('account_password', null, 'Incorrect account password')];

        await fill({ 'lock-new': '7350', 'lock-repeat': '7350', 'lock-account-password': 'nope' });
        await save();

        expect(saves()).toHaveLength(1);
        expect(alertText()).toBe('Incorrect account password');
        expect(card()?.textContent).toContain('They open with your PIN now.');
        expect(server.refresh).not.toHaveBeenCalled();
        expect(server.logout).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it.each([
        { kind: 'pin', secret: '482', repeat: '482', problem: 'A PIN is exactly four digits.' },
        { kind: 'pin', secret: '4821', repeat: '4822', problem: 'The PINs do not match.' },
        { kind: 'password', secret: 'abc', repeat: 'abc', problem: 'A lock password is 4 to 128 characters.' },
        { kind: 'password', secret: 'abcd', repeat: 'abce', problem: 'The passwords do not match.' },
    ])('sends nothing while it can say "$problem"', async ({ kind, secret, repeat, problem }) => {
        await showCard(NO_SECRET);
        await press(radio(kind));
        await fill({ 'lock-new': secret, 'lock-repeat': repeat, 'lock-account-password': 'correct horse' });
        await save();

        expect(alertText()).toBe(problem);
        expect(saves()).toEqual([]);
    });
});

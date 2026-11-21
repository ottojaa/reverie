import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    const rows = new Map<string, { key: string; value: unknown; updated_at: Date; updated_by: string | null }>();

    return { rows, env: { TRASH_RETENTION_DAYS: 30 } };
});

vi.mock('../config/env.js', () => ({ env: h.env }));
vi.mock('./settings.store.js', () => ({
    fetchSettingRow: async (key: string) => h.rows.get(key),
    fetchSettingRows: async () => [...h.rows.values()],
    upsertSettingRow: async (key: string, value: unknown, updatedBy: string) => {
        h.rows.set(key, { key, value, updated_at: new Date('2026-11-19T12:00:00Z'), updated_by: updatedBy });
    },
    deleteSettingRow: async (key: string) => {
        h.rows.delete(key);
    },
}));

import { getSetting, listSettings, resetSetting, setSetting } from './settings.service.js';

const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

describe('settings service', () => {
    beforeEach(() => {
        h.rows.clear();
        h.env.TRASH_RETENTION_DAYS = 30;
    });

    it('reads the env default when no row exists', async () => {
        expect(await getSetting('trash.retentionDays')).toBe(30);

        h.env.TRASH_RETENTION_DAYS = 45;

        expect(await getSetting('trash.retentionDays')).toBe(45);
    });

    it('returns the new value on the very next read, without a restart', async () => {
        await setSetting('trash.retentionDays', 90, ADMIN_ID);

        expect(await getSetting('trash.retentionDays')).toBe(90);

        await setSetting('trash.retentionDays', 7, ADMIN_ID);

        expect(await getSetting('trash.retentionDays')).toBe(7);
    });

    it('reset removes the override and falls back to the default', async () => {
        await setSetting('trash.retentionDays', 90, ADMIN_ID);

        const item = await resetSetting('trash.retentionDays');

        expect(item).toMatchObject({ value: 30, default: 30, overridden: false, updated_at: null, updated_by: null });
        expect(await getSetting('trash.retentionDays')).toBe(30);
    });

    it.each([['30'], [0], [3651], [1.5], [null], [undefined], [true]])('refuses %j and stores nothing', async (bad) => {
        await expect(setSetting('trash.retentionDays', bad, ADMIN_ID)).rejects.toMatchObject({ statusCode: 400 });

        expect(h.rows.size).toBe(0);
    });

    it('accepts the range boundaries', async () => {
        await setSetting('trash.retentionDays', 1, ADMIN_ID);
        await setSetting('trash.retentionDays', 3650, ADMIN_ID);

        expect(await getSetting('trash.retentionDays')).toBe(3650);
    });

    it('refuses unknown keys with 404', async () => {
        await expect(setSetting('nope.nothing', 1, ADMIN_ID)).rejects.toMatchObject({ statusCode: 404 });
        await expect(resetSetting('nope.nothing')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('falls back to the default when a stored value no longer passes the schema', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        h.rows.set('trash.retentionDays', { key: 'trash.retentionDays', value: 99999, updated_at: new Date(), updated_by: null });

        expect(await getSetting('trash.retentionDays')).toBe(30);

        const [item] = await listSettings();

        expect(item).toMatchObject({ value: 30, overridden: false });
        expect(warn).toHaveBeenCalled();

        warn.mockRestore();
    });

    it('lists each setting with value, default, overridden flag and who changed it', async () => {
        expect(await listSettings()).toEqual([
            expect.objectContaining({ key: 'trash.retentionDays', value: 30, default: 30, overridden: false, updated_by: null }),
        ]);

        await setSetting('trash.retentionDays', 90, ADMIN_ID);

        expect(await listSettings()).toEqual([
            expect.objectContaining({
                key: 'trash.retentionDays',
                value: 90,
                default: 30,
                overridden: true,
                updated_at: '2026-11-19T12:00:00.000Z',
                updated_by: ADMIN_ID,
            }),
        ]);
    });
});

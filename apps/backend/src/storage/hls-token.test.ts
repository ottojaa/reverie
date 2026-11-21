import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config/env', () => ({ env: { FILE_URL_SECRET: 's'.repeat(40) } }));

import { isSetFilePath, toHlsUrl, verifyHlsToken } from './hls-token';

const HASH = 'a'.repeat(64);

/** The three token parts of `/files/hls/{exp}/{sig}/{hash}/{rest}`. */
function parse(url: string) {
    const [, , , exp = '', sig = '', key = '', ...rest] = url.split('/');

    return { exp, sig, key, rest: rest.join('/') };
}

afterEach(() => vi.useRealTimers());

describe('HLS tokens', () => {
    it('signs the master playlist URL with the expiry, signature and content hash in the path', () => {
        const { exp, sig, key, rest } = parse(toHlsUrl(HASH, 'master.m3u8', 3600));

        expect(key).toBe(HASH);
        expect(rest).toBe('master.m3u8');
        expect(Number(exp)).toBeGreaterThan(Date.now() / 1000);
        expect(verifyHlsToken(exp, sig, key)).toBe('ok');
    });

    it('matches the nginx check, md5 of "{exp}/hls/{hash}{secret}" as base64url', async () => {
        const { createHash } = await import('crypto');
        const { exp, sig } = parse(toHlsUrl(HASH, 'master.m3u8', 60));

        expect(sig).toBe(
            createHash('md5')
                .update(`${exp}/hls/${HASH}${'s'.repeat(40)}`)
                .digest('base64url'),
        );
    });

    it('refuses a changed signature, expiry or content hash', () => {
        const { exp, sig, key } = parse(toHlsUrl(HASH, 'master.m3u8', 3600));
        const other = 'b'.repeat(64);

        expect(verifyHlsToken(exp, sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A'), key)).toBe('invalid');
        expect(verifyHlsToken(String(Number(exp) + 1), sig, key)).toBe('invalid');
        expect(verifyHlsToken(exp, sig, other)).toBe('invalid');
        expect(verifyHlsToken(exp, '', key)).toBe('invalid');
        expect(verifyHlsToken('abc', sig, key)).toBe('invalid');
        expect(verifyHlsToken(exp, sig, '../' + key)).toBe('invalid');
    });

    it('reports a correctly signed token as expired once its time has passed', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

        const { exp, sig, key } = parse(toHlsUrl(HASH, 'master.m3u8', 60));

        vi.setSystemTime(new Date('2026-01-01T00:01:00Z'));
        expect(verifyHlsToken(exp, sig, key)).toBe('ok');
        vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
        expect(verifyHlsToken(exp, sig, key)).toBe('expired');
    });
});

describe('files inside a set', () => {
    it('accepts playlists, init files and segments, nested one level or more', () => {
        for (const path of ['master.m3u8', 'v720/index.m3u8', 'v720/init_0.mp4', 'v1080/seg_00012.m4s']) expect(isSetFilePath(path), path).toBe(true);
    });

    it('refuses anything that could leave the set', () => {
        for (const path of ['', '..', '../x', 'v720/../../x', './x', 'v720/..', 'a//b', '/abs', 'a/', 'a b', 'a\\b', 'a%2e%2e/b'])
            expect(isSetFilePath(path), path).toBe(false);
    });
});

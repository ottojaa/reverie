import { format } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadEnv() {
    vi.resetModules();

    return (await import('./env.js')).env;
}

describe('TRASH_RETENTION_DAYS', () => {
    beforeEach(() => {
        // A missing env file keeps the developer's own .env out of the test.
        vi.stubEnv('ENV_FILE', '.env.does-not-exist');
        vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/test');
        vi.stubEnv('JWT_SECRET', 'x'.repeat(32));
        vi.stubEnv('FILE_URL_SECRET', 'y'.repeat(32));
        vi.stubEnv('TRASH_RETENTION_DAYS', '');
        delete process.env.TRASH_RETENTION_DAYS;
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('defaults to 30 days when unset', async () => {
        expect((await loadEnv()).TRASH_RETENTION_DAYS).toBe(30);
    });

    it('takes the value from the environment', async () => {
        vi.stubEnv('TRASH_RETENTION_DAYS', '45');

        expect((await loadEnv()).TRASH_RETENTION_DAYS).toBe(45);
    });
});

describe('TRUST_PROXY', () => {
    beforeEach(() => {
        vi.stubEnv('ENV_FILE', '.env.does-not-exist');
        vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/test');
        vi.stubEnv('JWT_SECRET', 'x'.repeat(32));
        vi.stubEnv('FILE_URL_SECRET', 'y'.repeat(32));
        vi.stubEnv('TRUST_PROXY', '');
        delete process.env.TRUST_PROXY;
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    it('trusts no proxy when unset', async () => {
        expect((await loadEnv()).TRUST_PROXY).toBeUndefined();
    });

    it('fails startup on a hop count and prints the variable and the entry', async () => {
        vi.stubEnv('TRUST_PROXY', '172.18.0.1,1');

        const logged: string[] = [];

        vi.spyOn(console, 'error').mockImplementation((...args) => {
            logged.push(format(...args));
        });
        vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('exit');
        });

        await expect(loadEnv()).rejects.toThrow('exit');
        expect(logged.join('\n')).toContain('TRUST_PROXY');
        expect(logged.join('\n')).toContain('Not an IP address or CIDR range to trust: "1"');
    });
});

describe('boolean flags', () => {
    const FLAGS = [
        { name: 'LLM_ENABLED', fallback: true },
        { name: 'LLM_PROCESS_CODE_FILES', fallback: false },
        { name: 'LLM_VISION_ENABLED', fallback: false },
        { name: 'WS_ENABLED', fallback: true },
    ] as const;

    beforeEach(() => {
        vi.stubEnv('ENV_FILE', '.env.does-not-exist');
        vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/test');
        vi.stubEnv('JWT_SECRET', 'x'.repeat(32));
        vi.stubEnv('FILE_URL_SECRET', 'y'.repeat(32));

        for (const { name } of FLAGS) delete process.env[name];
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
    });

    for (const { name, fallback } of FLAGS) {
        it(`${name} keeps its default of ${fallback} when unset`, async () => {
            expect((await loadEnv())[name]).toBe(fallback);
        });

        for (const value of ['false', '0', 'FALSE', 'False', ' false ']) {
            it(`${name}="${value}" is false`, async () => {
                vi.stubEnv(name, value);

                expect((await loadEnv())[name]).toBe(false);
            });
        }

        for (const value of ['true', '1', 'TRUE', 'True']) {
            it(`${name}="${value}" is true`, async () => {
                vi.stubEnv(name, value);

                expect((await loadEnv())[name]).toBe(true);
            });
        }

        for (const value of ['yes', 'flase', 'no', 'on', '2', '']) {
            it(`${name}="${value}" fails startup and names the variable`, async () => {
                vi.stubEnv(name, value);

                const logged: string[] = [];

                vi.spyOn(console, 'error').mockImplementation((...args) => {
                    logged.push(JSON.stringify(args));
                });
                vi.spyOn(process, 'exit').mockImplementation(() => {
                    throw new Error('exit');
                });

                await expect(loadEnv()).rejects.toThrow('exit');
                expect(process.exit).toHaveBeenCalledWith(1);
                expect(logged.join('\n')).toContain(name);
            });
        }
    }
});

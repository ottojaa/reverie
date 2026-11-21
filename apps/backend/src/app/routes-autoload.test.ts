import AutoLoad from '@fastify/autoload';
import Fastify from 'fastify';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AUTOLOAD_IGNORE_PATTERN } from './app.js';

/**
 * Everything under `plugins/` and `routes/` is autoloaded at start-up, in production too. A test file
 * there imports vitest, which the production image does not have, and the server crash-loops.
 */

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function listFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);

        return entry.isDirectory() ? listFiles(path) : [path];
    });
}

describe('autoloaded folders', () => {
    it.each(['plugins', 'routes'])('hold no test file under app/%s (put it next to app.ts)', (folder) => {
        const root = join(__dirname, folder);
        const offenders = listFiles(root)
            .filter((file) => TEST_FILE.test(file))
            .map((file) => relative(__dirname, file));

        expect(offenders).toEqual([]);
    });
});

describe('autoload ignore pattern', () => {
    let dir: string | null = null;

    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true });

        dir = null;
    });

    it('skips test files and still loads the routes beside them', async () => {
        dir = mkdtempSync(join(tmpdir(), 'autoload-'));
        mkdirSync(join(dir, 'nested'));
        writeFileSync(join(dir, 'ok.js'), "module.exports = async (f) => { f.get('/ok', async () => 'ok'); };");

        for (const name of ['bad.test.js', 'bad.spec.js', 'bad.test.cjs', 'nested/bad.test.js']) {
            writeFileSync(join(dir, name), "throw new Error('a test file was autoloaded');");
        }

        const server = Fastify();
        server.register(AutoLoad, { dir, ignorePattern: AUTOLOAD_IGNORE_PATTERN });

        const res = await server.inject({ method: 'GET', url: '/ok' });

        expect(res.statusCode).toBe(200);
        await server.close();
    });
});

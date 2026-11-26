import multipart from '@fastify/multipart';
import Fastify from 'fastify';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toUploadCommand } from './upload-command';

const runShell = promisify(execFile);

/** Names that the shell or curl's -F syntax would read as something else if they were not quoted. */
const AWKWARD = [
    'with space.txt',
    'semi;colon.txt',
    'com,ma.txt',
    'double "quote".txt',
    "single 'quote'.txt",
    'all ;,"\' at once.txt',
    'dollar $HOME `id` $(id).txt',
    'amp & pipe | (paren) #hash.txt',
    'brackets [1] {a}.txt',
    'type=@x;type=text<y.txt',
    '-leading-dash.txt',
    'kuitti ä€.txt',
];

describe('the upload command', () => {
    const app = Fastify();
    let url: string;
    let home: string;

    beforeAll(async () => {
        home = await mkdtemp(join(tmpdir(), 'reverie-curl-'));
        await app.register(multipart);
        app.post('/mcp/upload', async (request) => {
            const received: Array<{ filename: string; content: string }> = [];

            for await (const part of request.files()) received.push({ filename: part.filename, content: (await part.toBuffer()).toString() });

            return { token: request.headers['x-upload-token'], received };
        });
        url = (await app.listen({ port: 0, host: '127.0.0.1' })) + '/mcp/upload';
    });
    afterAll(async () => {
        await app.close();
        await rm(home, { recursive: true, force: true });
    });

    async function send(paths: string[]) {
        const command = toUploadCommand({ url, secret: 'the-secret', paths });
        // Run as a client would: by a shell, with its own HOME.
        const { stdout } = await runShell('sh', ['-c', command], { env: { ...process.env, HOME: home } });

        return JSON.parse(stdout) as { token: string; received: Array<{ filename: string; content: string }> };
    }

    async function write(path: string): Promise<string> {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, 'content of ' + path);

        return path;
    }

    it('sends awkward absolute paths under their own names, with the secret in a header', async () => {
        const paths = await Promise.all(AWKWARD.map((name) => write(join(home, 'odd ;,"\' dir', name))));
        const { token, received } = await send(paths);

        expect(token).toBe('the-secret');
        expect(received).toEqual(AWKWARD.map((name, index) => ({ filename: name, content: 'content of ' + paths[index] })));
    });

    it('expands ~/ to the home directory and leaves the rest of the path alone', async () => {
        const names = ['plain.txt', 'dir $x ~/it\'s "here"; a,b.txt'];
        const written = await Promise.all(names.map((name) => write(join(home, name))));
        const { received } = await send(names.map((name) => '~/' + name));

        expect(received.map((file) => file.content)).toEqual(written.map((path) => 'content of ' + path));
        expect(received.map((file) => file.filename)).toEqual(['plain.txt', 'it\'s "here"; a,b.txt']);
    });

    it('keeps the secret out of the URL', () => {
        const command = toUploadCommand({ url: 'https://example.test/mcp/upload', secret: 'the-secret', paths: ['/a.pdf'] });

        expect(command).toBe("curl -sS --form-escape -H 'X-Upload-Token: the-secret' -F 'file=@\"/a.pdf\"' 'https://example.test/mcp/upload'");
    });
});

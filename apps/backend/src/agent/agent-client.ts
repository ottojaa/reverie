import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import type { AgentStatus } from '@reverie/shared';
import { env } from '../config/env.js';

/**
 * Talks to the reverie-agent wrapper over the compose network. Plain node:http, not fetch: a run can
 * stream for many minutes and fetch's body timeout would cut it off.
 */

export class AgentUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AgentUnavailableError';
    }
}

export interface AgentRunRequest {
    prompt: string;
    sessionId: string | null;
    mcpToken: string;
}

/**
 * The shared secret: inline in dev, otherwise a file in the agent_secret volume. The backend owns it (it runs as
 * root, so it can write the volume whichever container started first); the agent mounts it read-only.
 */
async function loadSecret(): Promise<string> {
    if (env.AGENT_SECRET) return env.AGENT_SECRET;

    if (!env.AGENT_SECRET_FILE) throw new AgentUnavailableError('Agent secret is not configured');

    try {
        return (await readFile(env.AGENT_SECRET_FILE, 'utf8')).trim();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new AgentUnavailableError('Agent secret is unreadable');

        return createSecretFile(env.AGENT_SECRET_FILE);
    }
}

async function createSecretFile(path: string): Promise<string> {
    const secret = randomBytes(32).toString('base64url');

    try {
        await mkdir(dirname(path), { recursive: true });
        // Tmp file + rename so the agent never reads a half-written secret. World-readable: the agent runs as another user.
        await writeFile(path + '.tmp', secret, { mode: 0o644 });
        await rename(path + '.tmp', path);
    } catch {
        throw new AgentUnavailableError('Agent secret could not be created');
    }

    return secret;
}

async function request(method: 'GET' | 'POST', path: string, body: unknown, signal?: AbortSignal): Promise<http.IncomingMessage> {
    if (!env.AGENT_URL) throw new AgentUnavailableError('Agent is not configured');

    const secret = await loadSecret();
    const payload = body === undefined ? undefined : JSON.stringify(body);

    return new Promise((resolve, reject) => {
        const req = http.request(
            new URL(path, env.AGENT_URL),
            {
                method,
                signal,
                headers: {
                    authorization: 'Bearer ' + secret,
                    ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
                },
            },
            resolve,
        );

        req.on('error', (error) => reject(signal?.aborted ? error : new AgentUnavailableError('Agent is unreachable: ' + error.message)));
        req.end(payload);
    });
}

/** Runs one prompt and yields claude's stream-json lines as they arrive. Aborting the signal stops claude. */
export async function* streamAgentRun(run: AgentRunRequest, signal: AbortSignal): AsyncGenerator<string> {
    const response = await request('POST', '/run', run, signal);

    if (response.statusCode !== 200) {
        response.resume();
        throw new AgentUnavailableError('Agent refused the run: ' + response.statusCode);
    }

    for await (const line of createInterface({ input: response, crlfDelay: Infinity })) {
        if (line) yield line;
    }
}

async function readJson(response: http.IncomingMessage): Promise<unknown> {
    let text = '';

    for await (const chunk of response) text += String(chunk);

    return JSON.parse(text) as unknown;
}

export async function fetchAgentStatus(): Promise<AgentStatus> {
    try {
        const response = await request('GET', '/status', undefined, AbortSignal.timeout(10_000));

        if (response.statusCode !== 200) return { state: 'unavailable' };

        const body = (await readJson(response)) as { signedIn?: unknown };

        return { state: body.signedIn === true ? 'ready' : 'not_signed_in' };
    } catch {
        return { state: 'unavailable' };
    }
}

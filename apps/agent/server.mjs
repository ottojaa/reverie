// The reverie-agent wrapper: a tiny HTTP server in front of the stock `claude` binary.
// The backend POSTs {prompt, sessionId, mcpToken} to /run; claude's stream-json output comes back as NDJSON.
// It holds no library data and no credentials of its own: the MCP token arrives per request.
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { buildClaudeArgs } from './claude-args.mjs';

const PORT = Number(process.env.PORT ?? 8080);
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude';
const MCP_URL = process.env.REVERIE_MCP_URL ?? 'http://backend:3000/mcp';
const SECRET_FILE = process.env.AGENT_SECRET_FILE ?? '/run/reverie-agent/secret';
const RUN_TIMEOUT_MS = 15 * 60_000;
const MAX_RUNS = 2;
const MAX_BODY_BYTES = 64 * 1024;

/** The shared secret: from the environment, else a file the backend generates in a volume this container mounts read-only. */
function loadSecret() {
    if (process.env.AGENT_SECRET) return process.env.AGENT_SECRET;

    try {
        return readFileSync(SECRET_FILE, 'utf8').trim();
    } catch {
        return null;
    }
}

function isAuthorized(request) {
    // Read per request: the file appears when the backend first starts, which may be after this container.
    const wanted = loadSecret();

    if (!wanted) return false;

    const given = Buffer.from((request.headers.authorization ?? '').replace(/^Bearer /, ''));
    const expected = Buffer.from(wanted);

    return given.length === expected.length && timingSafeEqual(given, expected);
}

let activeRuns = 0;

function readJson(request) {
    return new Promise((resolve, reject) => {
        let body = '';

        request.on('data', (chunk) => {
            body += chunk;
            if (body.length > MAX_BODY_BYTES) reject(new Error('Body too large'));
        });
        request.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error('Invalid JSON'));
            }
        });
    });
}

function sendJson(response, status, body) {
    response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function handleStatus(response) {
    const child = spawn(CLAUDE_BIN, ['auth', 'status', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';

    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('error', () => sendJson(response, 200, { signedIn: false }));
    child.on('close', () => {
        try {
            sendJson(response, 200, { signedIn: JSON.parse(out).loggedIn === true });
        } catch {
            sendJson(response, 200, { signedIn: false });
        }
    });
}

async function handleRun(request, response) {
    const body = await readJson(request).catch(() => null);

    if (!body || typeof body.prompt !== 'string' || !body.prompt || typeof body.mcpToken !== 'string' || !body.mcpToken) {
        return sendJson(response, 400, { error: 'Invalid request' });
    }

    if (activeRuns >= MAX_RUNS) return sendJson(response, 429, { error: 'Too many runs' });

    activeRuns++;
    const args = buildClaudeArgs({ sessionId: body.sessionId, mcpUrl: MCP_URL, mcpToken: body.mcpToken, model: process.env.AGENT_MODEL });
    const child = spawn(CLAUDE_BIN, args, { cwd: process.env.AGENT_CWD ?? '/work', stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), RUN_TIMEOUT_MS);

    response.writeHead(200, { 'content-type': 'application/x-ndjson' });
    child.stdin.end(body.prompt);
    child.stdout.pipe(response, { end: false });
    child.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)));
    // The backend hanging up (stop button, restart) must stop claude, or it keeps spending the plan.
    response.on('close', () => child.kill('SIGKILL'));
    child.on('error', (error) => finish(-1, error.message));
    child.on('close', (code) => finish(code ?? -1, stderr));

    let finished = false;

    function finish(code, tail) {
        if (finished) return;

        finished = true;
        activeRuns--;
        clearTimeout(timer);
        response.end(JSON.stringify({ type: 'wrapper_exit', code, stderr: tail }) + '\n');
    }
}

const server = createServer((request, response) => {
    if (request.url === '/health') return sendJson(response, 200, { ok: true });

    if (!isAuthorized(request)) return sendJson(response, 401, { error: 'Unauthorized' });

    if (request.method === 'GET' && request.url === '/status') return handleStatus(response);

    if (request.method === 'POST' && request.url === '/run') return void handleRun(request, response);

    sendJson(response, 404, { error: 'Not found' });
});

server.listen(PORT, '0.0.0.0', () => console.log('reverie-agent listening on ' + PORT));

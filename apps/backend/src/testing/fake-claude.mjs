#!/usr/bin/env node
// A stand-in for the `claude` binary, for tests that drive the reverie-agent wrapper end to end.
// It records how it was started, answers `auth status --json`, and plays a scripted run chosen by the prompt:
//   "call {json}"   makes one real /mcp tools/call ({name, input}) with the token from --mcp-config, then answers
//   "signed-out"    ends the way a signed-out claude does
//   "crash"         exits non-zero with nothing on stdout
//   "hold"          streams a little text, then waits until the file `release` appears (or it is killed)
//   "long"          answers with a long markdown reply
//   anything else   answers with plain text
// FAKE_CLAUDE_DIR holds its state: runs.jsonl (one record per run) and a `signed-out` marker file.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.env.FAKE_CLAUDE_DIR;
const args = process.argv.slice(2);
const emit = (line) => process.stdout.write(JSON.stringify(line) + '\n');

if (args[0] === 'auth') {
    console.log(JSON.stringify({ loggedIn: !existsSync(join(dir, 'signed-out')) }));
    process.exit(0);
}

const prompt = readFileSync(0, 'utf8');

appendFileSync(join(dir, 'runs.jsonl'), JSON.stringify({ args, prompt, cwd: process.cwd() }) + '\n');

const SESSION = 'session-' + (args.includes('--resume') ? args[args.indexOf('--resume') + 1] : 'new');
const mcpConfig = JSON.parse(args[args.indexOf('--mcp-config') + 1]);
const { url, headers } = mcpConfig.mcpServers.reverie;

async function callTool({ name, input }) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: input } }),
    });
    const body = await response.json();

    if (!body.result) return { isError: true, text: JSON.stringify(body.error ?? { status: response.status }) };

    return { isError: body.result.isError === true, text: body.result.content[0].text };
}

emit({ type: 'system', subtype: 'init', session_id: SESSION, tools: [], mcp_servers: [{ name: 'reverie', status: 'connected' }] });

if (prompt === 'crash') {
    process.stderr.write('claude crashed\n');
    process.exit(1);
}

if (prompt === 'signed-out') {
    emit({
        type: 'assistant',
        error: 'authentication_failed',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Not logged in · Please run /login' }] },
    });
    emit({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', session_id: SESSION });
    process.exit(1);
}

function textDelta(text) {
    emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
}

if (prompt === 'hold') {
    writeFileSync(join(dir, 'started'), String(process.pid));
    textDelta('Looking through your library ');
    textDelta('for anything that matches. ');

    while (!existsSync(join(dir, 'release'))) await new Promise((resolve) => setTimeout(resolve, 100));
}

if (prompt === 'long') {
    const paragraphs = [
        'I went through the **Invoices** folder and found three groups worth tidying:',
        '1. Acme Oy invoices from 2023 are spread over `Work` and `Loose` and have no shared tags.\n2. Two scanned receipts from the Helsinki trip have filenames like `IMG_20240312_0001.pdf` that say nothing about them.\n3. A handful of `notes` files in the root look like they belong under `Work/Roadmap`.',
        'Nothing has been changed yet. Tell me which of these you want and I will do it, and each change can be undone from this chat.',
    ];

    for (const paragraph of paragraphs) textDelta(paragraph + '\n\n');
}

if (prompt.startsWith('call ')) {
    const call = JSON.parse(prompt.slice('call '.length));

    textDelta('Working on it. ');
    emit({
        type: 'assistant',
        message: {
            role: 'assistant',
            content: [
                { type: 'text', text: 'Working on it. ' },
                { type: 'tool_use', id: 'toolu_1', name: 'mcp__reverie__' + call.name, input: call.input },
            ],
        },
    });

    const result = await callTool(call);

    emit({
        type: 'user',
        message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: result.isError, content: [{ type: 'text', text: result.text }] }],
        },
    });
}

const closing = prompt === 'long' ? '' : 'Done.';

if (closing) textDelta(closing);

emit({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: closing }] } });
emit({ type: 'result', subtype: 'success', is_error: false, result: closing, session_id: SESSION });

#!/usr/bin/env node
// A stand-in for ocr_service/ocr_runner.py (used as PYTHON_PATH): the same line protocol, no models.
// A result's text is the request it answers, as JSON. By the request's image path:
//   containing "slow"     answered only when the next request arrives, as the real runner, which takes one at a time,
//                         answers a request its client has given up on
//   containing "broken"   answered with an error
//   anything else         answered at once
// With FAKE_OCR_STARTUP_ERROR set it fails to start, saying that, as the real runner does: without an id.
import { createInterface } from 'node:readline';

const emit = (line) => process.stdout.write(JSON.stringify(line) + '\n');
const answer = (request) => {
    const result = request.image_path.includes('broken') ? { error: 'broken image' } : { text: JSON.stringify(request), confidence: 90, blocks: [] };

    emit({ ...result, ...(request.id !== undefined && { id: request.id }) });
};

let held = null;

if (process.env.FAKE_OCR_STARTUP_ERROR) {
    emit({ error: process.env.FAKE_OCR_STARTUP_ERROR });
} else {
    emit({ ready: true });
}

createInterface({ input: process.stdin }).on('line', (line) => {
    const request = JSON.parse(line);

    if (request.image_path.includes('slow')) {
        held = request;

        return;
    }

    if (held) answer(held);

    held = null;
    answer(request);
});

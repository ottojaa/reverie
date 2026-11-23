import { describe, expect, it } from 'vitest';
import type { DocumentKind } from '../api/schemas/documents.js';
import { documentKindOf } from './document.js';

// The same table lives in the Android DocumentKindTest: keep the two in step.
const CASES: Array<[string, DocumentKind]> = [
    ['image/jpeg', 'image'],
    ['IMAGE/JPEG', 'image'],
    ['image/svg+xml', 'image'],
    ['image/heic', 'image'],
    ['video/mp4', 'video'],
    ['video/quicktime', 'video'],
    ['Video/X-Matroska', 'video'],
    ['application/pdf', 'file'],
    ['audio/mpeg', 'file'],
    ['text/markdown', 'file'],
    ['application/zip', 'file'],
    ['application/octet-stream', 'file'],
    ['', 'file'],
    ['image', 'file'],
    [' image/png', 'file'],
];

describe('documentKindOf', () => {
    it.each(CASES)('reads %j as %s', (mime, kind) => {
        expect(documentKindOf(mime)).toBe(kind);
    });
});

import { describe, expect, it } from 'vitest';
import { getThumbnailStrategy } from './thumbnail-strategy';

const OCTET = 'application/octet-stream';

describe('getThumbnailStrategy', () => {
    it('routes images (including svg) to the image path', () => {
        expect(getThumbnailStrategy('image/png', 'photo.png')).toBe('image');
        expect(getThumbnailStrategy('image/jpeg', 'photo.jpg')).toBe('image');
        expect(getThumbnailStrategy('image/heic', 'IMG_1.heic')).toBe('image');
        expect(getThumbnailStrategy('image/svg+xml', 'logo.svg')).toBe('image');
    });

    it('routes pdf and video', () => {
        expect(getThumbnailStrategy('application/pdf', 'doc.pdf')).toBe('pdf');
        expect(getThumbnailStrategy('video/mp4', 'clip.mp4')).toBe('video');
        expect(getThumbnailStrategy('video/quicktime', 'clip.mov')).toBe('video');
    });

    it('routes office docs by extension even when MIME is generic', () => {
        expect(getThumbnailStrategy(OCTET, 'report.docx')).toBe('office');
        expect(getThumbnailStrategy(OCTET, 'budget.xlsx')).toBe('office');
        expect(getThumbnailStrategy(OCTET, 'deck.pptx')).toBe('office');
        expect(getThumbnailStrategy(OCTET, 'legacy.doc')).toBe('office');
        expect(getThumbnailStrategy(OCTET, 'legacy.xls')).toBe('office');
        expect(getThumbnailStrategy(OCTET, 'notes.odt')).toBe('office');
        expect(getThumbnailStrategy(OCTET, 'memo.rtf')).toBe('office');
    });

    it('routes office docs by MIME', () => {
        expect(getThumbnailStrategy('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'x')).toBe('office');
        expect(getThumbnailStrategy('application/msword', 'x')).toBe('office');
        expect(getThumbnailStrategy('application/vnd.oasis.opendocument.presentation', 'x')).toBe('office');
    });

    it('routes text/code/config/data to the text path', () => {
        expect(getThumbnailStrategy('text/markdown', 'README.md')).toBe('text');
        expect(getThumbnailStrategy('text/csv', 'rows.csv')).toBe('text');
        expect(getThumbnailStrategy(OCTET, 'main.py')).toBe('text');
        expect(getThumbnailStrategy(OCTET, 'app.ts')).toBe('text');
        expect(getThumbnailStrategy(OCTET, 'config.yaml')).toBe('text');
        expect(getThumbnailStrategy(OCTET, 'data.json')).toBe('text');
        expect(getThumbnailStrategy(OCTET, 'server.log')).toBe('text');
        expect(getThumbnailStrategy('text/plain', 'noext')).toBe('text');
    });

    it('treats conventional extension-less files as text', () => {
        expect(getThumbnailStrategy(OCTET, 'Dockerfile')).toBe('text');
        expect(getThumbnailStrategy(OCTET, 'Makefile')).toBe('text');
    });

    it('returns none for audio, archives, and unknown binaries (icon fallback)', () => {
        expect(getThumbnailStrategy('audio/mpeg', 'song.mp3')).toBe('none');
        expect(getThumbnailStrategy('application/zip', 'bundle.zip')).toBe('none');
        expect(getThumbnailStrategy(OCTET, 'installer.bin')).toBe('none');
        expect(getThumbnailStrategy(OCTET, 'mystery.xyz')).toBe('none');
    });
});

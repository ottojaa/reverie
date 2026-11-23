import type { Document } from '@reverie/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentThumbnail } from './DocumentThumbnail';

function render(mimeType: string): string {
    const document = { id: 'd1', mime_type: mimeType, original_filename: 'clip.bin', thumbnail_status: 'pending', duration_seconds: 75 } as Document;

    return renderToStaticMarkup(createElement(DocumentThumbnail, { document }));
}

describe('DocumentThumbnail', () => {
    // Uploads keep a MIME type as the sender wrote it, and the Videos tab lists `Video/MP4` by the same case-insensitive rule.
    it('shows the duration of a video whatever the case of its MIME type', () => {
        expect(render('video/mp4')).toContain('1:15');
        expect(render('Video/MP4')).toContain('1:15');
    });

    it('shows no duration on a file', () => {
        expect(render('application/pdf')).not.toContain('1:15');
    });
});

import { describe, expect, it } from 'vitest';
import { fileTypeLabel } from './file-type-label';

// The same cases as the Android app's FileTypeLabelTest: the two must label a file alike.
describe('fileTypeLabel', () => {
    it('uses the extension, in capitals, when it is 4 characters or fewer', () => {
        expect(fileTypeLabel('application/zip', 'backup.zip')).toBe('ZIP');
        expect(fileTypeLabel('application/zip', 'Backup.ZiP')).toBe('ZIP');
        expect(fileTypeLabel('text/markdown', 'notes.docx')).toBe('DOCX');
    });

    it('uses the last extension of a name with several', () => {
        expect(fileTypeLabel('application/gzip', 'archive.tar.gz')).toBe('GZ');
    });

    it('falls back to the MIME type when the extension is longer than 4 characters', () => {
        expect(fileTypeLabel('text/markdown', 'notes.markdown')).toBe('TXT');
        expect(fileTypeLabel('application/octet-stream', 'script.javascript')).toBe('FILE');
    });

    it('falls back to the MIME type when the name has no extension', () => {
        expect(fileTypeLabel('application/pdf', 'report')).toBe('PDF');
        expect(fileTypeLabel('application/json', 'data.')).toBe('JSON');
        expect(fileTypeLabel('text/plain', 'Makefile')).toBe('TXT');
        expect(fileTypeLabel('application/octet-stream', 'mystery')).toBe('FILE');
        expect(fileTypeLabel('', 'mystery')).toBe('FILE');
    });

    it('labels a card block, which knows only an extension, FILE once the extension is long', () => {
        expect(fileTypeLabel('', 'file.apk')).toBe('APK');
        expect(fileTypeLabel('', 'file.markdown')).toBe('FILE');
    });
});

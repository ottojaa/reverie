import { describe, expect, it } from 'vitest';
import { detectScreenshot, isVisualCategory } from './category-classifier';

const png = (filename: string, width: number, height: number) => ({ filename, mimeType: 'image/png', imageSize: { width, height } });
const jpg = (filename: string, width: number, height: number) => ({ filename, mimeType: 'image/jpeg', imageSize: { width, height } });

describe('detectScreenshot', () => {
    it('matches macOS screenshot filenames', () => {
        expect(detectScreenshot(jpg('Screenshot 2026-01-02 at 10.30.00.png', 1000, 800))).toBe(true);
        expect(detectScreenshot(jpg('Screen Shot 2020-05-01.png', 1000, 800))).toBe(true);
    });

    it('matches Android / capture filenames', () => {
        expect(detectScreenshot(png('Screenshot_20260102-103000.png', 400, 300))).toBe(true);
        expect(detectScreenshot(png('screencapture-example.png', 400, 300))).toBe(true);
        expect(detectScreenshot(png('screen grab.png', 400, 300))).toBe(true);
    });

    it('matches PNGs at exact device resolutions in either orientation', () => {
        expect(detectScreenshot(png('IMG_1234.PNG', 1170, 2532))).toBe(true); // iPhone portrait
        expect(detectScreenshot(png('capture.png', 1920, 1080))).toBe(true); // desktop landscape
        expect(detectScreenshot(png('shot.png', 1080, 1920))).toBe(true); // same, portrait
    });

    it('does not match real photos or scans', () => {
        expect(detectScreenshot(jpg('IMG_4032.JPG', 4032, 3024))).toBe(false); // camera photo
        expect(detectScreenshot(png('Scan.png', 2480, 3508))).toBe(false); // A4 @ 300dpi scan
        expect(detectScreenshot(jpg('sunscreen.jpg', 1170, 2532))).toBe(false); // "screen" substring, not PNG, not a marker
        expect(detectScreenshot(png('logo.png', 800, 600))).toBe(false); // graphic at non-screen size
    });
});

describe('isVisualCategory', () => {
    it('is true for the non-text visual categories', () => {
        expect(isVisualCategory('screenshot')).toBe(true);
        expect(isVisualCategory('photo')).toBe(true);
        expect(isVisualCategory('graphic')).toBe(true);
        expect(isVisualCategory('video')).toBe(true);
    });

    it('is false for text categories and null', () => {
        expect(isVisualCategory('other')).toBe(false);
        expect(isVisualCategory('invoice')).toBe(false);
        expect(isVisualCategory(null)).toBe(false);
    });
});

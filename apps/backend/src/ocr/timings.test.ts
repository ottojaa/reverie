import { afterEach, expect, it, vi } from 'vitest';
import { logOcrTimings } from './timings';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
});

it('logs the phase timings as one line in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    logOcrTimings('doc-1', { preprocessMs: 12, ocrEngineMs: 340, totalMs: 400 });

    expect(info).toHaveBeenCalledExactlyOnceWith('[OCRService] process timings', '{"documentId":"doc-1","preprocessMs":12,"ocrEngineMs":340,"totalMs":400}');
});

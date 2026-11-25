import { describe, expect, it } from 'vitest';
import { toPublicBaseUrl } from './public-base-url.js';

const request = (headers: Record<string, string>) => ({ headers, protocol: 'http' });

describe('the public base URL', () => {
    it('is the configured URL when there is one, path prefix included', () => {
        expect(toPublicBaseUrl(request({ host: 'internal:3000' }), 'https://example.test/api/')).toBe('https://example.test/api');
    });

    it('is otherwise the origin the proxy says the request came in on', () => {
        const headers = { host: 'internal:3000', 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'docs.example.test, internal' };

        expect(toPublicBaseUrl(request(headers), undefined)).toBe('https://docs.example.test');
        expect(toPublicBaseUrl(request({ host: 'api.example.test', 'x-forwarded-proto': 'https' }), undefined)).toBe('https://api.example.test');
    });

    it('is the Host header without a proxy, and unknown without that', () => {
        expect(toPublicBaseUrl(request({ host: 'localhost:3000' }), undefined)).toBe('http://localhost:3000');
        expect(toPublicBaseUrl(request({}), undefined)).toBeUndefined();
    });
});

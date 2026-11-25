import type { IncomingHttpHeaders } from 'node:http';

/** The first value of a header a chain of proxies may have appended to. */
function toFirstValue(header: string | string[] | undefined): string | undefined {
    const text = Array.isArray(header) ? header[0] : header;

    return text?.split(',')[0]?.trim() || undefined;
}

interface Origin {
    headers: IncomingHttpHeaders;
    protocol: string;
}

/**
 * Where the caller reaches this server, without a trailing slash: the configured public URL, else
 * the origin the request came in on. A proxy that serves the API under a path prefix is invisible
 * in the request, so such a setup has to configure the URL.
 */
export function toPublicBaseUrl(request: Origin, configuredUrl: string | undefined): string | undefined {
    if (configuredUrl) return configuredUrl.replace(/\/+$/, '');

    const protocol = toFirstValue(request.headers['x-forwarded-proto']) ?? request.protocol;
    const host = toFirstValue(request.headers['x-forwarded-host']) ?? toFirstValue(request.headers.host);

    return host ? protocol + '://' + host : undefined;
}

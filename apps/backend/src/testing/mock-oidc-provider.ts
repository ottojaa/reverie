import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A local OpenID Connect provider for tests: discovery, JWKS, authorize, token and userinfo endpoints, signing its own
 * ID tokens. `next` bends the next token (wrong audience, expired, signed with a stranger's key...) and `person` is who
 * signs in. `authorize` plays the browser's visit to the provider and returns where it sends the browser back.
 *
 * `publicUrl` is the issuer name the provider claims (e.g. `https://accounts.google.com`) while it really listens on
 * `origin`; a test routes that name to the origin by wrapping `fetch`. Without it the issuer is the origin itself.
 */

export interface MockPerson {
    sub: string;
    email?: string;
    email_verified?: boolean;
}

export interface TokenBends {
    aud?: string | string[];
    iss?: string;
    nonce?: string;
    azp?: string;
    /** Seconds from now; negative = already expired. */
    expiresIn?: number;
    /** Sign with a key that is not in the provider's JWKS. */
    signWithStrangerKey?: boolean;
    /** Put the email facts in userinfo only, as Authelia does. */
    emailInUserinfoOnly?: boolean;
}

export interface MockOidc {
    issuer: string;
    /** Where the provider really listens (http://127.0.0.1:port). */
    origin: string;
    clientId: string;
    clientSecret: string;
    person: MockPerson;
    next: TokenBends;
    /** Every request the provider got, by endpoint. */
    authorizeRequests: URLSearchParams[];
    tokenRequests: { body: URLSearchParams; authorization: string | undefined }[];
    /** Token endpoint client auth methods advertised in discovery. */
    setAuthMethods: (methods: string[]) => void;
    /** Visit the authorization URL as a browser and return the Location it redirects to (back to the app). */
    authorize: (authorizationUrl: string) => Promise<string>;
    close: () => Promise<void>;
}

export const MOCK_CLIENT_SECRET = 'mock-client-secret';

const base64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

function signJwt(claims: Record<string, unknown>, key: KeyObject, kid: string): string {
    const head = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
    const body = base64url(JSON.stringify(claims));
    const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key);

    return `${head}.${body}.${base64url(signature)}`;
}

async function readBody(request: IncomingMessage): Promise<URLSearchParams> {
    const chunks: Buffer[] = [];

    for await (const chunk of request) chunks.push(chunk as Buffer);

    return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export async function startMockOidc(options: { clientId?: string; publicUrl?: string } = {}): Promise<MockOidc> {
    const clientId = options.clientId ?? 'reverie-test-client';
    const clientSecret = MOCK_CLIENT_SECRET;
    const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const stranger = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = 'mock-key-1';
    const publicJwk = { ...signing.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
    const codes = new Map<string, { challenge: string; nonce: string; redirectUri: string; person: MockPerson; bends: TokenBends }>();
    let authMethods = ['client_secret_basic', 'client_secret_post'];

    const mock: MockOidc = {
        issuer: '',
        origin: '',
        clientId,
        clientSecret,
        person: { sub: 'sub-1', email: 'person@example.test', email_verified: true },
        next: {},
        authorizeRequests: [],
        tokenRequests: [],
        setAuthMethods: (methods) => {
            authMethods = methods;
        },
        authorize: async (authorizationUrl) => {
            const response = await fetch(authorizationUrl, { redirect: 'manual' });

            return response.headers.get('location') ?? '';
        },
        close: () => new Promise((resolve) => server.close(() => resolve())),
    };

    const json = (response: ServerResponse, status: number, body: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
    };

    const handleAuthorize = (url: URL, response: ServerResponse) => {
        mock.authorizeRequests.push(url.searchParams);

        const redirectUri = url.searchParams.get('redirect_uri') ?? '';
        const code = randomBytes(12).toString('hex');

        codes.set(code, {
            challenge: url.searchParams.get('code_challenge') ?? '',
            nonce: url.searchParams.get('nonce') ?? '',
            redirectUri,
            person: { ...mock.person },
            bends: { ...mock.next },
        });

        const back = new URL(redirectUri);

        back.searchParams.set('code', code);
        back.searchParams.set('state', url.searchParams.get('state') ?? '');
        back.searchParams.set('iss', mock.issuer);
        response.writeHead(302, { location: back.href });
        response.end();
    };

    const handleToken = async (request: IncomingMessage, response: ServerResponse) => {
        const body = await readBody(request);

        mock.tokenRequests.push({ body, authorization: request.headers.authorization });

        const grant = codes.get(body.get('code') ?? '');

        codes.delete(body.get('code') ?? '');

        if (!grant) return json(response, 400, { error: 'invalid_grant', error_description: 'unknown code' });

        // PKCE: the verifier must hash to the challenge the authorization request carried.
        const challenge = createHash('sha256')
            .update(body.get('code_verifier') ?? '')
            .digest('base64url');

        if (challenge !== grant.challenge) return json(response, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });

        const now = Math.floor(Date.now() / 1000);
        const { bends, person } = grant;
        const emailFacts = bends.emailInUserinfoOnly ? {} : { email: person.email, email_verified: person.email_verified };
        const claims = {
            iss: bends.iss ?? mock.issuer,
            aud: bends.aud ?? clientId,
            azp: bends.azp,
            sub: person.sub,
            iat: now,
            exp: now + (bends.expiresIn ?? 300),
            nonce: bends.nonce ?? grant.nonce,
            ...emailFacts,
        };
        const idToken = bends.signWithStrangerKey ? signJwt(claims, stranger.privateKey, kid) : signJwt(claims, signing.privateKey, kid);
        const accessToken = 'access-' + person.sub;

        userinfo.set(accessToken, person);

        return json(response, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: 300, id_token: idToken });
    };

    const userinfo = new Map<string, MockPerson>();

    const server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', mock.issuer);

        if (url.pathname === '/.well-known/openid-configuration') {
            return json(response, 200, {
                issuer: mock.issuer,
                authorization_endpoint: mock.issuer + '/authorize',
                token_endpoint: mock.issuer + '/token',
                jwks_uri: mock.issuer + '/jwks',
                userinfo_endpoint: mock.issuer + '/userinfo',
                response_types_supported: ['code'],
                subject_types_supported: ['public'],
                id_token_signing_alg_values_supported: ['RS256'],
                token_endpoint_auth_methods_supported: authMethods,
                code_challenge_methods_supported: ['S256'],
            });
        }

        if (url.pathname === '/jwks') return json(response, 200, { keys: [publicJwk] });

        if (url.pathname === '/authorize') return handleAuthorize(url, response);

        if (url.pathname === '/token') return void handleToken(request, response);

        if (url.pathname === '/userinfo') {
            const person = userinfo.get((request.headers.authorization ?? '').replace('Bearer ', ''));

            return person ? json(response, 200, person) : json(response, 401, { error: 'invalid_token' });
        }

        return json(response, 404, { error: 'not_found' });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    mock.origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    mock.issuer = options.publicUrl ?? mock.origin;

    return mock;
}

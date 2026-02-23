import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import fastifyOauth2 from '@fastify/oauth2';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { env } from '../../config/env.js';

// JWT payload structure
export interface JwtPayload {
    sub: string; // user id
    email: string;
}

// Authenticated user info attached to request
export interface AuthUser {
    id: string;
    email: string;
}

// Extend Fastify types (interface names in augmentation are flagged by no-unused-vars)
/* eslint-disable no-unused-vars */
declare module 'fastify' {
    interface FastifyInstance {
        authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
        googleOAuth2?: typeof fastifyOauth2;
    }
}

declare module '@fastify/jwt' {
    interface FastifyJWT {
        payload: JwtPayload;
        user: AuthUser;
    }
}

export default fp(async function (fastify) {
    // Register cookie plugin (for refresh tokens)
    await fastify.register(fastifyCookie, {
        secret: env.JWT_SECRET, // for signed cookies
        hook: 'onRequest',
    });

    // Register JWT plugin
    await fastify.register(fastifyJwt, {
        secret: env.JWT_SECRET,
        sign: {
            expiresIn: env.JWT_ACCESS_EXPIRES,
        },
        cookie: {
            cookieName: 'refresh_token',
            signed: true,
        },
    });

    // Register Google OAuth2 if configured
    if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CALLBACK_URL) {
        await fastify.register(fastifyOauth2, {
            name: 'googleOAuth2',
            scope: ['profile', 'email'],
            credentials: {
                client: {
                    id: env.GOOGLE_CLIENT_ID,
                    secret: env.GOOGLE_CLIENT_SECRET,
                },
                auth: fastifyOauth2.GOOGLE_CONFIGURATION,
            },
            startRedirectPath: '/auth/google',
            callbackUri: env.GOOGLE_CALLBACK_URL,
        });
    }

    // Decorate fastify with authenticate function
    fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
        try {
            const decoded = await request.jwtVerify<JwtPayload>();
            request.user = {
                id: decoded.sub,
                email: decoded.email,
            };
        } catch (_err) {
            reply.status(401).send({
                error: 'token_invalid',
                message: 'Invalid or expired token',
            });
        }
    });

    // Decorate fastify with authenticateAdmin - must be used after authenticate in preHandler
    fastify.decorate('authenticateAdmin', async function (request: FastifyRequest, reply: FastifyReply) {
        const { db } = await import('../../db/kysely.js');
        const user = await db
            .selectFrom('users')
            .select('role')
            .where('id', '=', request.user.id)
            .executeTakeFirst();

        if (!user || user.role !== 'admin') {
            reply.status(403).send({
                error: 'forbidden',
                message: 'Admin access required',
            });
        }
    });
});

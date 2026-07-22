import AutoLoad from '@fastify/autoload';
import { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import * as path from 'path';

export interface AppOptions {}

// Wrapped in fastify-plugin so the decorators added by inner plugins (notably
// `jwt` from @fastify/jwt) are exposed on the ROOT instance rather than staying
// in this plugin's encapsulated scope. main.ts hands that root instance to the
// Socket.IO server, which needs `fastify.jwt.verify` to authenticate handshakes;
// without this, `server.jwt` is undefined and every handshake fails 'unauthorized'.
export const app = fp(async function app(fastify: FastifyInstance, opts: AppOptions) {
    // Register plugins first (order matters!)
    // Plugins are loaded alphabetically, so we prefix with numbers for order
    fastify.register(AutoLoad, {
        dir: path.join(__dirname, 'plugins'),
        options: { ...opts },
    });

    // Register routes
    fastify.register(AutoLoad, {
        dir: path.join(__dirname, 'routes'),
        options: { ...opts },
    });
});

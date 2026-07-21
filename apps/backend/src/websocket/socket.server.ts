import type { FastifyInstance } from 'fastify';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import type { JwtPayload } from '../app/plugins/auth';
import { env } from '../config/env';
import { db } from '../db/kysely';

let ioInstance: SocketIOServer | null = null;

export interface SocketServerOptions {
    httpServer: HttpServer;
    /** Used to verify the handshake JWT with the same secret/options as HTTP auth. */
    fastify: FastifyInstance;
}

/** Attached to every socket at the handshake once its JWT is verified. */
interface SocketData {
    userId: string;
}

function userRoom(userId: string): string {
    return `user:${userId}`;
}

// Namespaced by user so a client can't join another user's upload session by
// guessing the (client-generated) session id.
function sessionRoom(userId: string, sessionId: string): string {
    return `session:${userId}:${sessionId}`;
}

function documentRoom(documentId: string): string {
    return `document:${documentId}`;
}

async function userOwnsDocument(userId: string, documentId: string): Promise<boolean> {
    const row = await db.selectFrom('documents').select('id').where('id', '=', documentId).where('user_id', '=', userId).executeTakeFirst();

    return row !== undefined;
}

/**
 * Initialize Socket.IO server
 */
export function initializeSocketServer({ httpServer, fastify }: SocketServerOptions): SocketIOServer {
    if (ioInstance) {
        return ioInstance;
    }

    const corsOrigins = env.WS_CORS_ORIGIN.split(',').map((o) => o.trim());

    ioInstance = new SocketIOServer(httpServer, {
        cors: {
            origin: corsOrigins,
            methods: ['GET', 'POST'],
            credentials: true,
        },
        transports: ['websocket', 'polling'],
    });

    // Authenticate every connection at the handshake. The client must supply a valid
    // access token in `auth.token`; we pin the verified user id to the socket and scope
    // all rooms to it, so a client can never receive another user's job events.
    ioInstance.use((socket, next) => {
        const rawToken = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
        const token = typeof rawToken === 'string' && rawToken.length > 0 ? rawToken : null;

        if (!token) {
            next(new Error('unauthorized'));

            return;
        }

        try {
            const decoded = fastify.jwt.verify<JwtPayload>(token);
            (socket.data as SocketData).userId = decoded.sub;
            next();
        } catch {
            next(new Error('unauthorized'));
        }
    });

    // Connection handler
    ioInstance.on('connection', (socket: Socket) => {
        const { userId } = socket.data as SocketData;

        // Every socket joins its own user room — the delivery boundary for events not
        // tied to a specific document/session subscription (replaces the old global broadcast).
        socket.join(userRoom(userId));
        console.log(`[WebSocket] Client connected: ${socket.id} (user ${userId})`);

        // Handle session subscription
        socket.on('subscribe:session', (data: { session_id?: unknown }) => {
            const sessionId = data?.session_id;

            if (typeof sessionId !== 'string' || !sessionId) return;

            socket.join(sessionRoom(userId, sessionId));
            console.log(`[WebSocket] Client ${socket.id} joined session ${sessionId}`);
        });

        // Handle session unsubscription
        socket.on('unsubscribe:session', (data: { session_id?: unknown }) => {
            const sessionId = data?.session_id;

            if (typeof sessionId !== 'string' || !sessionId) return;

            socket.leave(sessionRoom(userId, sessionId));
            console.log(`[WebSocket] Client ${socket.id} left session ${sessionId}`);
        });

        // Handle document subscription (for individual document updates)
        socket.on('subscribe:document', async (data: { document_id?: unknown }) => {
            const documentId = data?.document_id;

            if (typeof documentId !== 'string' || !documentId) return;

            // Only the owner may join a document room, so document-scoped events can be
            // delivered to that room without leaking across users.
            const owns = await userOwnsDocument(userId, documentId);

            if (!owns) {
                console.warn(`[WebSocket] Client ${socket.id} (user ${userId}) denied document ${documentId}`);

                return;
            }

            socket.join(documentRoom(documentId));
            console.log(`[WebSocket] Client ${socket.id} joined document ${documentId}`);
        });

        socket.on('unsubscribe:document', (data: { document_id?: unknown }) => {
            const documentId = data?.document_id;

            if (typeof documentId !== 'string' || !documentId) return;

            socket.leave(documentRoom(documentId));
            console.log(`[WebSocket] Client ${socket.id} left document ${documentId}`);
        });

        // Handle disconnect
        socket.on('disconnect', (reason) => {
            console.log(`[WebSocket] Client disconnected: ${socket.id}, reason: ${reason}`);
        });

        // Handle errors
        socket.on('error', (error) => {
            console.error(`[WebSocket] Socket error for ${socket.id}:`, error);
        });
    });

    console.log('[WebSocket] Server initialized');

    return ioInstance;
}

/**
 * Get the Socket.IO server instance
 */
export function getSocketServer(): SocketIOServer | null {
    return ioInstance;
}

/**
 * Send event to a user's own room (all of that user's connected clients).
 */
export function sendToUser(userId: string, eventType: string, data: unknown): void {
    if (ioInstance) {
        ioInstance.to(userRoom(userId)).emit(eventType, data);
    }
}

/**
 * Send event to a specific upload session, scoped to its owner.
 */
export function sendToSession(userId: string, sessionId: string, eventType: string, data: unknown): void {
    if (ioInstance) {
        ioInstance.to(sessionRoom(userId, sessionId)).emit(eventType, data);
    }
}

/**
 * Send event to a specific document room (owner-only; joins are authorized).
 */
export function sendToDocument(documentId: string, eventType: string, data: unknown): void {
    if (ioInstance) {
        ioInstance.to(documentRoom(documentId)).emit(eventType, data);
    }
}

/**
 * Close the Socket.IO server
 */
export async function closeSocketServer(): Promise<void> {
    if (ioInstance) {
        await new Promise<void>((resolve) => {
            ioInstance!.close(() => {
                ioInstance = null;
                resolve();
            });
        });
        console.log('[WebSocket] Server closed');
    }
}

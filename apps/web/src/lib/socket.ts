import type { JobEvent } from '@reverie/shared';
import { io, Socket } from 'socket.io-client';

import { API_BASE, getAccessToken, refreshAccessToken } from './api/client';

let socket: Socket | null = null;
const subscribedSessions = new Set<string>();
const subscribedDocuments = new Set<string>();
let refreshingAuth = false;
// Guards against a refresh storm: attempt at most one token refresh per
// disconnected episode. Reset on a successful connect so a later expiry can
// recover again. Without this, a dead refresh token makes socket.io's
// auto-reconnect fire connect_error repeatedly, each retriggering /auth/refresh.
let authRefreshAttempted = false;

/**
 * Get or create the Socket.io client instance
 */
export function getSocket(): Socket {
    if (!socket) {
        const s = io(API_BASE, {
            transports: ['websocket', 'polling'],
            autoConnect: false,
            // Function form is re-evaluated on every (re)connect, so the current
            // access token is always sent on the handshake.
            auth: (cb) => cb({ token: getAccessToken() ?? '' }),
        });

        // The handshake middleware rejects an invalid/expired token with this message
        // and does not auto-retry, so refresh once and reconnect with the new token.
        s.on('connect_error', (err: Error) => {
            if (err.message !== 'unauthorized' || refreshingAuth || authRefreshAttempted) return;

            refreshingAuth = true;
            authRefreshAttempted = true;
            void refreshAccessToken()
                .then((ok) => {
                    if (ok) s.connect();
                })
                .finally(() => {
                    refreshingAuth = false;
                });
        });

        // Server-side room membership is per-connection: after a reconnect
        // (backend restart, network blip) the new connection is in no rooms,
        // so replay every subscription we're tracking or job events silently
        // stop arriving until the subscribing components remount.
        s.on('connect', () => {
            // Connected: allow a fresh refresh attempt if the token expires again later.
            authRefreshAttempted = false;

            for (const sessionId of subscribedSessions) {
                s.emit('subscribe:session', { session_id: sessionId });
            }

            for (const documentId of subscribedDocuments) {
                s.emit('subscribe:document', { document_id: documentId });
            }
        });

        socket = s;
    }

    return socket;
}

/**
 * Connect to the WebSocket server
 */
export function connectSocket(): Socket {
    const s = getSocket();

    if (!s.connected) {
        s.connect();
    }

    return s;
}

/**
 * Ensure socket is connected before proceeding. Resolves when connected.
 * Use before subscribe + upload to avoid race where job events are emitted
 * before the client has joined the session room.
 */
export function ensureSocketConnected(): Promise<void> {
    const s = getSocket();

    if (s.connected) {
        return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            s.off('connect', onConnect);
            s.off('connect_error', onError);
            clearTimeout(timer);
        };

        const onConnect = () => {
            cleanup();
            resolve();
        };

        const onError = (err: Error) => {
            // 'unauthorized' is recoverable: the connect_error handler above refreshes
            // the token and reconnects, which fires 'connect'. Rejecting on this first
            // error would abort the upload before that recovery lands (the caller shows
            // an "unauthorized" toast). Keep waiting — the timeout below is the backstop
            // if the refresh itself fails. Other errors (transport, server down) are fatal.
            if (err.message === 'unauthorized') return;

            cleanup();
            reject(err);
        };

        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('WebSocket connection timed out'));
        }, 10_000);

        s.on('connect', onConnect);
        s.on('connect_error', onError);
        s.connect();
    });
}

/**
 * Disconnect from the WebSocket server
 */
export function disconnectSocket(): void {
    if (socket?.connected) {
        socket.disconnect();
    }

    subscribedSessions.clear();
    subscribedDocuments.clear();
}

/**
 * Subscribe to job events for a specific upload session
 */
export function subscribeToSession(sessionId: string): void {
    if (subscribedSessions.has(sessionId)) {
        console.warn(`[Socket] Already subscribed to session: ${sessionId}`);

        return;
    }

    subscribedSessions.add(sessionId);
    getSocket().emit('subscribe:session', { session_id: sessionId });
}

/**
 * Unsubscribe from a session
 */
export function unsubscribeFromSession(sessionId: string): void {
    subscribedSessions.delete(sessionId);
    getSocket().emit('unsubscribe:session', { session_id: sessionId });
}

/**
 * Subscribe to updates for a specific document
 */
export function subscribeToDocument(documentId: string): void {
    if (subscribedDocuments.has(documentId)) {
        console.warn(`[Socket] Already subscribed to document: ${documentId}`);

        return;
    }

    subscribedDocuments.add(documentId);
    getSocket().emit('subscribe:document', { document_id: documentId });
}

/**
 * Unsubscribe from a document
 */
export function unsubscribeFromDocument(documentId: string): void {
    subscribedDocuments.delete(documentId);
    getSocket().emit('unsubscribe:document', { document_id: documentId });
}

/**
 * Type for job event callback
 */
export type JobEventCallback = (event: JobEvent) => void;

/**
 * Register callbacks for all job events
 * Returns a cleanup function to remove the listeners
 */
export function onJobEvents(callback: JobEventCallback): () => void {
    const s = getSocket();

    const handleEvent = (event: JobEvent) => {
        callback(event);
    };

    s.on('job:started', handleEvent);
    s.on('job:progress', handleEvent);
    s.on('job:complete', handleEvent);
    s.on('job:failed', handleEvent);

    return () => {
        s.off('job:started', handleEvent);
        s.off('job:progress', handleEvent);
        s.off('job:complete', handleEvent);
        s.off('job:failed', handleEvent);
    };
}

/**
 * Check if socket is connected
 */
export function isSocketConnected(): boolean {
    return socket?.connected ?? false;
}

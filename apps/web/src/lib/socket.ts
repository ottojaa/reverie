import type { JobEvent } from '@reverie/shared';
import { io, Socket } from 'socket.io-client';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

let socket: Socket | null = null;

/**
 * Get or create the Socket.io client instance
 */
export function getSocket(): Socket {
    if (!socket) {
        socket = io(API_BASE, {
            transports: ['websocket', 'polling'],
            autoConnect: false,
        });
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
 * Disconnect from the WebSocket server
 */
export function disconnectSocket(): void {
    if (socket?.connected) {
        socket.disconnect();
    }
}

/**
 * Subscribe to job events for a specific upload session
 */
export function subscribeToSession(sessionId: string): void {
    getSocket().emit('subscribe:session', { session_id: sessionId });
}

/**
 * Unsubscribe from a session
 */
export function unsubscribeFromSession(sessionId: string): void {
    getSocket().emit('unsubscribe:session', { session_id: sessionId });
}

/**
 * Subscribe to updates for a specific document
 */
export function subscribeToDocument(documentId: string): void {
    getSocket().emit('subscribe:document', { document_id: documentId });
}

/**
 * Unsubscribe from a document
 */
export function unsubscribeFromDocument(documentId: string): void {
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

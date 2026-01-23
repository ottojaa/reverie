import { Server as SocketIOServer, Socket } from 'socket.io'
import { Server as HttpServer } from 'http'
import { env } from '../config/env'

let ioInstance: SocketIOServer | null = null

export interface SocketServerOptions {
  httpServer: HttpServer
}

/**
 * Initialize Socket.IO server
 */
export function initializeSocketServer({ httpServer }: SocketServerOptions): SocketIOServer {
  if (ioInstance) {
    return ioInstance
  }

  const corsOrigins = env.WS_CORS_ORIGIN.split(',').map((o) => o.trim())

  ioInstance = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  })

  // Connection handler
  ioInstance.on('connection', (socket: Socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`)

    // Handle session subscription
    socket.on('subscribe:session', (data: { session_id: string }) => {
      if (data.session_id) {
        const room = `session:${data.session_id}`
        socket.join(room)
        console.log(`[WebSocket] Client ${socket.id} joined room ${room}`)
      }
    })

    // Handle session unsubscription
    socket.on('unsubscribe:session', (data: { session_id: string }) => {
      if (data.session_id) {
        const room = `session:${data.session_id}`
        socket.leave(room)
        console.log(`[WebSocket] Client ${socket.id} left room ${room}`)
      }
    })

    // Handle document subscription (for individual document updates)
    socket.on('subscribe:document', (data: { document_id: string }) => {
      if (data.document_id) {
        const room = `document:${data.document_id}`
        socket.join(room)
        console.log(`[WebSocket] Client ${socket.id} joined room ${room}`)
      }
    })

    socket.on('unsubscribe:document', (data: { document_id: string }) => {
      if (data.document_id) {
        const room = `document:${data.document_id}`
        socket.leave(room)
        console.log(`[WebSocket] Client ${socket.id} left room ${room}`)
      }
    })

    // Handle disconnect
    socket.on('disconnect', (reason) => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}, reason: ${reason}`)
    })

    // Handle errors
    socket.on('error', (error) => {
      console.error(`[WebSocket] Socket error for ${socket.id}:`, error)
    })
  })

  console.log('[WebSocket] Server initialized')

  return ioInstance
}

/**
 * Get the Socket.IO server instance
 */
export function getSocketServer(): SocketIOServer | null {
  return ioInstance
}

/**
 * Broadcast event to all connected clients
 */
export function broadcastEvent(eventType: string, data: unknown): void {
  if (ioInstance) {
    ioInstance.emit(eventType, data)
  }
}

/**
 * Send event to a specific session room
 */
export function sendToSession(sessionId: string, eventType: string, data: unknown): void {
  if (ioInstance) {
    ioInstance.to(`session:${sessionId}`).emit(eventType, data)
  }
}

/**
 * Send event to a specific document room
 */
export function sendToDocument(documentId: string, eventType: string, data: unknown): void {
  if (ioInstance) {
    ioInstance.to(`document:${documentId}`).emit(eventType, data)
  }
}

/**
 * Close the Socket.IO server
 */
export async function closeSocketServer(): Promise<void> {
  if (ioInstance) {
    await new Promise<void>((resolve) => {
      ioInstance!.close(() => {
        ioInstance = null
        resolve()
      })
    })
    console.log('[WebSocket] Server closed')
  }
}



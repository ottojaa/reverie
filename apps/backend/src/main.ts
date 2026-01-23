import 'dotenv/config'
import Fastify from 'fastify'
import { createServer } from 'http'
import { app } from './app/app'
import { checkDbConnection, closeDb } from './db/kysely'
import { env } from './config/env'
import { initializeSocketServer, closeSocketServer } from './websocket'
import { startRedisSubscriber, stopRedisSubscriber } from './websocket'
import { closeAllQueues } from './queues'
import { closeRedisConnections } from './queues/redis'

const host = env.HOST
const port = env.PORT

async function main() {
  // Create HTTP server first (needed for Socket.IO)
  const httpServer = createServer()

  // Instantiate Fastify with some config
  const server = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
    serverFactory: (handler) => {
      httpServer.on('request', handler)
      return httpServer
    },
  })

  // Register your application as a normal plugin
  server.register(app)

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']
  signals.forEach((signal) => {
    process.on(signal, async () => {
      server.log.info(`Received ${signal}, shutting down gracefully...`)

      // Close WebSocket server and Redis subscriber first
      await stopRedisSubscriber()
      await closeSocketServer()

      // Close Fastify
      await server.close()

      // Close queues and Redis
      await closeAllQueues()
      await closeRedisConnections()

      // Close database
      await closeDb()

      process.exit(0)
    })
  })

  try {
    // Check database connection
    const dbConnected = await checkDbConnection()
    if (!dbConnected) {
      server.log.warn('Database connection failed - some features may be unavailable')
    } else {
      server.log.info('Database connection established')
    }

    // Initialize WebSocket server if enabled
    if (env.WS_ENABLED) {
      initializeSocketServer({ httpServer })
      await startRedisSubscriber()
      server.log.info('WebSocket server initialized')
    }

    // Start listening
    await server.listen({ port, host })
    server.log.info(`Server ready at http://${host}:${port}`)
    server.log.info(`API docs available at http://${host}:${port}/docs`)

    if (env.WS_ENABLED) {
      server.log.info(`WebSocket server ready at ws://${host}:${port}`)
    }
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

main()

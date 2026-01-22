import 'dotenv/config'
import Fastify from 'fastify'
import { app } from './app/app'
import { checkDbConnection, closeDb } from './db/kysely'

const host = process.env.HOST ?? 'localhost'
const port = process.env.PORT ? Number(process.env.PORT) : 3000

async function main() {
  // Instantiate Fastify with some config
  const server = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  })

  // Register your application as a normal plugin
  server.register(app)

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']
  signals.forEach((signal) => {
    process.on(signal, async () => {
      server.log.info(`Received ${signal}, shutting down gracefully...`)
      await server.close()
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

    // Start listening
    await server.listen({ port, host })
    server.log.info(`Server ready at http://${host}:${port}`)
    server.log.info(`API docs available at http://${host}:${port}/docs`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }
}

main()

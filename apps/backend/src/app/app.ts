import * as path from 'path'
import { FastifyInstance } from 'fastify'
import AutoLoad from '@fastify/autoload'

/* eslint-disable-next-line */
export interface AppOptions {}

export async function app(fastify: FastifyInstance, opts: AppOptions) {
  // Register plugins first (order matters!)
  // Plugins are loaded alphabetically, so we prefix with numbers for order
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'plugins'),
    options: { ...opts },
  })

  // Register routes
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, 'routes'),
    options: { ...opts },
  })
}

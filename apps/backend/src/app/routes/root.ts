import { FastifyInstance } from 'fastify';

export default async function (fastify: FastifyInstance) {
  fastify.get('/', async function () {
    return { message: 'Reverie API', version: '0.0.1' };
  });
}

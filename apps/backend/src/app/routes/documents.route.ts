import {
  DocumentListQuerySchema,
  DocumentSchema,
  PaginatedResponseSchema,
  UuidSchema,
  type Document,
  type DocumentListQuery,
} from '@reverie/shared'
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../../db/kysely'
import { type Document as DbDocument } from '../../db/schema'
import { getUploadService } from '../../services/upload.service'
import { getStorageService } from '../../services/storage.service'

const uploadService = getUploadService()
const storageService = getStorageService()

export default async function (fastify: FastifyInstance) {
  // List documents (requires authentication)
  fastify.get<{
    Querystring: DocumentListQuery
  }>(
    '/documents',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description: 'List documents with optional filters',
        querystring: DocumentListQuerySchema,
        response: {
          200: PaginatedResponseSchema(DocumentSchema),
        },
      },
    },
    async function (request) {
      const userId = request.user.id
      const { limit, offset, folder_id, category, date_from, date_to } = request.query

      let query = db
        .selectFrom('documents')
        .selectAll()
        .where('user_id', '=', userId)

      // Apply filters
      if (folder_id) {
        query = query.where('folder_id', '=', folder_id)
      }
      if (category) {
        query = query.where('document_category', '=', category)
      }
      if (date_from) {
        query = query.where('extracted_date', '>=', new Date(date_from))
      }
      if (date_to) {
        query = query.where('extracted_date', '<=', new Date(date_to))
      }

      // Get total count (must apply same filters)
      let countQuery = db
        .selectFrom('documents')
        .select(db.fn.countAll().as('count'))
        .where('user_id', '=', userId)

      if (folder_id) {
        countQuery = countQuery.where('folder_id', '=', folder_id)
      }
      if (category) {
        countQuery = countQuery.where('document_category', '=', category)
      }
      if (date_from) {
        countQuery = countQuery.where('extracted_date', '>=', new Date(date_from))
      }
      if (date_to) {
        countQuery = countQuery.where('extracted_date', '<=', new Date(date_to))
      }

      const [documents, countResult] = await Promise.all([
        query.orderBy('created_at', 'desc').limit(limit).offset(offset).execute(),
        countQuery.executeTakeFirst(),
      ])

      return {
        items: documents.map(serializeDocument),
        total: Number(countResult?.count ?? 0),
        limit,
        offset,
      }
    }
  )

  // Get document by ID (requires authentication)
  fastify.get<{
    Params: { id: string }
    Reply: Document
  }>(
    '/documents/:id',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description: 'Get document by ID',
        params: z.object({ id: UuidSchema }),
        response: {
          200: DocumentSchema,
        },
      },
    },
    async function (request, reply) {
      const userId = request.user.id
      const document = await uploadService.getDocument(request.params.id, userId)
      if (!document) {
        return reply.notFound('Document not found')
      }
      return serializeDocument(document)
    }
  )

  // Delete document (requires authentication)
  fastify.delete<{
    Params: { id: string }
  }>(
    '/documents/:id',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description: 'Delete a document',
        params: z.object({ id: UuidSchema }),
        response: {
          204: z.null(),
        },
      },
    },
    async function (request, reply) {
      const userId = request.user.id
      const document = await uploadService.getDocument(request.params.id, userId)
      if (!document) {
        return reply.notFound('Document not found')
      }

      // Delete file from storage (with storage usage update)
      try {
        await storageService.deleteFile(document.file_path, userId)

        // Delete thumbnails if they exist
        if (document.thumbnail_paths) {
          for (const path of Object.values(document.thumbnail_paths)) {
            await storageService.deleteFile(path, userId)
          }
        }
      } catch (err) {
        // Log but don't fail if storage delete fails
        console.error('Failed to delete file from storage:', err)
      }

      // Delete from database (cascade will handle related records)
      await db
        .deleteFrom('documents')
        .where('id', '=', request.params.id)
        .where('user_id', '=', userId)
        .execute()

      reply.status(204).send()
    }
  )

  // Get document status (requires authentication)
  fastify.get<{
    Params: { id: string }
  }>(
    '/documents/:id/status',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description: 'Get document processing status',
        params: z.object({ id: UuidSchema }),
        response: {
          200: z.object({
            document_id: z.string().uuid(),
            ocr_status: z.enum(['pending', 'processing', 'complete', 'failed']),
            thumbnail_status: z.enum(['pending', 'processing', 'complete', 'failed']),
            jobs: z.array(z.object({
              type: z.string(),
              status: z.enum(['pending', 'processing', 'complete', 'failed']),
              completed_at: z.string().nullable(),
            })),
          }),
        },
      },
    },
    async function (request, reply) {
      const userId = request.user.id
      const document = await uploadService.getDocument(request.params.id, userId)
      if (!document) {
        return reply.notFound('Document not found')
      }

      // Get related jobs
      const jobs = await db
        .selectFrom('processing_jobs')
        .select(['id', 'job_type', 'status', 'completed_at'])
        .where('target_id', '=', request.params.id)
        .where('target_type', '=', 'document')
        .execute()

      return {
        document_id: document.id,
        ocr_status: document.ocr_status,
        thumbnail_status: document.thumbnail_status,
        jobs: jobs.map((job) => ({
          type: job.job_type,
          status: job.status,
          completed_at: job.completed_at?.toISOString(),
        })),
      }
    }
  )

  // Get all jobs for a document (requires authentication)
  fastify.get<{
    Params: { id: string }
  }>(
    '/documents/:id/jobs',
    {
      preHandler: [fastify.authenticate],
      schema: {
        description: 'Get all processing jobs for a document',
        params: z.object({ id: UuidSchema }),
        response: {
          200: z.array(z.object({
            id: z.string().uuid(),
            job_type: z.string(),
            target_type: z.string(),
            target_id: z.string().uuid(),
            status: z.enum(['pending', 'processing', 'complete', 'failed']),
            priority: z.number(),
            attempts: z.number(),
            error_message: z.string().nullable(),
            result: z.unknown().nullable(),
            created_at: z.string(),
            started_at: z.string().nullable(),
            completed_at: z.string().nullable(),
          })),
        },
      },
    },
    async function (request, reply) {
      const userId = request.user.id
      const document = await uploadService.getDocument(request.params.id, userId)
      if (!document) {
        return reply.notFound('Document not found')
      }

      const jobs = await db
        .selectFrom('processing_jobs')
        .selectAll()
        .where('target_id', '=', request.params.id)
        .where('target_type', '=', 'document')
        .orderBy('created_at', 'desc')
        .execute()

      return jobs.map((job) => ({
        id: job.id,
        job_type: job.job_type,
        target_type: job.target_type,
        target_id: job.target_id,
        status: job.status,
        priority: job.priority,
        attempts: job.attempts,
        error_message: job.error_message,
        result: job.result,
        created_at: job.created_at.toISOString(),
        started_at: job.started_at?.toISOString() ?? null,
        completed_at: job.completed_at?.toISOString() ?? null,
      }))
    }
  )
}

function serializeDocument(doc: DbDocument): Document {
  return {
    id: doc.id,
    folder_id: doc.folder_id,
    file_path: doc.file_path,
    file_hash: doc.file_hash,
    original_filename: doc.original_filename,
    mime_type: doc.mime_type,
    size_bytes: Number(doc.size_bytes),
    width: doc.width,
    height: doc.height,
    thumbnail_blurhash: doc.thumbnail_blurhash,
    thumbnail_paths: doc.thumbnail_paths,
    document_category: doc.document_category as Document['document_category'],
    extracted_date: doc.extracted_date?.toISOString().split('T')[0] ?? null,
    ocr_status: doc.ocr_status as Document['ocr_status'],
    thumbnail_status: doc.thumbnail_status as Document['thumbnail_status'],
    llm_summary: doc.llm_summary,
    llm_metadata: doc.llm_metadata as Document['llm_metadata'],
    llm_processed_at: doc.llm_processed_at?.toISOString() ?? null,
    llm_token_count: doc.llm_token_count,
    created_at: doc.created_at.toISOString(),
    updated_at: doc.updated_at.toISOString(),
  }
}

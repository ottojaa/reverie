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

const uploadService = getUploadService()

export default async function (fastify: FastifyInstance) {
  // List documents
  fastify.get<{
    Querystring: DocumentListQuery
  }>(
    '/documents',
    {
      schema: {
        description: 'List documents with optional filters',
        querystring: DocumentListQuerySchema,
        response: {
          200: PaginatedResponseSchema(DocumentSchema),
        },
      },
    },
    async function (request) {
      const { limit, offset, folder_id, category, date_from, date_to } = request.query

      let query = db.selectFrom('documents').selectAll()

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

      // Get total count
      const countQuery = db.selectFrom('documents').select(db.fn.countAll().as('count'))
      if (folder_id) {
        countQuery.where('folder_id', '=', folder_id)
      }
      if (category) {
        countQuery.where('document_category', '=', category)
      }
      if (date_from) {
        countQuery.where('extracted_date', '>=', new Date(date_from))
      }
      if (date_to) {
        countQuery.where('extracted_date', '<=', new Date(date_to))
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

  // Get document by ID
  fastify.get<{
    Params: { id: string }
    Reply: Document
  }>(
    '/documents/:id',
    {
      schema: {
        description: 'Get document by ID',
        params: z.object({ id: UuidSchema }),
        response: {
          200: DocumentSchema,
        },
      },
    },
    async function (request, reply) {
      const document = await uploadService.getDocument(request.params.id)
      if (!document) {
        return reply.notFound('Document not found')
      }
      return serializeDocument(document)
    }
  )

  // Delete document
  fastify.delete<{
    Params: { id: string }
  }>(
    '/documents/:id',
    {
      schema: {
        description: 'Delete a document',
        params: z.object({ id: UuidSchema }),
        response: {
          204: z.null(),
        },
      },
    },
    async function (request, reply) {
      const document = await uploadService.getDocument(request.params.id)
      if (!document) {
        return reply.notFound('Document not found')
      }

      // Delete from database (cascade will handle related records)
      await db.deleteFrom('documents').where('id', '=', request.params.id).execute()

      // TODO: Delete file from storage

      reply.status(204).send()
    }
  )

  // Get document status (for polling)
  fastify.get<{
    Params: { id: string }
  }>(
    '/documents/:id/status',
    {
      schema: {
        description: 'Get document processing status',
        params: z.object({ id: UuidSchema }),
      },
    },
    async function (request, reply) {
      const document = await uploadService.getDocument(request.params.id)
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



import {
    CreateFolderRequestSchema,
    FolderSchema,
    UpdateFolderRequestSchema,
    UuidSchema,
    type CreateFolderRequest,
    type Folder,
    type UpdateFolderRequest,
} from '@reverie/shared'
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getFolderService } from '../../services/folder.service'

const folderService = getFolderService()

export default async function (fastify: FastifyInstance) {
  // List root folders
  fastify.get<{ Reply: Folder[] }>(
    '/folders',
    {
      schema: {
        description: 'List root-level folders',
        response: {
          200: z.array(FolderSchema),
        },
      },
    },
    async function () {
      const folders = await folderService.listChildren(null)
      return folders.map(serializeFolder)
    }
  )

  // Get folder by ID
  fastify.get<{
    Params: { id: string }
    Reply: Folder
  }>(
    '/folders/:id',
    {
      schema: {
        description: 'Get folder by ID',
        params: z.object({ id: UuidSchema }),
        response: {
          200: FolderSchema,
        },
      },
    },
    async function (request, reply) {
      const folder = await folderService.getFolder(request.params.id)
      if (!folder) {
        return reply.notFound('Folder not found')
      }
      return serializeFolder(folder)
    }
  )

  // List folder children
  fastify.get<{
    Params: { id: string }
    Reply: Folder[]
  }>(
    '/folders/:id/children',
    {
      schema: {
        description: 'List child folders',
        params: z.object({ id: UuidSchema }),
        response: {
          200: z.array(FolderSchema),
        },
      },
    },
    async function (request) {
      const children = await folderService.listChildren(request.params.id)
      return children.map(serializeFolder)
    }
  )

  // Create folder
  fastify.post<{
    Body: CreateFolderRequest
    Reply: Folder
  }>(
    '/folders',
    {
      schema: {
        description: 'Create a new folder',
        body: CreateFolderRequestSchema,
        response: {
          201: FolderSchema,
        },
      },
    },
    async function (request, reply) {
      const { name, parent_id, description } = request.body
      const folder = await folderService.createFolder(name, parent_id, description)
      reply.status(201)
      return serializeFolder(folder)
    }
  )

  // Update folder
  fastify.patch<{
    Params: { id: string }
    Body: UpdateFolderRequest
    Reply: Folder
  }>(
    '/folders/:id',
    {
      schema: {
        description: 'Update a folder',
        params: z.object({ id: UuidSchema }),
        body: UpdateFolderRequestSchema,
        response: {
          200: FolderSchema,
        },
      },
    },
    async function (request) {
      const folder = await folderService.updateFolder(request.params.id, request.body)
      return serializeFolder(folder)
    }
  )

  // Delete folder
  fastify.delete<{
    Params: { id: string }
  }>(
    '/folders/:id',
    {
      schema: {
        description: 'Delete a folder',
        params: z.object({ id: UuidSchema }),
        response: {
          204: z.null(),
        },
      },
    },
    async function (request, reply) {
      await folderService.deleteFolder(request.params.id)
      reply.status(204).send()
    }
  )
}

function serializeFolder(folder: import('../../db/schema').Folder): Folder {
  return {
    id: folder.id,
    parent_id: folder.parent_id,
    name: folder.name,
    path: folder.path,
    description: folder.description,
    created_at: folder.created_at.toISOString(),
    updated_at: folder.updated_at.toISOString(),
  }
}




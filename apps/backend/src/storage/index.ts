import { env } from '../config/env'
import { LocalStorageProvider } from './local-storage'
import { S3StorageProvider } from './s3-storage'
import type { IStorageProvider } from './storage.interface'

export * from './storage.interface'
export * from './local-storage'
export * from './s3-storage'

let storageInstance: IStorageProvider | null = null

export function getStorage(): IStorageProvider {
  if (!storageInstance) {
    storageInstance = createStorage()
  }
  return storageInstance
}

function createStorage(): IStorageProvider {
  if (env.STORAGE_PROVIDER === 's3') {
    if (!env.STORAGE_S3_BUCKET || !env.STORAGE_S3_ACCESS_KEY || !env.STORAGE_S3_SECRET_KEY) {
      throw new Error('S3 storage requires STORAGE_S3_BUCKET, STORAGE_S3_ACCESS_KEY, and STORAGE_S3_SECRET_KEY')
    }

    return new S3StorageProvider({
      bucket: env.STORAGE_S3_BUCKET,
      endpoint: env.STORAGE_S3_ENDPOINT,
      region: env.STORAGE_S3_REGION,
      accessKeyId: env.STORAGE_S3_ACCESS_KEY,
      secretAccessKey: env.STORAGE_S3_SECRET_KEY,
    })
  }

  return new LocalStorageProvider(env.STORAGE_LOCAL_ROOT)
}




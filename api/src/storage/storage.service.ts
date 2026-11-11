import type { Readable } from 'node:stream';

export interface ReadStreamOptions {
  start?: number;
  end?: number;
}

export interface StorageFileMetadata {
  size: number;
  lastModified?: Date;
  contentType?: string;
}

/**
 * StorageService (§5.2, #101)
 *
 * Abstract file storage interface hiding concrete persistence (local filesystem,
 * MinIO / S3 object storage). Business services (e.g. document ingestion, chunking,
 * version streaming) deal only with relative storage keys, never absolute paths
 * or raw storage handles.
 */
export abstract class StorageService {
  /**
   * Persists a file binary under the given relative storage key.
   *
   * @param key Relative key (e.g. `spaces/{spaceId}/docs/{documentId}/v{version}.pdf`)
   * @param data Binary payload to write (Buffer, Uint8Array, string, or Readable stream)
   */
  abstract save(key: string, data: Buffer | Uint8Array | string | Readable): Promise<void>;

  /**
   * Opens and returns a readable stream for the file at the given relative storage key.
   *
   * @param key Relative storage key
   * @param options Optional byte range ({ start, end }) for HTTP 206 range requests
   */
  abstract read(key: string, options?: ReadStreamOptions): Promise<Readable>;

  /**
   * Checks whether a file exists under the given relative storage key.
   *
   * @param key Relative storage key
   */
  abstract exists(key: string): Promise<boolean>;

  /**
   * Deletes the file under the given relative storage key.
   * Idempotent: completes normally if the file does not exist.
   *
   * @param key Relative storage key
   */
  abstract delete(key: string): Promise<void>;

  /**
   * Retrieves metadata (size, lastModified) for the stored file.
   *
   * @param key Relative storage key
   */
  abstract getMetadata(key: string): Promise<StorageFileMetadata>;
}


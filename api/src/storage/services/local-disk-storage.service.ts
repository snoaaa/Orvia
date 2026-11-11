import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ReadStreamOptions, StorageFileMetadata, StorageService } from '../storage.service.js';
import { sanitizeStorageKey } from '../utils/storage-key.util.js';

/**
 * LocalDiskStorageService (§5.2, #101)
 *
 * Local filesystem implementation of StorageService.
 * Reads and writes relative keys beneath STORAGE_ROOT (default `./storage`).
 * Guarantees directory creation, prevents path traversal, and returns Node streams.
 */
@Injectable()
export class LocalDiskStorageService implements StorageService {
  private readonly logger = new Logger(LocalDiskStorageService.name);
  private readonly rootPath: string;

  constructor(rootFolder: string = './storage') {
    this.rootPath = path.resolve(process.cwd(), rootFolder);
  }

  /**
   * Returns the absolute path of the storage root directory.
   */
  getRootPath(): string {
    return this.rootPath;
  }

  /**
   * Resolves an absolute path for a relative key, strictly verifying that
   * the resolved path cannot escape the designated root.
   */
  resolvePath(key: string): string {
    const cleanKey = sanitizeStorageKey(key);
    const resolved = path.resolve(this.rootPath, cleanKey);

    // Guard against path traversal escaping rootPath
    const rootWithSep = this.rootPath.endsWith(path.sep) ? this.rootPath : this.rootPath + path.sep;
    if (!resolved.startsWith(rootWithSep) && resolved !== this.rootPath) {
      throw new BadRequestException(`Access denied: key "${key}" resolves outside storage root`);
    }

    return resolved;
  }

  async save(key: string, data: Buffer | Uint8Array | string | Readable): Promise<void> {
    const filePath = this.resolvePath(key);
    const dir = path.dirname(filePath);

    // Recursively create parent folder hierarchy
    await fsPromises.mkdir(dir, { recursive: true });

    // Atomic writing: write to an isolated temp file in the same directory, then atomic rename.
    // Guarantees zero partial/corrupted files remain on disk if an upload stream drops or fails.
    const tempFile = path.join(
      dir,
      `.${path.basename(filePath)}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
    );

    try {
      if (data instanceof Readable) {
        const writeStream = fs.createWriteStream(tempFile);
        await pipeline(data, writeStream);
      } else {
        await fsPromises.writeFile(tempFile, data);
      }

      await fsPromises.rename(tempFile, filePath);
    } catch (err) {
      try {
        await fsPromises.unlink(tempFile);
      } catch {
        // Ignore temp cleanup error
      }
      throw err;
    }
  }

  async read(key: string, options?: ReadStreamOptions): Promise<Readable> {
    const filePath = this.resolvePath(key);

    try {
      await fsPromises.access(filePath, fs.constants.R_OK);
    } catch {
      throw new NotFoundException(`File not found in storage: ${key}`);
    }

    const streamOptions: { start?: number; end?: number } = {};
    if (options?.start !== undefined) streamOptions.start = options.start;
    if (options?.end !== undefined) streamOptions.end = options.end;

    return fs.createReadStream(filePath, streamOptions);
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    try {
      await fsPromises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolvePath(key);
    try {
      await fsPromises.unlink(filePath);
    } catch (err: unknown) {
      const nodeError = err as NodeJS.ErrnoException;
      // Idempotent: ignore if file was already removed
      if (nodeError.code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async getMetadata(key: string): Promise<StorageFileMetadata> {
    const filePath = this.resolvePath(key);
    try {
      const stats = await fsPromises.stat(filePath);
      return {
        size: stats.size,
        lastModified: stats.mtime,
      };
    } catch (err: unknown) {
      const nodeError = err as NodeJS.ErrnoException;
      if (nodeError.code === 'ENOENT') {
        throw new NotFoundException(`File not found in storage: ${key}`);
      }
      throw err;
    }
  }
}

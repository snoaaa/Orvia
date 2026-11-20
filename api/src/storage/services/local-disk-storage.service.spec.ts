import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDiskStorageService } from './local-disk-storage.service.js';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

describe('LocalDiskStorageService (#101)', () => {
  let tempStorageRoot: string;
  let service: LocalDiskStorageService;

  beforeEach(async () => {
    tempStorageRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'wamdp-storage-test-'));
    service = new LocalDiskStorageService(tempStorageRoot);
  });

  afterEach(async () => {
    try {
      await fsPromises.rm(tempStorageRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error in test temp folder
    }
  });

  it('initializes with the provided root folder', () => {
    expect(service.getRootPath()).toBe(path.resolve(tempStorageRoot));
  });

  it('saves a buffer and reads it back as a stream (Acceptance Criteria 1)', async () => {
    const key = 'spaces/space-1/docs/doc-1/v1.pdf';
    const content = Buffer.from('PDF file binary content simulation %PDF-1.4');

    await service.save(key, content);

    const exists = await service.exists(key);
    expect(exists).toBe(true);

    const stream = await service.read(key);
    const readBuffer = await streamToBuffer(stream);
    expect(readBuffer.toString()).toBe(content.toString());
  });

  it('saves data from a Readable stream and verifies file content', async () => {
    const key = 'spaces/space-1/docs/doc-2/v1.txt';
    const stream = Readable.from(['Chunk 1, ', 'Chunk 2, ', 'Done.']);

    await service.save(key, stream);

    const readStream = await service.read(key);
    const readBuffer = await streamToBuffer(readStream);
    expect(readBuffer.toString()).toBe('Chunk 1, Chunk 2, Done.');
  });

  it('guarantees atomic writes: cleans up and leaves no partial file if stream errors', async () => {
    const key = 'spaces/space-1/docs/failed-doc/v1.bin';
    const errorStream = new Readable({
      read() {
        this.push(Buffer.from('Partial data'));
        this.destroy(new Error('Simulated network transmission error'));
      },
    });

    await expect(service.save(key, errorStream)).rejects.toThrow('Simulated network transmission error');
    expect(await service.exists(key)).toBe(false);
  });

  it('automatically creates deep directory hierarchies when saving', async () => {
    const key = 'nested/a/b/c/d/file.dat';
    await service.save(key, Buffer.from('deep'));

    expect(await service.exists(key)).toBe(true);
  });

  it('supports byte range streaming for HTTP range requests (Spec §4.3, §7)', async () => {
    const key = 'spaces/space-1/docs/range-doc/v1.bin';
    const data = Buffer.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    await service.save(key, data);

    const rangeStream = await service.read(key, { start: 0, end: 9 });
    const buffer = await streamToBuffer(rangeStream);
    expect(buffer.toString()).toBe('0123456789');

    const middleStream = await service.read(key, { start: 10, end: 14 });
    const middleBuffer = await streamToBuffer(middleStream);
    expect(middleBuffer.toString()).toBe('ABCDE');
  });

  it('returns accurate file metadata (size, lastModified)', async () => {
    const key = 'spaces/space-1/docs/doc-meta/v1.pdf';
    const content = Buffer.from('Document Metadata Test Content');
    await service.save(key, content);

    const metadata = await service.getMetadata(key);
    expect(metadata.size).toBe(content.length);
    expect(metadata.lastModified).toBeInstanceOf(Date);
  });

  it('throws NotFoundException when reading or fetching metadata for nonexistent file', async () => {
    const nonexistentKey = 'spaces/space-1/docs/missing/v1.pdf';

    await expect(service.read(nonexistentKey)).rejects.toThrow(NotFoundException);
    await expect(service.getMetadata(nonexistentKey)).rejects.toThrow(NotFoundException);
  });

  it('deletes a file and ensures existence flips to false (idempotent)', async () => {
    const key = 'spaces/space-1/docs/to-delete/v1.pdf';
    await service.save(key, Buffer.from('To be deleted'));
    expect(await service.exists(key)).toBe(true);

    await service.delete(key);
    expect(await service.exists(key)).toBe(false);

    // Deleting again should not throw (idempotent)
    await expect(service.delete(key)).resolves.toBeUndefined();
  });

  it('prevents path traversal escaping storage root with BadRequestException', async () => {
    await expect(service.save('../escape.txt', Buffer.from('evil'))).rejects.toThrow(BadRequestException);
    await expect(service.read('../escape.txt')).rejects.toThrow(BadRequestException);
    await expect(service.exists('../escape.txt')).rejects.toThrow(BadRequestException);
    await expect(service.delete('../escape.txt')).rejects.toThrow(BadRequestException);
    await expect(service.getMetadata('../escape.txt')).rejects.toThrow(BadRequestException);
  });

  it('moves storage location seamlessly when STORAGE_ROOT changes (Acceptance Criteria 3)', async () => {
    const secondTempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'wamdp-storage-second-'));
    try {
      const secondService = new LocalDiskStorageService(secondTempRoot);
      const key = 'spaces/test/docs/doc-1/v1.pdf';

      await secondService.save(key, Buffer.from('Second Root Content'));

      // Exists in second root
      expect(await secondService.exists(key)).toBe(true);
      // Does not exist in first root
      expect(await service.exists(key)).toBe(false);
    } finally {
      await fsPromises.rm(secondTempRoot, { recursive: true, force: true });
    }
  });
});


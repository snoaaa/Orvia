import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageConversionService } from './image-conversion.service.js';

// Mock heic-convert for deterministic conversion tests
vi.mock('heic-convert', () => ({
  default: vi.fn().mockImplementation(async ({ buffer }) => {
    if (buffer.length === 0 || (buffer.length > 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x00 && buffer[3] === 0x00)) {
      throw new Error('Invalid HEIC header');
    }
    // Return simulated JPEG bytes
    return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03]);
  }),
}));

describe('ImageConversionService', () => {
  let service: ImageConversionService;

  beforeEach(() => {
    service = new ImageConversionService();
  });

  it('leaves JPEG buffer unchanged without conversion', async () => {
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const result = await service.prepareImageForOcr(jpegBuffer, 'image/jpeg');

    expect(result.wasConverted).toBe(false);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.extension).toBe('jpg');
    expect(result.buffer).toBe(jpegBuffer);
  });

  it('leaves PNG buffer unchanged without conversion', async () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const result = await service.prepareImageForOcr(pngBuffer, 'image/png');

    expect(result.wasConverted).toBe(false);
    expect(result.mimeType).toBe('image/png');
    expect(result.extension).toBe('png');
    expect(result.buffer).toBe(pngBuffer);
  });

  it('converts HEIC buffer to JPEG for OCR compatibility', async () => {
    const heicBuffer = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
    const result = await service.prepareImageForOcr(heicBuffer, 'image/heic');

    expect(result.wasConverted).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.extension).toBe('jpg');
    expect(result.buffer[0]).toBe(0xff);
    expect(result.buffer[1]).toBe(0xd8);
  });

  it('converts HEIF buffer to JPEG for OCR compatibility', async () => {
    const heifBuffer = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x69, 0x66, 0x31]);
    const result = await service.prepareImageForOcr(heifBuffer, 'image/heif');

    expect(result.wasConverted).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.extension).toBe('jpg');
  });

  it('throws BadRequestException for corrupt HEIC payload', async () => {
    const corruptBuffer = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]);
    await expect(service.prepareImageForOcr(corruptBuffer, 'image/heic')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException for empty buffer', async () => {
    await expect(service.prepareImageForOcr(Buffer.alloc(0), 'image/jpeg')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException for non-image MIME types', async () => {
    const pdfBuffer = Buffer.from('%PDF-1.4');
    await expect(service.prepareImageForOcr(pdfBuffer, 'application/pdf')).rejects.toThrow(
      /Unsupported image MIME type/,
    );
  });
});

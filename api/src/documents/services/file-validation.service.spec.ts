import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../database/prisma.service.js';
import { EICAR_TEST_SIGNATURE } from './antivirus.service.js';
import { FileValidationService } from './file-validation.service.js';

describe('FileValidationService', () => {
  let service: FileValidationService;
  let mockPrisma: any;
  let mockAntivirus: any;
  let mockConfig: ConfigService;

  const validPdfBuffer = Buffer.from('%PDF-1.7\nSample content with enough bytes to be realistic\n%%EOF');
  const validJpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const validPngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);

  beforeEach(() => {
    mockConfig = new ConfigService({
      upload: {
        maxFileSizeBytes: 1024 * 1024, // 1 MB limit for tests
        clamav: {
          enabled: false,
          host: '127.0.0.1',
          port: 3310,
          timeoutMs: 1000,
          failOpen: false,
        },
      },
    });

    mockPrisma = {
      space: {
        findUnique: vi.fn(),
      },
      documentVersion: {
        findFirst: vi.fn(),
      },
    };

    mockAntivirus = {
      scanBuffer: vi.fn().mockResolvedValue({ isInfected: false }),
    };

    service = new FileValidationService(mockConfig, mockPrisma as unknown as PrismaService, mockAntivirus);
  });

  it('rejects empty file with BadRequestException', async () => {
    await expect(service.validateFile({ buffer: Buffer.alloc(0) })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects oversized file with PayloadTooLargeException', async () => {
    // 1 MB limit configured; provide 1 MB + 1 byte
    const oversizedBuffer = Buffer.alloc(1024 * 1024 + 1);
    await expect(service.validateFile({ buffer: oversizedBuffer })).rejects.toThrow(
      PayloadTooLargeException,
    );
  });

  it('rejects unsupported file type with BadRequestException', async () => {
    const scriptBuffer = Buffer.from('#!/bin/bash\necho dangerous script');
    await expect(
      service.validateFile({
        buffer: scriptBuffer,
        originalName: 'exploit.sh',
        declaredMimeType: 'application/x-sh',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('validates a legitimate Word (DOCX) file and returns its checksum and mime type', async () => {
    const docxBuffer = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('[Content_Types].xml...word/document.xml...word/_rels'),
    ]);
    const result = await service.validateFile({
      buffer: docxBuffer,
      originalName: 'syllabus.docx',
    });

    expect(result.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(result.extension).toBe('docx');
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('validates a legitimate PowerPoint (PPTX) file and returns its checksum and mime type', async () => {
    const pptxBuffer = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('[Content_Types].xml...ppt/presentation.xml'),
    ]);
    const result = await service.validateFile({
      buffer: pptxBuffer,
      originalName: 'lecture-01.pptx',
    });

    expect(result.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(result.extension).toBe('pptx');
  });

  it('validates a legitimate Excel (XLSX) file and returns its checksum and mime type', async () => {
    const xlsxBuffer = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('[Content_Types].xml...xl/workbook.xml'),
    ]);
    const result = await service.validateFile({
      buffer: xlsxBuffer,
      originalName: 'grades.xlsx',
    });

    expect(result.mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(result.extension).toBe('xlsx');
  });

  it('validates a legitimate plain text document and returns its checksum and mime type', async () => {
    const textBuffer = Buffer.from('Plain text study notes for class.');
    const result = await service.validateFile({
      buffer: textBuffer,
      originalName: 'notes.txt',
    });

    expect(result.mimeType).toBe('text/plain');
    expect(result.extension).toBe('txt');
  });

  it('refuses spoofed files pretending to be PDF by file extension', async () => {
    const spoofedBuffer = Buffer.from('Fake PDF content that has no magic bytes');
    await expect(
      service.validateFile({
        buffer: spoofedBuffer,
        originalName: 'report.pdf',
        declaredMimeType: 'application/pdf',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses infected file (EICAR) with clear malware error', async () => {
    const infectedBuffer = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.from(EICAR_TEST_SIGNATURE),
    ]);

    mockAntivirus.scanBuffer.mockResolvedValueOnce({
      isInfected: true,
      virusName: 'Eicar-Test-Signature',
    });

    await expect(service.validateFile({ buffer: infectedBuffer })).rejects.toThrow(
      /Malware detected: file is infected with Eicar-Test-Signature/,
    );
  });

  it('validates a legitimate PDF and returns its checksum and mime type', async () => {
    const result = await service.validateFile({
      buffer: validPdfBuffer,
      originalName: 'document.pdf',
    });

    expect(result.mimeType).toBe('application/pdf');
    expect(result.extension).toBe('pdf');
    expect(result.size).toBe(validPdfBuffer.length);
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('validates a legitimate JPEG and returns its checksum and mime type', async () => {
    const result = await service.validateFile({
      buffer: validJpegBuffer,
      originalName: 'photo.jpg',
    });

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.extension).toBe('jpg');
    expect(result.size).toBe(validJpegBuffer.length);
  });

  it('validates a legitimate PNG and returns its checksum and mime type', async () => {
    const result = await service.validateFile({
      buffer: validPngBuffer,
      originalName: 'chart.png',
    });

    expect(result.mimeType).toBe('image/png');
    expect(result.extension).toBe('png');
    expect(result.size).toBe(validPngBuffer.length);
  });

  it('throws NotFoundException when validating against a non-existent space', async () => {
    mockPrisma.space.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.validateFile({
        buffer: validPdfBuffer,
        spaceId: 'non-existent-space-id',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('detects duplicate checksum in the same space and throws ConflictException', async () => {
    mockPrisma.space.findUnique.mockResolvedValueOnce({ id: 'space-1', name: 'Math Space' });
    mockPrisma.documentVersion.findFirst.mockResolvedValueOnce({
      id: 'version-1',
      versionNo: 1,
      document: {
        id: 'doc-1',
        title: 'Existing Syllabus',
      },
    });

    await expect(
      service.validateFile({
        buffer: validPdfBuffer,
        spaceId: 'space-1',
      }),
    ).rejects.toThrow(ConflictException);

    expect(mockPrisma.documentVersion.findFirst).toHaveBeenCalledWith({
      where: {
        checksum: expect.any(String),
        document: {
          spaceId: 'space-1',
          deletedAt: null,
        },
      },
      include: {
        document: {
          select: { id: true, title: true },
        },
      },
    });
  });

  it('allows duplicate checksum when allowDuplicates is explicitly true', async () => {
    mockPrisma.space.findUnique.mockResolvedValueOnce({ id: 'space-1', name: 'Math Space' });

    const result = await service.validateFile({
      buffer: validPdfBuffer,
      spaceId: 'space-1',
      allowDuplicates: true,
    });

    expect(result.mimeType).toBe('application/pdf');
    expect(mockPrisma.documentVersion.findFirst).not.toHaveBeenCalled();
  });

  it('passes when no duplicate exists in the target space', async () => {
    mockPrisma.space.findUnique.mockResolvedValueOnce({ id: 'space-1', name: 'Math Space' });
    mockPrisma.documentVersion.findFirst.mockResolvedValueOnce(null);

    const result = await service.validateFile({
      buffer: validPdfBuffer,
      spaceId: 'space-1',
    });

    expect(result.mimeType).toBe('application/pdf');
    expect(result.checksum).toBeDefined();
  });
});


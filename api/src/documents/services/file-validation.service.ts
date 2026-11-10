import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import type { UploadConfig } from '../../config/upload.config.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  type AllowedMimeType,
  detectMimeTypeFromBuffer,
} from '../utils/magic-bytes.util.js';
import { AntivirusService } from './antivirus.service.js';

export interface ValidateUploadOptions {
  buffer: Buffer;
  originalName?: string;
  declaredMimeType?: string;
  spaceId?: string;
  allowDuplicates?: boolean;
}

export interface ValidatedFileResult {
  checksum: string;
  mimeType: AllowedMimeType;
  extension: string;
  size: number;
}

@Injectable()
export class FileValidationService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly antivirusService: AntivirusService,
  ) {}

  /**
   * Validates an uploaded file buffer for ingestion:
   * 1. Checks file size against configured limit.
   * 2. Inspects magic bytes to detect real MIME type (PDF, JPEG, PNG, HEIC).
   * 3. Scans for malware / viruses (EICAR signature and ClamAV).
   * 4. Computes SHA-256 content checksum.
   * 5. When `spaceId` is provided, ensures space exists and checks for duplicate checksums in that space.
   *
   * Throws clear HTTP exceptions (400, 404, 409, 413) on validation refusal.
   */
  async validateFile(options: ValidateUploadOptions): Promise<ValidatedFileResult> {
    const { buffer, originalName, spaceId, allowDuplicates = false } = options;

    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Uploaded file cannot be empty');
    }

    // 1. Enforce configurable max file size
    const uploadConfig = this.configService.get<UploadConfig>('upload');
    const maxSizeBytes = uploadConfig?.maxFileSizeBytes ?? 52428800; // default 50 MB

    if (buffer.length > maxSizeBytes) {
      const maxMb = Math.round(maxSizeBytes / (1024 * 1024));
      throw new PayloadTooLargeException(
        `File size (${buffer.length} bytes) exceeds the maximum allowed size of ${maxSizeBytes} bytes (${maxMb} MB)`,
      );
    }

    // 2. Detect MIME type from magic bytes (do not trust extension or header alone)
    const detected = detectMimeTypeFromBuffer(buffer, originalName);
    if (!detected) {
      throw new BadRequestException(
        'Unsupported file type. Only PDF, Office documents (Word, Excel, PowerPoint), text, and images are allowed.',
      );
    }

    // 3. Scan with Antivirus before storage
    const scanResult = await this.antivirusService.scanBuffer(buffer);
    if (scanResult.isInfected) {
      const virus = scanResult.virusName ?? 'Eicar-Test-Signature';
      throw new BadRequestException(`Malware detected: file is infected with ${virus}`);
    }

    // 4. Compute SHA-256 checksum
    const checksum = createHash('sha256').update(buffer).digest('hex');

    // 5. Detect duplicates in space if spaceId is provided
    if (spaceId) {
      const space = await this.prisma.space.findUnique({
        where: { id: spaceId },
        select: { id: true, name: true },
      });
      if (!space) {
        throw new NotFoundException(`Space with ID ${spaceId} not found`);
      }

      if (!allowDuplicates) {
        const existingVersion = await this.prisma.documentVersion.findFirst({
          where: {
            checksum,
            document: {
              spaceId,
              deletedAt: null,
            },
          },
          include: {
            document: {
              select: { id: true, title: true },
            },
          },
        });

        if (existingVersion) {
          throw new ConflictException(
            `A file with identical content (SHA-256: ${checksum}) already exists in this space (document "${existingVersion.document.title}", version ${existingVersion.versionNo})`,
          );
        }
      }
    }

    return {
      checksum,
      mimeType: detected.mimeType,
      extension: detected.extension,
      size: buffer.length,
    };
  }
}


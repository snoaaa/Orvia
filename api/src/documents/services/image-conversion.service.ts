import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import convert from 'heic-convert';

export interface ConvertedImageResult {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/png';
  extension: 'jpg' | 'png';
  wasConverted: boolean;
}

@Injectable()
export class ImageConversionService {
  private readonly logger = new Logger(ImageConversionService.name);

  /**
   * Converts HEIC / HEIF images into OCR-ready JPEG format (§4.1, §9, #103).
   * For already OCR-compatible formats (JPEG, PNG), returns the original buffer unchanged.
   */
  async prepareImageForOcr(buffer: Buffer, detectedMime: string): Promise<ConvertedImageResult> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Image buffer is empty');
    }

    if (detectedMime === 'image/jpeg') {
      return {
        buffer,
        mimeType: 'image/jpeg',
        extension: 'jpg',
        wasConverted: false,
      };
    }

    if (detectedMime === 'image/png') {
      return {
        buffer,
        mimeType: 'image/png',
        extension: 'png',
        wasConverted: false,
      };
    }

    if (detectedMime === 'image/heic' || detectedMime === 'image/heif') {
      this.logger.log(`Converting HEIC/HEIF image (${buffer.length} bytes) to JPEG for OCR compatibility`);
      try {
        const output = await convert({
          buffer: new Uint8Array(buffer),
          format: 'JPEG',
          quality: 0.92,
        });

        const convertedBuffer = Buffer.from(output);
        this.logger.log(`Successfully converted HEIC to JPEG (${convertedBuffer.length} bytes)`);

        return {
          buffer: convertedBuffer,
          mimeType: 'image/jpeg',
          extension: 'jpg',
          wasConverted: true,
        };
      } catch (err: any) {
        this.logger.error(`HEIC conversion failed: ${err?.message}`, err?.stack);
        throw new BadRequestException(
          `Failed to convert HEIC image to OCR-supported format: ${err?.message || 'Invalid or corrupt HEIC payload'}`,
        );
      }
    }

    throw new BadRequestException(
      `Unsupported image MIME type: ${detectedMime}. Only JPEG, PNG, and HEIC are supported.`,
    );
  }
}

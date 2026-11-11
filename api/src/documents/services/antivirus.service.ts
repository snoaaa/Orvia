import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'node:net';
import type { UploadConfig } from '../../config/upload.config.js';

export interface AntivirusScanResult {
  isInfected: boolean;
  virusName?: string;
}

/** Standard EICAR antivirus test signature. */
export const EICAR_TEST_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

@Injectable()
export class AntivirusService {
  private readonly logger = new Logger(AntivirusService.name);
  private readonly eicarBuffer = Buffer.from(EICAR_TEST_SIGNATURE);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Scans a file buffer for malware.
   *
   * 1. Checks for standard EICAR test signature (works without external ClamAV daemon).
   * 2. If ClamAV daemon integration is enabled (`CLAMAV_ENABLED=true`), streams the file
   *    via TCP INSTREAM protocol and returns the scan verdict.
   */
  async scanBuffer(buffer: Buffer): Promise<AntivirusScanResult> {
    if (!buffer || buffer.length === 0) {
      return { isInfected: false };
    }

    // 1. In-memory signature check for EICAR test virus
    if (buffer.includes(this.eicarBuffer)) {
      this.logger.warn('Malware signature detected: Eicar-Test-Signature');
      return {
        isInfected: true,
        virusName: 'Eicar-Test-Signature',
      };
    }

    const uploadConfig = this.configService.get<UploadConfig>('upload');
    const clamav = uploadConfig?.clamav;

    // 2. ClamAV daemon scan if enabled
    if (clamav?.enabled) {
      return this.scanWithClamAv(buffer, clamav);
    }

    return { isInfected: false };
  }

  /**
   * Streams the buffer to a running ClamAV daemon using the `zINSTREAM\0` protocol.
   */
  private scanWithClamAv(
    buffer: Buffer,
    clamav: { host: string; port: number; timeoutMs: number; failOpen: boolean },
  ): Promise<AntivirusScanResult> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      let responseData = '';
      let isDone = false;

      const cleanup = () => {
        if (!socket.destroyed) {
          socket.destroy();
        }
      };

      socket.setTimeout(clamav.timeoutMs);

      socket.on('timeout', () => {
        cleanup();
        this.logger.error(`ClamAV socket timed out after ${clamav.timeoutMs}ms`);
        if (clamav.failOpen) {
          this.logger.warn('CLAMAV_FAIL_OPEN is true: allowing file through after timeout');
          resolve({ isInfected: false });
        } else {
          reject(new ServiceUnavailableException('Antivirus scanner service timed out'));
        }
      });

      socket.on('error', (err) => {
        cleanup();
        this.logger.error(`ClamAV connection error: ${err.message}`);
        if (clamav.failOpen) {
          this.logger.warn('CLAMAV_FAIL_OPEN is true: allowing file through after socket error');
          resolve({ isInfected: false });
        } else {
          reject(new ServiceUnavailableException(`Antivirus scanner service unavailable: ${err.message}`));
        }
      });

      socket.connect(clamav.port, clamav.host, () => {
        // Send command zINSTREAM\0
        socket.write('zINSTREAM\0');

        // Stream buffer in chunks (up to 64 KB each)
        const CHUNK_SIZE = 64 * 1024;
        let offset = 0;

        while (offset < buffer.length) {
          const chunkLength = Math.min(CHUNK_SIZE, buffer.length - offset);
          const chunk = buffer.subarray(offset, offset + chunkLength);

          const lengthHeader = Buffer.alloc(4);
          lengthHeader.writeUInt32BE(chunkLength, 0);

          socket.write(lengthHeader);
          socket.write(chunk);

          offset += chunkLength;
        }

        // Send EOF chunk (length 0)
        socket.write(Buffer.alloc(4));
      });

      socket.on('data', (chunk) => {
        responseData += chunk.toString('utf-8');
      });

      socket.on('close', () => {
        if (isDone) return;
        isDone = true;

        const trimmed = responseData.trim();
        // ClamAV format: "stream: <virusName> FOUND"
        const foundMatch = /stream:\s+(.+)\s+FOUND/i.exec(trimmed);
        if (foundMatch) {
          const virusName = foundMatch[1].trim();
          this.logger.warn(`ClamAV detected malware: ${virusName}`);
          resolve({ isInfected: true, virusName });
          return;
        }

        // ClamAV format: "stream: OK"
        if (/stream:\s+OK/i.test(trimmed)) {
          resolve({ isInfected: false });
          return;
        }

        // Unexpected response
        if (trimmed.length > 0) {
          this.logger.error(`Unexpected ClamAV response: ${trimmed}`);
        }
        resolve({ isInfected: false });
      });
    });
  }
}


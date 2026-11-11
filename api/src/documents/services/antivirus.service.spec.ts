import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AntivirusService, EICAR_TEST_SIGNATURE } from './antivirus.service.js';

describe('AntivirusService', () => {
  let service: AntivirusService;
  let mockServer: net.Server | null = null;
  let mockServerPort = 0;

  beforeEach(() => {
    const configService = new ConfigService({
      upload: {
        maxFileSizeBytes: 52428800,
        clamav: {
          enabled: false,
          host: '127.0.0.1',
          port: 3310,
          timeoutMs: 1000,
          failOpen: false,
        },
      },
    });
    service = new AntivirusService(configService);
  });

  afterEach(async () => {
    if (mockServer) {
      await new Promise<void>((resolve) => mockServer!.close(() => resolve()));
      mockServer = null;
    }
  });

  it('reports clean for standard innocent file buffer', async () => {
    const cleanBuffer = Buffer.from('Normal document content without any malicious payloads');
    const result = await service.scanBuffer(cleanBuffer);

    expect(result).toEqual({ isInfected: false });
  });

  it('detects standalone EICAR antivirus test signature', async () => {
    const eicarBuffer = Buffer.from(EICAR_TEST_SIGNATURE);
    const result = await service.scanBuffer(eicarBuffer);

    expect(result).toEqual({
      isInfected: true,
      virusName: 'Eicar-Test-Signature',
    });
  });

  it('detects EICAR signature embedded inside other binary content', async () => {
    const padded = Buffer.concat([
      Buffer.from('%PDF-1.4 header and some innocent lines\n'),
      Buffer.from(EICAR_TEST_SIGNATURE),
      Buffer.from('\n%%EOF'),
    ]);

    const result = await service.scanBuffer(padded);
    expect(result.isInfected).toBe(true);
    expect(result.virusName).toBe('Eicar-Test-Signature');
  });

  it('handles empty buffer safely without throwing', async () => {
    const result = await service.scanBuffer(Buffer.alloc(0));
    expect(result).toEqual({ isInfected: false });
  });

  describe('ClamAV TCP integration', () => {
    it('streams to ClamAV daemon and returns clean when response is stream: OK', async () => {
      // Create a mock ClamAV daemon TCP server
      await new Promise<void>((resolve) => {
        mockServer = net.createServer((socket) => {
          socket.on('data', () => {
            // Send ClamAV OK response
            socket.write('stream: OK\0');
            socket.end();
          });
        });
        mockServer.listen(0, '127.0.0.1', () => {
          mockServerPort = (mockServer!.address() as net.AddressInfo).port;
          resolve();
        });
      });

      const configService = new ConfigService({
        upload: {
          maxFileSizeBytes: 52428800,
          clamav: {
            enabled: true,
            host: '127.0.0.1',
            port: mockServerPort,
            timeoutMs: 2000,
            failOpen: false,
          },
        },
      });
      const clamavService = new AntivirusService(configService);

      const buffer = Buffer.from('Some clean content sent to ClamAV');
      const result = await clamavService.scanBuffer(buffer);

      expect(result).toEqual({ isInfected: false });
    });

    it('reports infected when ClamAV daemon responds with FOUND', async () => {
      await new Promise<void>((resolve) => {
        mockServer = net.createServer((socket) => {
          socket.on('data', () => {
            socket.write('stream: Win.Test.CustomMalware-42 FOUND\0');
            socket.end();
          });
        });
        mockServer.listen(0, '127.0.0.1', () => {
          mockServerPort = (mockServer!.address() as net.AddressInfo).port;
          resolve();
        });
      });

      const configService = new ConfigService({
        upload: {
          maxFileSizeBytes: 52428800,
          clamav: {
            enabled: true,
            host: '127.0.0.1',
            port: mockServerPort,
            timeoutMs: 2000,
            failOpen: false,
          },
        },
      });
      const clamavService = new AntivirusService(configService);

      const buffer = Buffer.from('Clean payload triggering mock detection');
      const result = await clamavService.scanBuffer(buffer);

      expect(result).toEqual({
        isInfected: true,
        virusName: 'Win.Test.CustomMalware-42',
      });
    });

    it('throws ServiceUnavailableException if ClamAV daemon is unreachable and failOpen is false', async () => {
      const configService = new ConfigService({
        upload: {
          maxFileSizeBytes: 52428800,
          clamav: {
            enabled: true,
            host: '127.0.0.1',
            port: 59999, // Unused port
            timeoutMs: 500,
            failOpen: false,
          },
        },
      });
      const clamavService = new AntivirusService(configService);

      await expect(clamavService.scanBuffer(Buffer.from('test'))).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('allows file through with warning if ClamAV daemon is unreachable and failOpen is true', async () => {
      const configService = new ConfigService({
        upload: {
          maxFileSizeBytes: 52428800,
          clamav: {
            enabled: true,
            host: '127.0.0.1',
            port: 59999, // Unused port
            timeoutMs: 500,
            failOpen: true,
          },
        },
      });
      const clamavService = new AntivirusService(configService);

      const result = await clamavService.scanBuffer(Buffer.from('test'));
      expect(result).toEqual({ isInfected: false });
    });
  });
});


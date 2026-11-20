import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { LocalDiskStorageService } from './services/local-disk-storage.service.js';
import { STORAGE_SERVICE } from './storage.constants.js';
import { StorageModule } from './storage.module.js';
import { StorageService } from './storage.service.js';

describe('StorageModule DI (#101)', () => {
  it('injects LocalDiskStorageService when storage.driver is local', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              storage: {
                driver: 'local',
                root: './custom-storage',
              },
            }),
          ],
        }),
        StorageModule,
      ],
    }).compile();

    const service = moduleRef.get<StorageService>(StorageService);
    expect(service).toBeInstanceOf(LocalDiskStorageService);
    expect((service as LocalDiskStorageService).getRootPath()).toContain('custom-storage');

    // Token alias check
    const tokenService = moduleRef.get<StorageService>(STORAGE_SERVICE);
    expect(tokenService).toBe(service);
  });

  it('fails fast on unknown storage driver', async () => {
    const createModule = () =>
      Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            load: [
              () => ({
                storage: {
                  driver: 'unsupported-driver',
                  root: './storage',
                },
              }),
            ],
          }),
          StorageModule,
        ],
      }).compile();

    await expect(createModule()).rejects.toThrow('Unsupported storage driver');
  });
});


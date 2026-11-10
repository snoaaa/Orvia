import { Global, Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LocalDiskStorageService } from './services/local-disk-storage.service.js';
import { STORAGE_SERVICE } from './storage.constants.js';
import { StorageService } from './storage.service.js';

const storageServiceProvider: Provider = {
  provide: StorageService,
  useFactory: (configService: ConfigService) => {
    const driver = configService.get<string>('storage.driver', 'local');
    if (driver === 'local') {
      const rootFolder = configService.get<string>('storage.root', './storage');
      return new LocalDiskStorageService(rootFolder);
    }
    throw new Error(`Unsupported storage driver: "${driver}". Only "local" is currently supported.`);
  },
  inject: [ConfigService],
};

const storageTokenAliasProvider: Provider = {
  provide: STORAGE_SERVICE,
  useExisting: StorageService,
};

@Global()
@Module({
  imports: [ConfigModule],
  providers: [storageServiceProvider, storageTokenAliasProvider],
  exports: [StorageService, STORAGE_SERVICE],
})
export class StorageModule {}


export interface StorageConfig {
  driver: 'local';
  root: string;
}

export const storageConfig = (): { storage: StorageConfig } => ({
  storage: {
    driver: (process.env.STORAGE_DRIVER as 'local') || 'local',
    root: process.env.STORAGE_ROOT || './storage',
  },
});


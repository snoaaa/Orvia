export interface UploadConfig {
  maxFileSizeBytes: number;
  clamav: {
    enabled: boolean;
    host: string;
    port: number;
    timeoutMs: number;
    failOpen: boolean;
  };
}

export const uploadConfig = (): { upload: UploadConfig } => ({
  upload: {
    // Default: 50 MB (50 * 1024 * 1024 = 52428800 bytes)
    maxFileSizeBytes: parseInt(process.env.UPLOAD_MAX_FILE_SIZE_BYTES || '52428800', 10),
    clamav: {
      enabled: process.env.CLAMAV_ENABLED === 'true',
      host: process.env.CLAMAV_HOST || 'localhost',
      port: parseInt(process.env.CLAMAV_PORT || '3310', 10),
      timeoutMs: parseInt(process.env.CLAMAV_TIMEOUT_MS || '5000', 10),
      failOpen: process.env.CLAMAV_FAIL_OPEN === 'true',
    },
  },
});


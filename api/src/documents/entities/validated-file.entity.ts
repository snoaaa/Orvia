import { ApiProperty } from '@nestjs/swagger';

export class ValidatedFileEntity {
  @ApiProperty({ example: true, description: 'Whether the file passed all validation checks' })
  valid: boolean;

  @ApiProperty({
    example: 'a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0',
    description: 'SHA-256 content checksum in lowercase hex',
  })
  checksum: string;

  @ApiProperty({
    example: 'application/pdf',
    description: 'Verified MIME type detected from magic bytes (application/pdf, image/jpeg, image/png, image/heic)',
  })
  mimeType: string;

  @ApiProperty({ example: 'pdf', description: 'Canonical file extension' })
  extension: string;

  @ApiProperty({ example: 1048576, description: 'File size in bytes' })
  size: number;

  constructor(partial: Partial<ValidatedFileEntity>) {
    Object.assign(this, partial);
  }
}

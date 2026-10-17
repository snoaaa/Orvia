import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class SyncChangeItemDto {
  @ApiProperty({ example: 'document', description: 'Entity type' })
  @IsString()
  @IsNotEmpty()
  entityType: string;

  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174010', description: 'Entity UUID' })
  @IsString()
  @IsNotEmpty()
  entityId: string;

  @ApiProperty({ example: 'update', description: 'Operation (insert, update, delete)' })
  @IsString()
  @IsNotEmpty()
  operation: string;

  @ApiProperty({ example: 2, description: 'Client version sequence' })
  @IsNumber()
  version: number;
}

export class SyncChangesDto {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'User UUID' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ type: [SyncChangeItemDto], description: 'List of client changes to synchronize' })
  @IsArray()
  changes: SyncChangeItemDto[];
}

import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsUUID, ValidateNested } from 'class-validator';
import { DOCUMENT_ACCESS_TARGET_TYPES, type DocumentAccessTargetType } from '../utils/document-visibility.util.js';

/** One target a document is published to (#109). */
export class DocumentAccessTargetDto {
  @ApiProperty({
    enum: DOCUMENT_ACCESS_TARGET_TYPES,
    example: 'class',
    description:
      'school: everyone in the school; role: everyone with that role in the school; class: members of a class; ' +
      'group: members of a group (a class sent as group is stored as class); user: one person, e.g. a parent or guest.',
  })
  @IsIn(DOCUMENT_ACCESS_TARGET_TYPES)
  type: DocumentAccessTargetType;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: "Id of the target: the document's school, a role, a group or a user of that school.",
  })
  @IsUUID('all')
  id: string;
}

/** Body of POST /documents/:id/access (#109). */
export class AddDocumentAccessDto {
  @ApiProperty({
    type: [DocumentAccessTargetDto],
    description: 'Targets to publish to (1-50). Targets the document already has are skipped.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DocumentAccessTargetDto)
  rules: DocumentAccessTargetDto[];
}

/** Body of PUT /documents/:id/access (#110): the complete new list; an empty list makes the document a draft. */
export class ReplaceDocumentAccessDto {
  @ApiProperty({
    type: [DocumentAccessTargetDto],
    description: 'All the targets the document must be published to (0-50). Targets not listed are removed.',
  })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DocumentAccessTargetDto)
  rules: DocumentAccessTargetDto[];
}

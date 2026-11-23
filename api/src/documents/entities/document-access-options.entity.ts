import { ApiProperty } from '@nestjs/swagger';

/** A target a document can be published to: its id and readable name. */
export class DocumentAccessOptionEntity {
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000', description: 'UUID to send as the rule target id' })
  id: string;

  @ApiProperty({ example: '6e A', description: 'Readable name' })
  name: string;

  constructor(partial: Partial<DocumentAccessOptionEntity>) {
    Object.assign(this, partial);
  }
}

/** The targets a document can be published to (#117): everything belongs to the document's school. */
export class DocumentAccessOptionsEntity {
  @ApiProperty({ type: () => DocumentAccessOptionEntity, description: "The document's school" })
  school: DocumentAccessOptionEntity;

  @ApiProperty({ type: [DocumentAccessOptionEntity], description: 'Roles of a school (platform roles are excluded)' })
  roles: DocumentAccessOptionEntity[];

  @ApiProperty({ type: [DocumentAccessOptionEntity], description: 'Groups of the school of type class (send as "class")' })
  classes: DocumentAccessOptionEntity[];

  @ApiProperty({
    type: [DocumentAccessOptionEntity],
    description: 'Groups of the school that are not classes: department, team (send as "group")',
  })
  groups: DocumentAccessOptionEntity[];

  constructor(partial: Partial<DocumentAccessOptionsEntity>) {
    Object.assign(this, partial);
  }
}

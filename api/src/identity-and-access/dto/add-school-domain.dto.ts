import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsSchoolDomain, normalizeDomain, SCHOOL_DOMAIN_MAX_LENGTH } from '../utils/school-domain.util.js';

/** Body of POST /schools/:id/domains (#32). */
export class AddSchoolDomainDto {
  @ApiProperty({
    example: 'lycee-leclerc.edu',
    description: 'Email domain to allow. Trimmed, lowercased and without a leading "@" ("@Lycee.EDU" → "lycee.edu").',
    maxLength: SCHOOL_DOMAIN_MAX_LENGTH,
  })
  @Transform(({ value }) => (typeof value === 'string' ? normalizeDomain(value) : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(SCHOOL_DOMAIN_MAX_LENGTH)
  @IsSchoolDomain()
  domain: string;
}

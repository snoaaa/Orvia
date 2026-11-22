import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateRoleDto } from './update-role.dto.js';

/**
 * Review fixes for #45: a `null` field must be rejected (it used to reach `trim()` as a 500, or wipe a
 * permission set), and padded codes must be trimmed before `@ArrayUnique()` decides, so
 * `["documents:read", " documents:read "]` is the same duplicate as the unpadded pair.
 */
describe('PATCH /roles/:id payload validation (#45 review)', () => {
  const errorsOf = async (body: Record<string, unknown>) => {
    const errors = await validate(plainToInstance(UpdateRoleDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return errors.map((error) => error.property);
  };

  it.each<[string, Record<string, unknown>]>([
    ['name', { name: null }],
    ['scope', { scope: null }],
    ['permissions', { permissions: null }],
    ['permissionIds', { permissionIds: null }],
  ])('rejects a null %s instead of passing it to the service', async (field, body) => {
    expect(await errorsOf(body)).toContain(field);
  });

  it('still accepts an absent field, which means "leave it alone"', async () => {
    expect(await errorsOf({})).toEqual([]);
    expect(await errorsOf({ scope: 'group' })).toEqual([]);
    expect(await errorsOf({ permissions: [] })).toEqual([]);
  });

  it('trims codes before checking uniqueness, so padded duplicates are a 400', async () => {
    expect(await errorsOf({ permissions: ['documents:read', ' documents:read '] })).toContain('permissions');
    // One padded code alone is still fine: it is trimmed, not rejected.
    expect(await errorsOf({ permissions: ['  documents:read '] })).toEqual([]);
  });

  it('rejects a padding-only code, which trims to an empty string', async () => {
    expect(await errorsOf({ permissions: ['   '] })).toContain('permissions');
  });
});

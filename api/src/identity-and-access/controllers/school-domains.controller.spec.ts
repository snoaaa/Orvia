import { HttpStatus, ParseUUIDPipe, RequestMethod } from '@nestjs/common';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it, vi } from 'vitest';
import { REQUIRED_PERMISSIONS_KEY } from '../../auth/decorators/auth.decorators.js';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.js';
import type { SchoolDomainsService } from '../services/school-domains.service.js';
import { SchoolDomainsController } from './school-domains.controller.js';

describe('SchoolDomainsController (#32)', () => {
  const actor = { id: 'admin' } as AuthenticatedUser;
  const service = { listDomains: vi.fn(), addDomain: vi.fn(), removeDomain: vi.fn() };
  const controller = new SchoolDomainsController(service as unknown as SchoolDomainsService);
  const handler = (name: keyof SchoolDomainsController) => SchoolDomainsController.prototype[name];
  /** The pipes of each route parameter, so a missing ParseUUIDPipe shows up. */
  const pipesOf = (name: keyof SchoolDomainsController) =>
    Object.values(Reflect.getMetadata(ROUTE_ARGS_METADATA, SchoolDomainsController, name) ?? {})
      .filter((arg) => (arg as { data?: unknown }).data !== undefined)
      .map((arg) => ({
        param: (arg as { data: string }).data,
        uuid: (arg as { pipes: unknown[] }).pipes.some((p) => p instanceof ParseUUIDPipe),
      }));

  it('is mounted under /schools/:id/domains', () => {
    expect(Reflect.getMetadata(PATH_METADATA, SchoolDomainsController)).toBe('schools/:id/domains');
  });

  it.each([
    ['listDomains', RequestMethod.GET, '/', 'schools:read'],
    ['addDomain', RequestMethod.POST, '/', 'schools:update'],
    ['removeDomain', RequestMethod.DELETE, ':domainId', 'schools:update'],
  ] as const)('%s is %s %s with %s', (name, method, path, permission) => {
    expect(Reflect.getMetadata(METHOD_METADATA, handler(name))).toBe(method);
    expect(Reflect.getMetadata(PATH_METADATA, handler(name))).toBe(path);
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler(name))).toEqual([permission]);
  });

  it('answers 201 on add and 204 on remove', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('addDomain'))).toBe(HttpStatus.CREATED);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler('removeDomain'))).toBe(HttpStatus.NO_CONTENT);
  });

  it('validates every id with ParseUUIDPipe', () => {
    expect(pipesOf('listDomains')).toEqual([{ param: 'id', uuid: true }]);
    expect(pipesOf('addDomain')).toEqual([{ param: 'id', uuid: true }]);
    expect(pipesOf('removeDomain').sort((a, b) => a.param.localeCompare(b.param))).toEqual([
      { param: 'domainId', uuid: true },
      { param: 'id', uuid: true },
    ]);
  });

  it('delegates to SchoolDomainsService', async () => {
    service.listDomains.mockResolvedValueOnce([{ id: 'd1' }]);
    service.addDomain.mockResolvedValueOnce({ id: 'd2' });
    const req = {
      ip: '127.0.0.1',
      header: () => undefined,
      headers: {},
      method: 'POST',
      originalUrl: '/schools/school-a/domains',
    } as never;

    expect(await controller.listDomains('school-a', actor)).toEqual([{ id: 'd1' }]);
    expect(service.listDomains).toHaveBeenCalledWith('school-a', actor);
    expect(await controller.addDomain('school-a', { domain: 'school.edu' }, actor, req)).toEqual({ id: 'd2' });
    expect(service.addDomain).toHaveBeenCalledWith('school-a', { domain: 'school.edu' }, actor, expect.anything());
    await controller.removeDomain('school-a', 'd1', actor, req);
    expect(service.removeDomain).toHaveBeenCalledWith('school-a', 'd1', actor, expect.anything());
  });
});

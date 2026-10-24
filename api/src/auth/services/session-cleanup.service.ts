import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SessionService } from './session.service.js';

/** Daily job (#12): deletes sessions that expired or were revoked long ago. */
@Injectable()
export class SessionCleanupService {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(private readonly sessions: SessionService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'session-cleanup' })
  async run(): Promise<number> {
    const deleted = await this.sessions.deleteStaleSessions();
    this.logger.log(`Session cleanup: ${deleted} stale session(s) deleted`);
    return deleted;
  }
}

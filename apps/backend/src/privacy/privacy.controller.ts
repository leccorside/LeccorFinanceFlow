import { Controller, Get, Inject, Res, StreamableFile } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import type { HttpResponse } from '../auth/http.js';
import { CurrentUser } from '../auth/session-auth.guard.js';
import { RateLimit } from '../common/security/decorators.js';
import { PrivacyService } from './privacy.service.js';

/** The user's own privacy rights. Deletions live in /assistant/data-deletions (PASSO 15). */
@Controller('privacy')
export class PrivacyController {
  constructor(@Inject(PrivacyService) private readonly privacy: PrivacyService) {}

  /** Everything about the user as a JSON file (portability). */
  @Get('export')
  @RateLimit({ policy: 'reports' })
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<StreamableFile> {
    const data = await this.privacy.export(user);
    const file = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
    const day = new Date().toISOString().slice(0, 10);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="leccor-meus-dados-${day}.json"`,
    );
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(file, {
      type: 'application/json; charset=utf-8',
      length: file.length,
    });
  }
}

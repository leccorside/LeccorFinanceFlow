import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import type { HttpResponse } from '../auth/http.js';
import { CurrentUser } from '../auth/session-auth.guard.js';
import { RateLimit } from '../common/security/decorators.js';
import { dto, validate } from '../common/validation/zod-validation.pipe.js';
import { type VoiceCapabilities, VoiceService } from './voice.service.js';

const speech = dto({ messageId: z.uuid() });

/**
 * Voice routes. The browser records, sends the audio as the raw request body (audio/*), gets
 * the text back and sends it to the assistant like a typed message; replies are read aloud
 * on request. Every route needs the session; writes need CSRF; provider calls are limited.
 */
@Controller('voice')
export class VoiceController {
  constructor(@Inject(VoiceService) private readonly voice: VoiceService) {}

  @Get('capabilities')
  capabilities(): VoiceCapabilities {
    return this.voice.capabilities();
  }

  @Post('transcriptions')
  @HttpCode(200)
  @RateLimit({ policy: 'voice' })
  transcribe(
    @CurrentUser() user: AuthenticatedUser,
    // Raw bytes (Buffer) from the audio body parser; anything else is refused by the service.
    @Body() audio: unknown,
    @Headers('content-type') contentType: string | undefined,
  ) {
    return this.voice.transcribe(user, audio, contentType);
  }

  @Post('speech')
  @HttpCode(200)
  @RateLimit({ policy: 'voice' })
  async speech(
    @CurrentUser() user: AuthenticatedUser,
    @Body(validate(speech)) body: z.infer<typeof speech>,
    @Res({ passthrough: true }) response: HttpResponse,
  ): Promise<StreamableFile> {
    const audio = await this.voice.speak(user, body.messageId);
    response.setHeader('Cache-Control', 'no-store');
    return new StreamableFile(audio.audio, {
      type: audio.mimeType,
      length: audio.audio.length,
    });
  }
}

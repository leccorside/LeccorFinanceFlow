import { Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/session-auth.guard.js';
import { validate } from '../common/validation/zod-validation.pipe.js';
import { type UpdateProfileInput, updateProfileSchema } from './profile.schemas.js';
import { type ProfileResponse, ProfileService } from './profile.service.js';

/**
 * The caller's own profile. There is no `:id` route on purpose: a user can only ever
 * address their own profile, so there is nothing to guess (no IDOR surface).
 */
@Controller('profile')
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profiles: ProfileService) {}

  @Get()
  get(@CurrentUser() user: AuthenticatedUser): Promise<ProfileResponse> {
    return this.profiles.get(user);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(validate(updateProfileSchema)) body: UpdateProfileInput,
  ): Promise<ProfileResponse> {
    return this.profiles.update(user, body);
  }
}

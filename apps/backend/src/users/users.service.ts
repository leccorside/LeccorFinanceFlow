import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.errors.js';
import type { GoogleIdentity } from '../auth/google-identity.provider.js';
import { APP_ENV, type AppEnv } from '../config/env.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type User } from '../generated/prisma/client.js';
import { SettingsService } from '../settings/settings.service.js';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  /**
   * Finds the user for a verified Google identity, linking by e-mail or creating
   * a new USER account. The e-mail of an existing account is never overwritten here.
   */
  async resolveGoogleUser(identity: GoogleIdentity): Promise<User> {
    let user: User;
    try {
      user = await this.findOrCreate(identity);
    } catch (error) {
      // Two simultaneous first logins: the loser hits a unique violation; retry finds the winner.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        user = await this.findOrCreate(identity);
      } else {
        throw error;
      }
    }

    await this.grantConfiguredAdmin(user);
    return user;
  }

  /**
   * The account e-mail follows the verified e-mail of the linked Google account: that is
   * the only trusted way to change it (the profile API never accepts `email`). If another
   * account already uses the new address, the current one is kept.
   */
  private async syncVerifiedEmail(user: User, verifiedEmail: string): Promise<User> {
    if (user.email === verifiedEmail) {
      return user;
    }
    const taken = await this.prisma.user.findUnique({ where: { email: verifiedEmail } });
    if (taken) {
      return user;
    }
    try {
      return await this.prisma.user.update({
        where: { id: user.id },
        data: { email: verifiedEmail },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return user; // lost a race for the same address: keep the current e-mail
      }
      throw error;
    }
  }

  /**
   * Bootstrap of administrators: accounts whose e-mail is in ADMIN_EMAILS receive ADMIN
   * on login. Grants are additive; removing an e-mail from the list does not demote
   * (demotion is an explicit admin action, PASSO 20).
   */
  private async grantConfiguredAdmin(user: User): Promise<void> {
    if (!this.env.ADMIN_EMAILS.includes(user.email)) {
      return;
    }
    const admin = await this.prisma.role.upsert({
      where: { name: 'ADMIN' },
      create: { name: 'ADMIN', description: 'Controle completo da plataforma.' },
      update: {},
    });
    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: admin.id } },
      create: { userId: user.id, roleId: admin.id },
      update: {},
    });
  }

  private async findOrCreate(identity: GoogleIdentity): Promise<User> {
    const email = normalizeEmail(identity.email);

    const bySubject = await this.prisma.user.findUnique({
      where: { googleSubject: identity.subject },
    });
    if (bySubject) {
      return this.syncVerifiedEmail(bySubject, email);
    }

    const byEmail = await this.prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      if (byEmail.googleSubject !== null) {
        // Same e-mail already bound to a different Google account.
        throw new AuthError('account_conflict');
      }
      return this.prisma.user.update({
        where: { id: byEmail.id },
        data: { googleSubject: identity.subject },
      });
    }

    // Closed signups keep existing accounts working; configured admins can always enter.
    if (
      !this.env.ADMIN_EMAILS.includes(email) &&
      !(await this.settings.get('signups.enabled'))
    ) {
      throw new AuthError('signups_closed');
    }
    return this.prisma.user.create({
      data: {
        email,
        googleSubject: identity.subject,
        roles: {
          create: {
            role: {
              connectOrCreate: {
                where: { name: 'USER' },
                create: {
                  name: 'USER',
                  description: 'Controle apenas sobre os próprios dados financeiros.',
                },
              },
            },
          },
        },
        profile: {
          create: {
            firstName: identity.givenName?.slice(0, 100) ?? null,
            lastName: identity.familyName?.slice(0, 100) ?? null,
            photoUrl: identity.picture?.slice(0, 2048) ?? null,
          },
        },
      },
    });
  }
}

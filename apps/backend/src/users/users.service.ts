import { Inject, Injectable } from '@nestjs/common';
import { AuthError } from '../auth/auth.errors.js';
import type { GoogleIdentity } from '../auth/google-identity.provider.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type User } from '../generated/prisma/client.js';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Finds the user for a verified Google identity, linking by e-mail or creating
   * a new USER account. The e-mail of an existing account is never overwritten here.
   */
  async resolveGoogleUser(identity: GoogleIdentity): Promise<User> {
    try {
      return await this.findOrCreate(identity);
    } catch (error) {
      // Two simultaneous first logins: the loser hits a unique violation; retry finds the winner.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return this.findOrCreate(identity);
      }
      throw error;
    }
  }

  private async findOrCreate(identity: GoogleIdentity): Promise<User> {
    const email = normalizeEmail(identity.email);

    const bySubject = await this.prisma.user.findUnique({
      where: { googleSubject: identity.subject },
    });
    if (bySubject) {
      return bySubject;
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

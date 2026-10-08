import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../../src/auth/auth.service.js';
import { CurrentUser } from '../../src/auth/session-auth.guard.js';
import { ResourceNotFoundException } from '../../src/common/errors/api-error.js';
import { ownedBy } from '../../src/common/security/ownership.js';
import { Public, RateLimit, Roles } from '../../src/common/security/decorators.js';
import {
  dto,
  uuidParam,
  validate,
} from '../../src/common/validation/zod-validation.pipe.js';
import { PrismaService } from '../../src/database/prisma.service.js';

const createAccount = dto({
  name: z.string().trim().min(1).max(100),
  type: z.enum([
    'CHECKING',
    'SAVINGS',
    'WALLET',
    'CASH',
    'DIGITAL',
    'INVESTMENT',
    'OTHER',
  ]),
});
const renameAccount = dto({ name: z.string().trim().min(1).max(100) });

/**
 * Test-only routes that exercise the real security pipeline the way domain modules
 * will use it (PASSO 09+): default-deny, @Public, @Roles, strict DTOs, UUID params,
 * owner-scoped queries and 404 for foreign resources.
 */
@Controller()
class PolicyProbeController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Public()
  @Get('probe/public')
  publicRoute() {
    return { ok: true };
  }

  @Get('probe/private')
  privateRoute(@CurrentUser() user: AuthenticatedUser) {
    return { userId: user.id };
  }

  @Roles('ADMIN')
  @Get('admin/probe')
  adminRoute() {
    return { admin: true };
  }

  @Post('probe/accounts')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(validate(createAccount)) body: z.infer<typeof createAccount>,
  ) {
    // ownerId comes from the session, never from the payload.
    return this.prisma.financialAccount.create({ data: { ...body, ownerId: user.id } });
  }

  @Get('probe/accounts/:id')
  async read(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidParam) id: string) {
    const account = await this.prisma.financialAccount.findFirst({
      where: { id, ...ownedBy(user) },
    });
    if (!account) {
      throw new ResourceNotFoundException();
    }
    return account;
  }

  @Patch('probe/accounts/:id')
  async rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(validate(renameAccount)) body: z.infer<typeof renameAccount>,
  ) {
    const { count } = await this.prisma.financialAccount.updateMany({
      where: { id, ...ownedBy(user) },
      data: body,
    });
    if (count === 0) {
      throw new ResourceNotFoundException();
    }
    return { updated: true };
  }

  @Delete('probe/accounts/:id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
  ) {
    const { count } = await this.prisma.financialAccount.deleteMany({
      where: { id, ...ownedBy(user) },
    });
    if (count === 0) {
      throw new ResourceNotFoundException();
    }
  }

  @Public()
  @RateLimit({ name: 'probe', limit: 3, windowMs: 60_000 })
  @Get('probe/limited')
  limited() {
    return { ok: true };
  }

  @Public()
  @Get('probe/crash')
  crash() {
    throw new Error('connection string postgres://secret@db leaked?');
  }

  @Public()
  @Post('probe/echo')
  echo(@Body(validate(dto({ text: z.string() }))) body: { text: string }) {
    return body;
  }
}

@Module({ controllers: [PolicyProbeController] })
export class PolicyProbeModule {}

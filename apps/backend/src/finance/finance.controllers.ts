import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthenticatedUser } from '../auth/auth.service.js';
import { CurrentUser } from '../auth/session-auth.guard.js';
import { dto, uuidParam, validate } from '../common/validation/zod-validation.pipe.js';
import { AccountsService } from './accounts.service.js';
import { ActionHistoryService } from './action-history.service.js';
import { CategoriesService } from './categories.service.js';
import { FinanceQueriesService } from './finance-queries.service.js';
import {
  byPeriodSchema,
  type CreateAccountInput,
  createAccountSchema,
  type CreateCategoryInput,
  createCategorySchema,
  type CreateTransactionInput,
  createTransactionSchema,
  listCategoriesSchema,
  periodSchema,
  type SearchTransactionsInput,
  searchTransactionsSchema,
  type UpdateAccountInput,
  updateAccountSchema,
  type UpdateCategoryInput,
  updateCategorySchema,
  type UpdateTransactionInput,
  updateTransactionSchema,
  upcomingSchema,
} from './finance.schemas.js';
import { TransactionsService } from './transactions.service.js';

/**
 * REST surface of the financial domain. Every route is authenticated (global guard), every
 * write needs X-CSRF-Token, every query is scoped to the caller. The assistant (PASSO 13)
 * calls the same services directly.
 */
@Controller('accounts')
export class AccountsController {
  constructor(@Inject(AccountsService) private readonly accounts: AccountsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(validate(dto({ includeArchived: z.enum(['true', 'false']).optional() })))
    query: { includeArchived?: 'true' | 'false' },
  ) {
    return this.accounts.list(user, query.includeArchived === 'true');
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidParam) id: string) {
    return this.accounts.get(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(validate(createAccountSchema)) body: CreateAccountInput,
  ) {
    return this.accounts.create(user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(validate(updateAccountSchema)) body: UpdateAccountInput,
  ) {
    return this.accounts.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidParam) id: string) {
    return this.accounts.delete(user, id);
  }
}

@Controller('categories')
export class CategoriesController {
  constructor(
    @Inject(CategoriesService) private readonly categories: CategoriesService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(validate(listCategoriesSchema)) query: z.infer<typeof listCategoriesSchema>,
  ) {
    return this.categories.list(user, {
      ...(query.kind ? { kind: query.kind } : {}),
      includeArchived: query.includeArchived === 'true',
    });
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(validate(createCategorySchema)) body: CreateCategoryInput,
  ) {
    return this.categories.create(user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(validate(updateCategorySchema)) body: UpdateCategoryInput,
  ) {
    return this.categories.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidParam) id: string) {
    return this.categories.delete(user, id);
  }
}

@Controller('transactions')
export class TransactionsController {
  constructor(
    @Inject(TransactionsService) private readonly transactions: TransactionsService,
  ) {}

  @Get()
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query(validate(searchTransactionsSchema)) query: SearchTransactionsInput,
  ) {
    return this.transactions.search(user, query);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidParam) id: string) {
    return this.transactions.get(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(validate(createTransactionSchema)) body: CreateTransactionInput,
  ) {
    return this.transactions.create(user, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', uuidParam) id: string,
    @Body(validate(updateTransactionSchema)) body: UpdateTransactionInput,
  ) {
    return this.transactions.update(user, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@CurrentUser() user: AuthenticatedUser, @Param('id', uuidParam) id: string) {
    return this.transactions.delete(user, id);
  }
}

@Controller('finance')
export class FinanceController {
  constructor(
    @Inject(FinanceQueriesService) private readonly queries: FinanceQueriesService,
  ) {}

  @Get('summary')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Query(validate(periodSchema)) query: z.infer<typeof periodSchema>,
  ) {
    return this.queries.summary(user, query.from, query.to);
  }

  @Get('expenses-by-period')
  expenses(
    @CurrentUser() user: AuthenticatedUser,
    @Query(validate(byPeriodSchema)) query: z.infer<typeof byPeriodSchema>,
  ) {
    return this.queries.byPeriod(user, 'EXPENSE', query.from, query.to, query.groupBy);
  }

  @Get('income-by-period')
  income(
    @CurrentUser() user: AuthenticatedUser,
    @Query(validate(byPeriodSchema)) query: z.infer<typeof byPeriodSchema>,
  ) {
    return this.queries.byPeriod(user, 'INCOME', query.from, query.to, query.groupBy);
  }

  @Get('upcoming-bills')
  upcoming(
    @CurrentUser() user: AuthenticatedUser,
    @Query(validate(upcomingSchema)) query: z.infer<typeof upcomingSchema>,
  ) {
    return this.queries.upcomingBills(user, query.days);
  }

  @Get('overdue-bills')
  overdue(@CurrentUser() user: AuthenticatedUser) {
    return this.queries.overdueBills(user);
  }
}

@Controller('action-history')
export class ActionHistoryController {
  constructor(
    @Inject(ActionHistoryService) private readonly history: ActionHistoryService,
  ) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(validate(dto({ limit: z.coerce.number().int().min(1).max(200).optional() })))
    query: { limit?: number },
  ) {
    return this.history.list(user, query.limit);
  }
}

import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service.js';
import { ActionHistoryService } from './action-history.service.js';
import { CategoriesService } from './categories.service.js';
import { FinanceQueriesService } from './finance-queries.service.js';
import {
  AccountsController,
  ActionHistoryController,
  CategoriesController,
  FinanceController,
  TransactionsController,
} from './finance.controllers.js';
import { TransactionsService } from './transactions.service.js';

@Module({
  controllers: [
    AccountsController,
    CategoriesController,
    TransactionsController,
    FinanceController,
    ActionHistoryController,
  ],
  providers: [
    AccountsService,
    CategoriesService,
    TransactionsService,
    FinanceQueriesService,
    ActionHistoryService,
  ],
  exports: [
    AccountsService,
    CategoriesService,
    TransactionsService,
    FinanceQueriesService,
    ActionHistoryService,
  ],
})
export class FinanceModule {}

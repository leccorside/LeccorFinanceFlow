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
  InstallmentsController,
  InvestmentsController,
  RecurringTransactionsController,
  TransactionsController,
} from './finance.controllers.js';
import { InstallmentsService } from './installments.service.js';
import { InvestmentsService } from './investments.service.js';
import { RecurrenceMaterializer } from './recurrence-materializer.js';
import { RecurringTransactionsService } from './recurring-transactions.service.js';
import { TransactionsService } from './transactions.service.js';

const SERVICES = [
  AccountsService,
  CategoriesService,
  TransactionsService,
  FinanceQueriesService,
  ActionHistoryService,
  RecurrenceMaterializer,
  InstallmentsService,
  RecurringTransactionsService,
  InvestmentsService,
];

@Module({
  controllers: [
    AccountsController,
    CategoriesController,
    TransactionsController,
    FinanceController,
    InstallmentsController,
    RecurringTransactionsController,
    InvestmentsController,
    ActionHistoryController,
  ],
  providers: SERVICES,
  exports: SERVICES,
})
export class FinanceModule {}

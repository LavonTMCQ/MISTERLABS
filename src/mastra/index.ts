import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';
import { sqlAgent } from './agents/sql-agent';
import { topdownV1 } from './agents/topdown-v1';
import { delilah } from './agents/delilah';
import { mister } from './agents/mister';
import { priceAgent } from './agents/price-agent';
import { recallTradingAgent } from './agents/recall_trading_agent';
import { hyperliquidTradingAgent } from './agents/hyperliquid_trading_agent';
import { databaseQueryWorkflow } from './workflows/database-query-workflow';
import { tradingWorkflow } from './workflows/trading-workflow';

export const mastra = new Mastra({
  agents: {
    sqlAgent,
    topdownV1,
    delilah,
    mister,
    priceAgent,
    recallTradingAgent,
    hyperliquidTradingAgent,
  },
  workflows: {
    databaseQueryWorkflow,
    tradingWorkflow,
  },
  storage: new LibSQLStore({
    // stores telemetry, evals, ... into memory storage, if it needs to persist, change to file:../mastra.db
    url: ':memory:',
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
});

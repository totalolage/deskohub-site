import { Schema } from "effect";
import {
  toWorkspaceMoneyMajorAmount,
  type WorkspaceMoney,
} from "@/features/checkout/workspace-money";

/** An amount in major currency units, such as 290 for CZK 290. */
export const agentToolMoneySchema = Schema.Struct({
  amount: Schema.Finite,
  currency: Schema.String,
});

export type AgentToolMoney = typeof agentToolMoneySchema.Type;

export const toAgentToolMoney = (money: WorkspaceMoney): AgentToolMoney => ({
  amount: toWorkspaceMoneyMajorAmount(money),
  currency: money.currency,
});

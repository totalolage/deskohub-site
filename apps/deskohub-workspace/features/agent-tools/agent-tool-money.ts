import { Schema } from "effect";
import { type Money, moneyMajorAmount } from "@/shared/money/money";

/** An amount in major currency units, such as 290 for CZK 290. */
export const agentToolMoneySchema = Schema.Struct({
  amount: Schema.Finite,
  currency: Schema.String,
});

export type AgentToolMoney = typeof agentToolMoneySchema.Type;

export const toAgentToolMoney = (money: Money): AgentToolMoney => ({
  amount: moneyMajorAmount(money),
  currency: money.currency,
});

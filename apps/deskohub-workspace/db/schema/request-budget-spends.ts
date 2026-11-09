import { index, pgTable, text } from "drizzle-orm/pg-core";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";

/**
 * One row per request spent from a rolling request budget. Rows hold only the
 * budget key and the spend instant, so the table never carries customer data.
 */
export const requestBudgetSpends = pgTable(
  "request_budget_spends",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    budgetKey: text("budget_key").notNull(),
    spentAt: instant("spent_at").notNull(),
  },
  (t) => [
    index("request_budget_spends_budget_key_spent_at_idx").on(
      t.budgetKey,
      t.spentAt
    ),
  ]
);

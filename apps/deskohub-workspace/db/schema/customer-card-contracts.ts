// No PII: only opaque account, provider customer, contract, and order
// references plus display metadata and a security-token digest are stored.
// Never store PAN, security code, or raw security tokens.
import type {
  NexiContractId,
  NexiCustomerId,
  NexiOrderId,
} from "@deskohub/nexi";
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { instant } from "../instant";
import { postgresUuidV7 } from "../uuid-v7";
import { authUser } from "./auth";
import { quotedSqlList } from "./sql-list";

export const customerCardContractStates = ["active", "removed"] as const;

export type CustomerCardContractState =
  (typeof customerCardContractStates)[number];

export const customerCardEnrollmentStates = [
  "pending",
  "confirmed",
  "failed",
  "cancelled",
] as const;

export type CustomerCardEnrollmentState =
  (typeof customerCardEnrollmentStates)[number];

const customerCardEnrollmentStatesRequiringFailureCode = [
  "failed",
  "cancelled",
] as const satisfies readonly CustomerCardEnrollmentState[];

export const customerCardContracts = pgTable(
  "customer_card_contracts",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    customerAccountId: text("customer_account_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    providerCustomerId: text("provider_customer_id")
      .notNull()
      .$type<NexiCustomerId>(),
    providerContractId: text("provider_contract_id")
      .notNull()
      .$type<NexiContractId>(),
    state: text("state")
      .notNull()
      .default("active")
      .$type<CustomerCardContractState>(),
    displayCircuit: text("display_circuit"),
    displaySuffix: text("display_suffix"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("customer_card_contracts_provider_contract_unique_idx").on(
      t.providerContractId
    ),
    index("customer_card_contracts_customer_account_idx").on(
      t.customerAccountId
    ),
    check(
      "customer_card_contracts_provider_customer_check",
      sql`btrim(${t.providerCustomerId}) <> ''`
    ),
    check(
      "customer_card_contracts_provider_contract_check",
      sql`btrim(${t.providerContractId}) <> ''`
    ),
    check(
      "customer_card_contracts_state_check",
      sql`${t.state} in (${quotedSqlList(customerCardContractStates)})`
    ),
    check(
      "customer_card_contracts_display_circuit_check",
      sql`${t.displayCircuit} is null or ${t.displayCircuit} ~ '^[A-Z0-9_]{1,20}$'`
    ),
    check(
      "customer_card_contracts_display_suffix_check",
      sql`${t.displaySuffix} is null or ${t.displaySuffix} ~ '^[0-9]{1,4}$'`
    ),
  ]
);

export const customerCardEnrollments = pgTable(
  "customer_card_enrollments",
  {
    id: text("id").primaryKey().default(postgresUuidV7),
    customerAccountId: text("customer_account_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    orderId: text("order_id").notNull().$type<NexiOrderId>(),
    providerCustomerId: text("provider_customer_id")
      .notNull()
      .$type<NexiCustomerId>(),
    providerContractId: text("provider_contract_id")
      .notNull()
      .$type<NexiContractId>(),
    securityTokenDigest: text("security_token_digest").notNull(),
    state: text("state")
      .notNull()
      .default("pending")
      .$type<CustomerCardEnrollmentState>(),
    failureCode: text("failure_code"),
    createdAt: instant("created_at").notNull().default(sql`now()`),
    updatedAt: instant("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("customer_card_enrollments_order_unique_idx").on(t.orderId),
    index("customer_card_enrollments_customer_account_state_idx").on(
      t.customerAccountId,
      t.state
    ),
    check(
      "customer_card_enrollments_security_token_digest_check",
      sql`${t.securityTokenDigest} ~ '^[0-9a-f]{64}$'`
    ),
    check(
      "customer_card_enrollments_state_check",
      sql`${t.state} in (${quotedSqlList(customerCardEnrollmentStates)})`
    ),
    check(
      "customer_card_enrollments_failure_code_check",
      sql`${t.state} not in (${quotedSqlList(customerCardEnrollmentStatesRequiringFailureCode)}) or btrim(${t.failureCode}) <> ''`
    ),
  ]
);

export type CustomerCardContractRow = typeof customerCardContracts.$inferSelect;
export type NewCustomerCardContractRow =
  typeof customerCardContracts.$inferInsert;
export type CustomerCardEnrollmentRow =
  typeof customerCardEnrollments.$inferSelect;
export type NewCustomerCardEnrollmentRow =
  typeof customerCardEnrollments.$inferInsert;

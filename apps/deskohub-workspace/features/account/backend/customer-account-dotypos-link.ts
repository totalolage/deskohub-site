import type { DotyposCustomerId } from "@deskohub/dotypos";
import { sql } from "drizzle-orm";
import { customerAccountLinks, customerAccounts } from "@/db/schema";
import type { CustomerAccountId } from "../customer-account";

/*
 * An account's Dotypos customer lives on `customer_accounts`, but a deployment
 * that predates the column linked accounts through `customer_account_links`
 * alone, and the contract release (#682) links them through the column alone.
 * Until that release, readers accept either record, preferring the column. A
 * tombstone holds no customer, and a link row disappears with its login, so
 * both expressions only ever name live accounts.
 */

/**
 * The Dotypos customer of the account that both `customer_accounts` and
 * `customer_account_links` are left-joined on by account id.
 */
export const linkedDotyposCustomerId = sql<DotyposCustomerId | null>`coalesce(${customerAccounts.dotyposCustomerId}, ${customerAccountLinks.dotyposCustomerId})`;

/**
 * The account linked to the Dotypos customer that both `customer_accounts`
 * and `customer_account_links` are left-joined on by customer id.
 */
export const linkedCustomerAccountId = sql<CustomerAccountId | null>`coalesce(${customerAccounts.id}, ${customerAccountLinks.customerAccountId})`;

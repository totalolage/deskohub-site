import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposService,
  readInIdFilterBatches,
  toCustomerEmailIdentity,
} from "@deskohub/dotypos";
import { Context, Data, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  postgresAdvisoryTransactionLockStatement,
  WorkspaceDatabaseAdvisoryLock,
} from "@/db/postgres-advisory-lock";
import { defaultLocale, isLocale, type Locale } from "@/features/i18n";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import type { CustomerAccountId } from "../customer-account";
import { UnverifiedLogins } from "./auth/unverified-logins.service";
import {
  ensureCustomerAccount,
  recordCustomerAccountLink,
} from "./customer-account.repository";
import {
  type AuthorlessCustomer,
  assignAuthorlessReservations,
  type CustomerLink,
  countAuthoredReservations,
  countLoginsWithAccount,
  countOrphanedAccounts,
  createAccounts,
  findLoginsWithoutAccount,
  linkBackfilledAccount,
  readAuthorlessCustomers,
  readCustomerLinks,
  readLinkRecordStates,
  readLoginsByEmail,
  tombstoneOrphanedAccounts,
} from "./customer-account-backfill.repository";
import { customerAccountLockKey } from "./customer-account-link.repository";
import { isCustomerProfileExpired } from "./customer-dotypos-adapter.service";

export type CustomerAccountBackfillRefusalReason =
  | "customer_not_found"
  | "customer_deleted"
  | "customer_expired"
  | "email_missing"
  | "email_invalid"
  | "email_duplicated"
  | "login_conflict"
  | "link_conflict";

type AuthorCounts = {
  readonly customers: number;
  readonly reservations: number;
};

/** One request's counts; it never carries emails or names. */
export type CustomerAccountBackfillReport = {
  readonly dryRun: boolean;
  readonly logins: {
    readonly created: number;
    readonly alreadyPresent: number;
  };
  readonly links: {
    readonly recorded: number;
    readonly alreadyRecorded: number;
    readonly conflicts: number;
  };
  readonly tombstones: {
    readonly recorded: number;
    readonly alreadyDeleted: number;
    readonly skippedRecent: number;
  };
  readonly authors: {
    readonly alreadyAuthored: number;
    readonly viaLink: AuthorCounts;
    readonly viaNewLogin: AuthorCounts;
    readonly viaResumedLogin: AuthorCounts;
    readonly refused: readonly {
      readonly dotyposCustomerId: DotyposCustomerId;
      readonly reason: CustomerAccountBackfillRefusalReason;
      readonly reservations: number;
    }[];
    readonly remainingCustomers: number;
  };
};

export class CustomerAccountBackfillError extends Data.TaggedError(
  "CustomerAccountBackfillError"
)<{ readonly message: string; readonly cause: unknown }> {
  static from = (cause: unknown) =>
    new CustomerAccountBackfillError({
      message: "Customer accounts could not be backfilled.",
      cause: censorLogValue(cause),
    });
}

/** Customers one applying request gives an author; the CLI repeats. */
const authorBatchSize = 100;

/** One run at a time, so two operators never plan against each other. */
const backfillLockKey = ["customer-account-backfill", "global"] as const;

/** Whole addresses only, as the administration API accepts them. */
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const emailMaxLength = 255;

type AuthorPlan =
  | {
      readonly kind: "link" | "resumedLogin";
      readonly customer: AuthorlessCustomer;
      readonly accountId: CustomerAccountId;
    }
  | {
      readonly kind: "newLogin";
      readonly customer: AuthorlessCustomer;
      readonly email: string;
      readonly locale: Locale;
    }
  | {
      readonly kind: "refused";
      readonly customer: AuthorlessCustomer;
      readonly reason: CustomerAccountBackfillRefusalReason;
    };

type AuthorResult =
  | {
      readonly kind: "link" | "resumedLogin" | "newLogin";
      readonly reservations: number;
    }
  | { readonly kind: "refused"; readonly customer: AuthorlessCustomer };

const addTo = <K, V>(map: Map<K, Set<V>>, key: K, value: V) => {
  const values = map.get(key) ?? new Set<V>();
  values.add(value);
  map.set(key, values);
};

/**
 * Resolves customers and accounts through their links. A customer resolves
 * to an account only when that live account is its single link and the
 * customer is the account's single link; anything else is a conflict.
 */
const indexCustomerLinks = (links: readonly CustomerLink[]) => {
  const accountsByCustomer = new Map<
    DotyposCustomerId,
    Set<CustomerAccountId>
  >();
  const customersByAccount = new Map<
    CustomerAccountId,
    Set<DotyposCustomerId>
  >();
  const deletedAccounts = new Set<CustomerAccountId>();
  for (const { accountId, customerId, accountDeleted } of links) {
    addTo(accountsByCustomer, customerId, accountId);
    addTo(customersByAccount, accountId, customerId);
    if (accountDeleted) deletedAccounts.add(accountId);
  }
  return {
    linkedCustomerIds: [...accountsByCustomer.keys()],
    isAccountLinked: (accountId: CustomerAccountId) =>
      customersByAccount.has(accountId),
    resolve: (customerId: DotyposCustomerId) => {
      const accounts = accountsByCustomer.get(customerId);
      if (!accounts) return { kind: "unlinked" } as const;
      const [accountId] = accounts;
      return accounts.size === 1 &&
        accountId !== undefined &&
        !deletedAccounts.has(accountId) &&
        customersByAccount.get(accountId)?.size === 1
        ? ({ kind: "linked", accountId } as const)
        : ({ kind: "conflict" } as const);
    },
  };
};

/** The usable email of a Dotypos customer, or why it has none. */
const readCustomerEmail = (customer: DotyposCustomer) => {
  const email = customer.email?.trim();
  if (!email) return { kind: "refused", reason: "email_missing" } as const;
  if (email.length > emailMaxLength || !emailPattern.test(email)) {
    return { kind: "refused", reason: "email_invalid" } as const;
  }
  return { kind: "usable", identity: toCustomerEmailIdentity(email) } as const;
};

const sumAuthors = (
  results: readonly AuthorResult[],
  kind: "link" | "resumedLogin" | "newLogin"
): AuthorCounts =>
  results.reduce(
    (counts, result) =>
      result.kind === kind
        ? {
            customers: counts.customers + 1,
            reservations: counts.reservations + result.reservations,
          }
        : counts,
    { customers: 0, reservations: 0 }
  );

interface ICustomerAccountBackfill {
  /**
   * Brings every login and legacy reservation onto durable customer
   * accounts: creates the accounts logins lack, copies Dotypos links onto
   * the account records, marks accounts whose login is gone as deleted, and
   * gives authorless reservations an author. A customer's author is the
   * account already linked to it; otherwise a new unverified login for the
   * customer's Dotypos email, created silently and linked to it. Customers
   * whose data is ambiguous are refused and left as they are.
   *
   * A dry run reports the same counts without writing. An applying request
   * gives at most {@link authorBatchSize} customers an author and reports the
   * rest as remaining, so the caller repeats it until none remain.
   */
  readonly run: (input: {
    readonly dryRun: boolean;
  }) => Effect.Effect<
    CustomerAccountBackfillReport,
    CustomerAccountBackfillError
  >;
}

export class CustomerAccountBackfill extends Context.Service<
  CustomerAccountBackfill,
  ICustomerAccountBackfill
>()("@deskohub-workspace/account/CustomerAccountBackfill") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const advisoryLock = yield* WorkspaceDatabaseAdvisoryLock;
      const dotypos = yield* DotyposService;
      const unverifiedLogins = yield* UnverifiedLogins;

      const lockAccount = (accountId: CustomerAccountId) =>
        db.execute(
          postgresAdvisoryTransactionLockStatement(
            customerAccountLockKey(accountId)
          )
        );

      const backfillLoginAccounts = Effect.fn(function* (dryRun: boolean) {
        const missing = yield* findLoginsWithoutAccount(db);
        const alreadyPresent = yield* countLoginsWithAccount(db);
        const created = dryRun
          ? missing.length
          : yield* createAccounts(db, missing);
        return { created, alreadyPresent };
      });

      /** Rechecks the link under the account lock before recording it. */
      const recordLink = (link: {
        readonly accountId: CustomerAccountId;
        readonly customerId: DotyposCustomerId;
      }) =>
        db.transaction(
          Effect.fn(function* () {
            yield* lockAccount(link.accountId);
            const [current] = yield* readLinkRecordStates(db, link.accountId);
            if (current?.customerId !== link.customerId) return "gone" as const;
            if (current.state === "recorded") return "alreadyRecorded" as const;
            if (current.state === "conflict") return "conflict" as const;
            yield* recordCustomerAccountLink(
              db,
              link.accountId,
              link.customerId
            );
            return "recorded" as const;
          })
        );

      const backfillLinkRecords = Effect.fn(function* (dryRun: boolean) {
        const states = yield* readLinkRecordStates(db);
        const pending = states.filter(({ state }) => state === "pending");
        const outcomes = dryRun
          ? pending.map(() => "recorded" as const)
          : yield* Effect.forEach(pending, recordLink);
        const countOf = (
          items: readonly string[],
          value: "recorded" | "alreadyRecorded" | "conflict"
        ) => items.filter((item) => item === value).length;
        const stateNames = states.map(({ state }) =>
          state === "recorded" ? "alreadyRecorded" : state
        );
        return {
          recorded: countOf(outcomes, "recorded"),
          alreadyRecorded:
            countOf(stateNames, "alreadyRecorded") +
            countOf(outcomes, "alreadyRecorded"),
          conflicts:
            countOf(stateNames, "conflict") + countOf(outcomes, "conflict"),
        };
      });

      const backfillTombstones = Effect.fn(function* (dryRun: boolean) {
        const orphans = yield* countOrphanedAccounts(db);
        const recorded = dryRun
          ? orphans.settled
          : yield* tombstoneOrphanedAccounts(db);
        return {
          recorded,
          alreadyDeleted: orphans.alreadyDeleted,
          skippedRecent: orphans.recent,
        };
      });

      const planAuthors = Effect.fn(function* (
        customers: readonly AuthorlessCustomer[]
      ) {
        const links = indexCustomerLinks(yield* readCustomerLinks(db));
        const refuse = (
          customer: AuthorlessCustomer,
          reason: CustomerAccountBackfillRefusalReason
        ): AuthorPlan => ({ kind: "refused", customer, reason });

        const unlinked = customers.filter(
          ({ customerId }) => links.resolve(customerId).kind === "unlinked"
        );
        const dotyposCustomers =
          unlinked.length === 0
            ? new Map<DotyposCustomerId, DotyposCustomer>()
            : new Map(
                (yield* readInIdFilterBatches(
                  [
                    ...unlinked.map(({ customerId }) => customerId),
                    ...links.linkedCustomerIds,
                  ],
                  (ids) => dotypos.getCustomers({ ids }),
                  { concurrency: 2 }
                ))
                  .flat()
                  .flatMap((customer) =>
                    customer.id ? [[customer.id, customer] as const] : []
                  )
              );
        const usableIdentity = (customerId: DotyposCustomerId) => {
          const customer = dotyposCustomers.get(customerId);
          if (!customer || customer.deleted) return undefined;
          const email = readCustomerEmail(customer);
          return email.kind === "usable" ? email.identity : undefined;
        };

        // An email two unlinked customers share, or that a customer linked
        // to another account has, names no single customer.
        const unlinkedIdentityCounts = new Map<string, number>();
        for (const { customerId } of unlinked) {
          const identity = usableIdentity(customerId);
          if (identity === undefined) continue;
          unlinkedIdentityCounts.set(
            identity,
            (unlinkedIdentityCounts.get(identity) ?? 0) + 1
          );
        }
        const linkedIdentities = new Set(
          links.linkedCustomerIds.flatMap(
            (customerId) => usableIdentity(customerId) ?? []
          )
        );

        const candidates = unlinked.flatMap((customer) => {
          const identity = usableIdentity(customer.customerId);
          return identity === undefined ? [] : [identity];
        });
        const logins = new Map(
          (yield* readLoginsByEmail(db, [...new Set(candidates)])).map(
            (login) => [login.emailIdentity, login] as const
          )
        );

        return customers.map((customer): AuthorPlan => {
          const link = links.resolve(customer.customerId);
          if (link.kind === "linked") {
            return { kind: "link", customer, accountId: link.accountId };
          }
          if (link.kind === "conflict")
            return refuse(customer, "link_conflict");

          const record = dotyposCustomers.get(customer.customerId);
          if (!record) return refuse(customer, "customer_not_found");
          if (record.deleted) return refuse(customer, "customer_deleted");
          if (isCustomerProfileExpired(record)) {
            return refuse(customer, "customer_expired");
          }
          const email = readCustomerEmail(record);
          if (email.kind === "refused") return refuse(customer, email.reason);
          if (
            (unlinkedIdentityCounts.get(email.identity) ?? 0) > 1 ||
            linkedIdentities.has(email.identity)
          ) {
            return refuse(customer, "email_duplicated");
          }

          const login = logins.get(email.identity);
          if (!login) {
            return {
              kind: "newLogin",
              customer,
              email: email.identity,
              locale: isLocale(customer.latestLocale)
                ? customer.latestLocale
                : defaultLocale,
            };
          }
          // An unverified, unlinked login with the email is one an
          // interrupted run created; anything else belongs to someone.
          return login.emailVerified || links.isAccountLinked(login.accountId)
            ? refuse(customer, "login_conflict")
            : { kind: "resumedLogin", customer, accountId: login.accountId };
        });
      });

      /**
       * Links a backfilled login and assigns the author in one transaction
       * under the account lock, after checking the plan still holds.
       */
      const applyAuthor = Effect.fn(function* (
        plan: Exclude<AuthorPlan, { readonly kind: "refused" }>
      ) {
        const { customerId } = plan.customer;
        const accountId =
          plan.kind === "newLogin"
            ? yield* unverifiedLogins.create({
                email: plan.email,
                locale: plan.locale,
              })
            : plan.accountId;
        return yield* db.transaction(
          Effect.fn(function* () {
            yield* lockAccount(accountId);
            const links = indexCustomerLinks(
              yield* readCustomerLinks(db, { customerId, accountId })
            );
            const link = links.resolve(customerId);
            const linked =
              link.kind === "linked"
                ? link.accountId === accountId
                : link.kind === "unlinked" &&
                  plan.kind !== "link" &&
                  !links.isAccountLinked(accountId) &&
                  (yield* linkBackfilledAccount(db, accountId, customerId));
            if (!linked) {
              return { kind: "refused", customer: plan.customer } as const;
            }
            yield* ensureCustomerAccount(db, accountId);
            const reservations = yield* assignAuthorlessReservations(
              db,
              customerId,
              accountId
            );
            return { kind: plan.kind, reservations } as const;
          })
        );
      });

      const backfillAuthors = Effect.fn(function* (dryRun: boolean) {
        const alreadyAuthored = yield* countAuthoredReservations(db);
        const plans = yield* planAuthors(yield* readAuthorlessCustomers(db));
        const refused = plans.flatMap((plan) =>
          plan.kind === "refused" ? [plan] : []
        );
        const ready = plans.flatMap((plan) =>
          plan.kind === "refused" ? [] : [plan]
        );
        const batch = dryRun ? ready : ready.slice(0, authorBatchSize);
        const results: readonly AuthorResult[] = dryRun
          ? batch.map((plan) => ({
              kind: plan.kind,
              reservations: plan.customer.reservations,
            }))
          : yield* Effect.forEach(batch, applyAuthor);
        const conflicts = results.flatMap((result) =>
          result.kind === "refused"
            ? [{ customer: result.customer, reason: "link_conflict" as const }]
            : []
        );
        return {
          alreadyAuthored,
          viaLink: sumAuthors(results, "link"),
          viaNewLogin: sumAuthors(results, "newLogin"),
          viaResumedLogin: sumAuthors(results, "resumedLogin"),
          refused: [...refused, ...conflicts]
            .map(({ customer, reason }) => ({
              dotyposCustomerId: customer.customerId,
              reason,
              reservations: customer.reservations,
            }))
            .sort((a, b) =>
              a.dotyposCustomerId.localeCompare(b.dotyposCustomerId)
            ),
          remainingCustomers: ready.length - batch.length,
        };
      });

      return {
        run: Effect.fn("CustomerAccountBackfill.run")(function* ({ dryRun }) {
          return yield* advisoryLock
            .withLock(
              backfillLockKey,
              Effect.gen(function* () {
                const logins = yield* backfillLoginAccounts(dryRun);
                const links = yield* backfillLinkRecords(dryRun);
                const tombstones = yield* backfillTombstones(dryRun);
                const authors = yield* backfillAuthors(dryRun);
                return { dryRun, logins, links, tombstones, authors };
              })
            )
            .pipe(Effect.mapError(CustomerAccountBackfillError.from));
        }),
      } satisfies ICustomerAccountBackfill;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        WorkspaceDatabaseAdvisoryLock.Default,
        WorkspaceDotyposLayer,
        UnverifiedLogins.Live
      )
    )
  );
}

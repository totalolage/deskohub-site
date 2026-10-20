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
  tombstoneOrphanedAccounts,
} from "./customer-account.repository";
import {
  type AuthorlessCustomer,
  assignAuthorlessReservations,
  type CustomerLink,
  countAuthoredReservations,
  countLoginsWithAccount,
  createAccounts,
  findLoginsWithoutAccount,
  findOrphanedAccounts,
  linkBackfilledAccount,
  readAuthorlessCustomers,
  readCustomerLinks,
  readLinkRecordStates,
  readLoginsByEmail,
  readLoginVerified,
} from "./customer-account-backfill.repository";
import { customerAccountLockKey } from "./customer-account-link.repository";
import {
  CustomerDotyposAdapter,
  isCustomerProfileExpired,
} from "./customer-dotypos-adapter.service";

type CustomerAccountBackfillRefusalReason =
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

/** Exact-email Dotypos searches one plan runs at a time. */
const emailSearchConcurrency = 4;

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
  | {
      readonly kind: "refused";
      readonly customer: AuthorlessCustomer;
      readonly reason: CustomerAccountBackfillRefusalReason;
    };

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
  return {
    kind: "usable",
    email,
    identity: toCustomerEmailIdentity(email),
  } as const;
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
   * whose data is ambiguous are refused and left as they are; a customer's
   * email is ambiguous when any other Dotypos customer has it.
   *
   * A run plans every step from the state before its first write. A dry run
   * reports that plan without writing; an applying request executes it,
   * gives at most {@link authorBatchSize} customers an author and reports
   * the rest as remaining, so the caller repeats it until none remain.
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
      const customerDotypos = yield* CustomerDotyposAdapter;
      const unverifiedLogins = yield* UnverifiedLogins;

      const lockAccount = (accountId: CustomerAccountId) =>
        db.execute(
          postgresAdvisoryTransactionLockStatement(
            customerAccountLockKey(accountId)
          )
        );

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

      /**
       * Whether `email` identifies the customer alone, by the exact-email
       * search a sign-in claim runs. Any other live customer with the
       * address, linked or not and with reservations or not, makes it
       * ambiguous.
       */
      const confirmEmail = (plan: AuthorPlan, email: string) =>
        customerDotypos.classifyExactEmailCustomers(email).pipe(
          Effect.map((match): AuthorPlan => {
            const refuse = (
              reason: CustomerAccountBackfillRefusalReason
            ): AuthorPlan => ({
              kind: "refused",
              customer: plan.customer,
              reason,
            });
            if (match.kind === "ambiguous") return refuse("email_duplicated");
            if (match.kind !== "matched") return refuse("customer_not_found");
            if (match.customerId !== plan.customer.customerId) {
              return refuse("email_duplicated");
            }
            return match.state === "expired"
              ? refuse("customer_expired")
              : plan;
          })
        );

      /**
       * Plans the authors of the state the run leaves once it has
       * tombstoned `tombstoned`. A plan that needs the customer's email
       * waits for its exact-email search, and the searches stop once
       * `limit` customers are ready; the customers they did not reach are
       * `unplanned`.
       */
      const planAuthors = Effect.fn(function* (input: {
        readonly customers: readonly AuthorlessCustomer[];
        readonly tombstoned: ReadonlySet<CustomerAccountId>;
        readonly limit: number;
      }) {
        // A tombstone clears the account's link column, and a login-less
        // account has no link rows because they cascade from its login.
        const links = indexCustomerLinks(
          (yield* readCustomerLinks(db)).filter(
            ({ accountId }) => !input.tombstoned.has(accountId)
          )
        );
        const refuse = (
          customer: AuthorlessCustomer,
          reason: CustomerAccountBackfillRefusalReason
        ): AuthorPlan => ({ kind: "refused", customer, reason });

        const unlinked = input.customers.filter(
          ({ customerId }) => links.resolve(customerId).kind === "unlinked"
        );
        const dotyposCustomers = new Map(
          (yield* readInIdFilterBatches(
            unlinked.map(({ customerId }) => customerId),
            (ids) => dotypos.getCustomers({ ids }),
            { concurrency: 2 }
          ))
            .flat()
            .flatMap((customer) =>
              customer.id ? [[customer.id, customer] as const] : []
            )
        );
        const readUsableEmail = (customerId: DotyposCustomerId) => {
          const record = dotyposCustomers.get(customerId);
          if (!record) {
            return { kind: "refused", reason: "customer_not_found" } as const;
          }
          if (record.deleted) {
            return { kind: "refused", reason: "customer_deleted" } as const;
          }
          if (isCustomerProfileExpired(record)) {
            return { kind: "refused", reason: "customer_expired" } as const;
          }
          return readCustomerEmail(record);
        };

        const candidates = unlinked.flatMap(({ customerId }) => {
          const email = readUsableEmail(customerId);
          return email.kind === "usable" ? [email.identity] : [];
        });
        const logins = new Map(
          (yield* readLoginsByEmail(db, [...new Set(candidates)])).map(
            (login) => [login.emailIdentity, login] as const
          )
        );

        const drafts = input.customers.map(
          (
            customer
          ): { readonly plan: AuthorPlan; readonly email?: string } => {
            const link = links.resolve(customer.customerId);
            if (link.kind === "linked") {
              return {
                plan: { kind: "link", customer, accountId: link.accountId },
              };
            }
            if (link.kind === "conflict") {
              return { plan: refuse(customer, "link_conflict") };
            }
            const email = readUsableEmail(customer.customerId);
            if (email.kind === "refused") {
              return { plan: refuse(customer, email.reason) };
            }
            const login = logins.get(email.identity);
            if (!login) {
              return {
                plan: {
                  kind: "newLogin",
                  customer,
                  email: email.identity,
                  locale: isLocale(customer.latestLocale)
                    ? customer.latestLocale
                    : defaultLocale,
                },
                email: email.email,
              };
            }
            // An unverified, unlinked login with the email is one an
            // interrupted run created; anything else belongs to someone.
            return login.emailVerified || links.isAccountLinked(login.accountId)
              ? { plan: refuse(customer, "login_conflict") }
              : {
                  plan: {
                    kind: "resumedLogin",
                    customer,
                    accountId: login.accountId,
                  },
                  email: email.email,
                };
          }
        );

        const awaitingEmail = drafts.flatMap(({ email }, index) =>
          email === undefined ? [] : [{ index, email }]
        );
        const isReady = (plan: AuthorPlan) => plan.kind !== "refused";
        // Searches the next customers that could still fill the batch, until
        // it is full or no customer awaits a search.
        const searchEmails = (
          pending: typeof awaitingEmail,
          ready: number,
          confirmed: ReadonlyMap<number, AuthorPlan>
        ): Effect.Effect<
          {
            readonly confirmed: ReadonlyMap<number, AuthorPlan>;
            readonly unplanned: number;
          },
          Effect.Error<ReturnType<typeof confirmEmail>>
        > => {
          const window = pending.slice(0, Math.max(input.limit - ready, 0));
          if (window.length === 0) {
            return Effect.succeed({ confirmed, unplanned: pending.length });
          }
          return Effect.forEach(
            window,
            ({ index, email }) =>
              confirmEmail(drafts[index]!.plan, email).pipe(
                Effect.map((plan) => [index, plan] as const)
              ),
            { concurrency: emailSearchConcurrency }
          ).pipe(
            Effect.flatMap((searched) =>
              searchEmails(
                pending.slice(window.length),
                ready + searched.filter(([, plan]) => isReady(plan)).length,
                new Map([...confirmed, ...searched])
              )
            )
          );
        };
        const searched = yield* searchEmails(
          awaitingEmail,
          drafts.filter(
            ({ plan, email }) => email === undefined && isReady(plan)
          ).length,
          new Map()
        );
        return {
          plans: drafts.flatMap(({ plan, email }, index) => {
            if (email === undefined) return [plan];
            const confirmed = searched.confirmed.get(index);
            return confirmed ? [confirmed] : [];
          }),
          unplanned: searched.unplanned,
        };
      });

      /**
       * Everything one run would change, read before it changes anything.
       * A dry run reports the plan and an applying run executes it, so both
       * plan from the same state; only changes made between the two runs, or
       * concurrently with the applying one, change the outcome.
       */
      const planBackfill = Effect.fn(function* (authorLimit: number) {
        const missingLogins = yield* findLoginsWithoutAccount(db);
        const presentLogins = yield* countLoginsWithAccount(db);
        const linkStates = yield* readLinkRecordStates(db);
        const orphans = yield* findOrphanedAccounts(db);
        const alreadyAuthored = yield* countAuthoredReservations(db);
        const authors = yield* planAuthors({
          customers: yield* readAuthorlessCustomers(db),
          tombstoned: new Set(orphans.settled),
          limit: authorLimit,
        });
        return {
          missingLogins,
          presentLogins,
          linkStates,
          orphans,
          alreadyAuthored,
          authors,
        };
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
            const refuse = (reason: CustomerAccountBackfillRefusalReason) =>
              ({ kind: "refused", customer: plan.customer, reason }) as const;
            // A resumed login is someone's once its owner verifies it.
            if (
              plan.kind === "resumedLogin" &&
              (yield* readLoginVerified(db, accountId)) !== false
            ) {
              return refuse("login_conflict");
            }
            const link = links.resolve(customerId);
            const linked =
              link.kind === "linked"
                ? link.accountId === accountId
                : link.kind === "unlinked" &&
                  plan.kind !== "link" &&
                  !links.isAccountLinked(accountId) &&
                  (yield* linkBackfilledAccount(db, accountId, customerId));
            if (!linked) return refuse("link_conflict");
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

      const countOf = <A extends string>(items: readonly string[], value: A) =>
        items.filter((item) => item === value).length;

      /**
       * Executes the plan; a dry run instead takes each planned step as
       * done. The writes recheck what they change, so a step can still find
       * a link gone or a customer claimed in the meantime.
       */
      const execute = Effect.fn(function* (
        plan: Effect.Success<ReturnType<typeof planBackfill>>,
        dryRun: boolean
      ) {
        const createdLogins = dryRun
          ? plan.missingLogins.length
          : yield* createAccounts(db, plan.missingLogins);

        const pendingLinks = plan.linkStates.filter(
          ({ state }) => state === "pending"
        );
        const linkOutcomes = dryRun
          ? pendingLinks.map(() => "recorded" as const)
          : yield* Effect.forEach(pendingLinks, recordLink);
        const linkStateNames = plan.linkStates.map(({ state }) =>
          state === "recorded" ? "alreadyRecorded" : state
        );

        const tombstoned = dryRun
          ? plan.orphans.settled.length
          : yield* tombstoneOrphanedAccounts(db, {
              accountIds: plan.orphans.settled,
            });

        const refused = plan.authors.plans.flatMap((author) =>
          author.kind === "refused" ? [author] : []
        );
        const ready = plan.authors.plans.flatMap((author) =>
          author.kind === "refused" ? [] : [author]
        );
        const batch = dryRun ? ready : ready.slice(0, authorBatchSize);
        const results: readonly AuthorResult[] = dryRun
          ? batch.map((author) => ({
              kind: author.kind,
              reservations: author.customer.reservations,
            }))
          : yield* Effect.forEach(batch, applyAuthor);
        const conflicts = results.flatMap((result) =>
          result.kind === "refused" ? [result] : []
        );

        return {
          dryRun,
          logins: {
            created: createdLogins,
            alreadyPresent: plan.presentLogins,
          },
          links: {
            recorded: countOf(linkOutcomes, "recorded"),
            alreadyRecorded:
              countOf(linkStateNames, "alreadyRecorded") +
              countOf(linkOutcomes, "alreadyRecorded"),
            conflicts:
              countOf(linkStateNames, "conflict") +
              countOf(linkOutcomes, "conflict"),
          },
          tombstones: {
            recorded: tombstoned,
            alreadyDeleted: plan.orphans.alreadyDeleted,
            skippedRecent: plan.orphans.recent,
          },
          authors: {
            alreadyAuthored: plan.alreadyAuthored,
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
            remainingCustomers:
              ready.length - batch.length + plan.authors.unplanned,
          },
        } satisfies CustomerAccountBackfillReport;
      });

      return {
        run: Effect.fn("CustomerAccountBackfill.run")(function* ({ dryRun }) {
          return yield* advisoryLock
            .withLock(
              backfillLockKey,
              Effect.gen(function* () {
                const plan = yield* planBackfill(
                  dryRun ? Number.POSITIVE_INFINITY : authorBatchSize
                );
                return yield* execute(plan, dryRun);
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
        CustomerDotyposAdapter.Live,
        UnverifiedLogins.Live
      )
    )
  );
}

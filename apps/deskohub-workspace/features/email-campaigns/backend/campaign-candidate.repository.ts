import "server-only";

import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import type { ReservationProductFilterType } from "@deskohub/workspace-admin-api";
import {
  and,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  max,
  min,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import {
  customerAccountLinks,
  customerAccounts,
  customerMarketingConsents,
  emailCampaignAutomationVersions,
  emailCampaignDeliveryBatches,
  emailCampaignRecipients,
  emailCampaignSends,
  emailCampaigns,
  workspaceReservations,
} from "@/db/schema";
import { authUser } from "@/db/schema/auth";
import { linkedDotyposCustomerId } from "@/features/account/backend/customer-account-dotypos-link";
import type { AdministrationReservationStatusFilter } from "@/features/administration/administration.service";
import {
  bookedReservationCondition,
  reservationStatusCondition,
} from "@/features/administration/reservation-status-condition";
import { temporalInstantToDate } from "@/shared/utils/temporal";
import type { AudienceDateFacts } from "../audience-filter";
import type { CampaignPurpose } from "../body/campaign-content";
import type { CampaignId } from "../campaign-identifiers";
import type { DatePeriodBounds } from "../date-period";
import { sendAutomationVersion, sendPurpose } from "./campaign-send-selection";
import { reservationProductCondition } from "./reservation-product-condition";

/** What Workspace stores about one customer it knows. */
export type CampaignCandidateFacts = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly hasAccount: boolean;
  readonly accountLocale: string | null;
  readonly latestReservationLocale: string | null;
  readonly latestReservationAt: Temporal.Instant | null;
  readonly consentLocale: string | null;
};

/**
 * Which Workspace reservations a reservation count includes. Each field adds
 * one SQL condition in {@link reservationSelection}; a new reservation
 * property filter slots in the same way.
 */
export type CampaignReservationSelection = {
  /** Admin status group; without one, only booked reservations count. */
  readonly status?: AdministrationReservationStatusFilter;
  /** Booking (confirmation) instant bounds. */
  readonly booked?: DatePeriodBounds;
  /**
   * Only reservations that existed by then. Without a status, a reservation
   * counts as booked from its confirmation; a status group is the current
   * one, so with a status it counts from its creation.
   */
  readonly existedBy?: Temporal.Instant;
  /** Limits the count to these Dotypos reservations (visit-date periods). */
  readonly dotyposReservationIds?: readonly DotyposReservationId[];
  /** Limits the count to one product family and its catalog properties. */
  readonly product?: ReservationProductFilterType;
  /** Limits the count to these customers' reservations. */
  readonly customers?: readonly DotyposCustomerId[];
};

/** A booked reservation's Dotypos ID and customer. */
export type CampaignBookedReservation = {
  readonly dotyposReservationId: DotyposReservationId;
  readonly dotyposCustomerId: DotyposCustomerId;
};

/**
 * Recipient statuses that mean Resend accepted the email for the customer.
 * `unconfirmed` counts too: the email may well have gone out.
 */
const receivedCampaignEmailStatuses = [
  "sent",
  "delivered",
  "complained",
  "unconfirmed",
] as const;

/**
 * The joined login is verified. The account backfill creates unverified
 * logins for legacy customers silently; they count as accounts only once
 * their owner signs in.
 */
const verifiedLogin = eq(authUser.emailVerified, true);

/** The linked customer of an account, where the query keeps linked accounts only. */
const accountCustomerId = sql<DotyposCustomerId>`${linkedDotyposCustomerId}`;

/** A customer column among the customers, when the query is limited to some. */
const ofCustomers = (
  column: SQLWrapper,
  customers: readonly DotyposCustomerId[] | undefined
): SQL | undefined => customers && inArray(column, [...customers]);

/** An instant column or expression within the bounds; open bounds add nothing. */
const withinBounds = (
  instant: SQLWrapper,
  bounds: DatePeriodBounds
): SQL | undefined =>
  and(
    bounds.startsAtOrAfter &&
      sql`${instant} >= ${temporalInstantToDate(bounds.startsAtOrAfter)}`,
    bounds.startsBefore &&
      sql`${instant} < ${temporalInstantToDate(bounds.startsBefore)}`,
    bounds.startsAtOrBefore &&
      sql`${instant} <= ${temporalInstantToDate(bounds.startsAtOrBefore)}`
  );

const reservationSelection = ({
  status,
  booked,
  existedBy,
  dotyposReservationIds,
  product,
  customers,
}: CampaignReservationSelection): SQL | undefined =>
  and(
    ofCustomers(workspaceReservations.dotyposCustomerId, customers),
    product && reservationProductCondition(product),
    status ? reservationStatusCondition(status) : bookedReservationCondition,
    booked &&
      withinBounds(workspaceReservations.reservationConfirmedAt, booked),
    existedBy &&
      sql`${
        status
          ? workspaceReservations.createdAt
          : workspaceReservations.reservationConfirmedAt
      } <= ${temporalInstantToDate(existedBy)}`,
    dotyposReservationIds &&
      inArray(workspaceReservations.dotyposReservationId, [
        ...dotyposReservationIds,
      ])
  );

export interface ICampaignCandidateRepository {
  /**
   * The customers Workspace knows: everyone with a reservation, a linked
   * account, or a marketing consent row. Marketing campaigns reach only
   * customers whose consent is active. With `ids`, only those of them.
   */
  readonly listCandidates: (input: {
    readonly purpose: CampaignPurpose;
    readonly ids?: readonly DotyposCustomerId[];
  }) => Effect.Effect<
    readonly CampaignCandidateFacts[],
    EffectDrizzleQueryError
  >;
  /**
   * Reservations per customer among those the selection includes. Customers
   * without any are absent. Booking-date bounds apply to the confirmation
   * instant, so reservations that never confirmed fall outside every
   * booking-date period.
   */
  readonly countReservations: (
    selection: CampaignReservationSelection
  ) => Effect.Effect<
    ReadonlyMap<DotyposCustomerId, number>,
    EffectDrizzleQueryError
  >;
  /**
   * Campaign emails Resend accepted per customer, dated by the first request
   * of the batch that carried them. Customers without any are absent.
   */
  readonly countReceivedCampaignEmails: (query: {
    /**
     * Without a purpose every campaign counts. An automated send counts under
     * the purpose its version pinned.
     */
    readonly purpose?: CampaignPurpose;
    /** Only this campaign's emails count. */
    readonly campaignId?: CampaignId;
    readonly dispatched: DatePeriodBounds;
    readonly customers?: readonly DotyposCustomerId[];
  }) => Effect.Effect<
    ReadonlyMap<DotyposCustomerId, number>,
    EffectDrizzleQueryError
  >;
  /** Customers with a linked account, and those whose account was created in the bounds. */
  readonly accountCreations: (
    created: DatePeriodBounds,
    customers?: readonly DotyposCustomerId[]
  ) => Effect.Effect<AudienceDateFacts, EffectDrizzleQueryError>;
  /**
   * When the earliest Workspace reservation was created, if there is one. No
   * Workspace reservation starts long before it, so it bounds visit queries.
   */
  readonly earliestReservationAt: Effect.Effect<
    Temporal.Instant | null,
    EffectDrizzleQueryError
  >;
  /** The booked reservations among these Dotypos reservations, of the product and customers, and existing by the instant, if given. */
  readonly listBookedReservations: (
    dotyposReservationIds: readonly DotyposReservationId[],
    selection?: Pick<
      CampaignReservationSelection,
      "product" | "existedBy" | "customers"
    >
  ) => Effect.Effect<
    readonly CampaignBookedReservation[],
    EffectDrizzleQueryError
  >;
}

export class CampaignCandidateRepository extends Context.Service<
  CampaignCandidateRepository,
  ICampaignCandidateRepository
>()("@deskohub-workspace/email-campaigns/CampaignCandidateRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const latestReservations = (customers?: readonly DotyposCustomerId[]) =>
        db
          .select({
            dotyposCustomerId: workspaceReservations.dotyposCustomerId,
            locale: sql<string>`(array_agg(${workspaceReservations.locale} order by ${workspaceReservations.createdAt} desc))[1]`,
            createdAt: max(workspaceReservations.createdAt),
          })
          .from(workspaceReservations)
          .where(
            ofCustomers(workspaceReservations.dotyposCustomerId, customers)
          )
          .groupBy(workspaceReservations.dotyposCustomerId);

      const accounts = (customers?: readonly DotyposCustomerId[]) =>
        db
          .select({
            dotyposCustomerId: accountCustomerId,
            locale: authUser.locale,
          })
          .from(authUser)
          .leftJoin(customerAccounts, eq(customerAccounts.id, authUser.id))
          .leftJoin(
            customerAccountLinks,
            eq(customerAccountLinks.customerAccountId, authUser.id)
          )
          .where(
            and(
              verifiedLogin,
              isNotNull(linkedDotyposCustomerId),
              ofCustomers(linkedDotyposCustomerId, customers)
            )
          );

      const consents = (customers?: readonly DotyposCustomerId[]) =>
        db
          .select({
            dotyposCustomerId: customerMarketingConsents.dotyposCustomerId,
            locale: customerMarketingConsents.locale,
            active: sql<boolean>`${customerMarketingConsents.withdrawnAt} is null`,
          })
          .from(customerMarketingConsents)
          .where(
            ofCustomers(customerMarketingConsents.dotyposCustomerId, customers)
          );

      return {
        listCandidates: Effect.fn("CampaignCandidateRepository.listCandidates")(
          function* ({ purpose, ids }) {
            const [reservationRows, accountRows, consentRows] =
              yield* Effect.all(
                [latestReservations(ids), accounts(ids), consents(ids)],
                { concurrency: "inherit" }
              );
            const reservationsById = new Map(
              reservationRows.map((row) => [row.dotyposCustomerId, row])
            );
            const accountsById = new Map(
              accountRows.map((row) => [row.dotyposCustomerId, row])
            );
            const consentsById = new Map(
              consentRows.map((row) => [row.dotyposCustomerId, row])
            );
            const pool =
              purpose === "marketing"
                ? consentRows
                    .filter(({ active }) => active)
                    .map(({ dotyposCustomerId }) => dotyposCustomerId)
                : [
                    ...new Set([
                      ...reservationsById.keys(),
                      ...accountsById.keys(),
                      ...consentsById.keys(),
                    ]),
                  ];

            return pool.map((dotyposCustomerId): CampaignCandidateFacts => {
              const reservation = reservationsById.get(dotyposCustomerId);
              const account = accountsById.get(dotyposCustomerId);
              return {
                dotyposCustomerId,
                hasAccount: account !== undefined,
                accountLocale: account?.locale ?? null,
                latestReservationLocale: reservation?.locale ?? null,
                latestReservationAt: reservation?.createdAt ?? null,
                consentLocale:
                  consentsById.get(dotyposCustomerId)?.locale ?? null,
              };
            });
          }
        ),
        countReservations: Effect.fn(
          "CampaignCandidateRepository.countReservations"
        )(function* (selection) {
          if (selection.dotyposReservationIds?.length === 0) {
            return new Map<DotyposCustomerId, number>();
          }
          const rows = yield* db
            .select({
              dotyposCustomerId: workspaceReservations.dotyposCustomerId,
              count: count(),
            })
            .from(workspaceReservations)
            .where(reservationSelection(selection))
            .groupBy(workspaceReservations.dotyposCustomerId);
          return new Map(
            rows.map((row) => [row.dotyposCustomerId, row.count] as const)
          );
        }),
        countReceivedCampaignEmails: Effect.fn(
          "CampaignCandidateRepository.countReceivedCampaignEmails"
        )(function* ({ purpose, campaignId, dispatched, customers }) {
          // A recipient a webhook settled without a batch in its current
          // attempt is dated by its status change instead.
          const dispatchedAt = sql`coalesce(${emailCampaignDeliveryBatches.requestedAt}, ${emailCampaignRecipients.statusUpdatedAt})`;
          const rows = yield* db
            .select({
              dotyposCustomerId: emailCampaignRecipients.dotyposCustomerId,
              count: count(),
            })
            .from(emailCampaignRecipients)
            .innerJoin(
              emailCampaignSends,
              eq(emailCampaignSends.id, emailCampaignRecipients.sendId)
            )
            .innerJoin(
              emailCampaigns,
              eq(emailCampaigns.id, emailCampaignSends.campaignId)
            )
            .leftJoin(emailCampaignAutomationVersions, sendAutomationVersion)
            .leftJoin(
              emailCampaignDeliveryBatches,
              and(
                eq(
                  emailCampaignDeliveryBatches.sendId,
                  emailCampaignRecipients.sendId
                ),
                eq(
                  emailCampaignDeliveryBatches.deliveryAttempt,
                  emailCampaignRecipients.deliveryAttempt
                ),
                sql`${emailCampaignRecipients.dotyposCustomerId} = any(${emailCampaignDeliveryBatches.dotyposCustomerIds})`
              )
            )
            .where(
              and(
                inArray(emailCampaignRecipients.status, [
                  ...receivedCampaignEmailStatuses,
                ]),
                purpose && eq(sendPurpose, purpose),
                campaignId && eq(emailCampaignSends.campaignId, campaignId),
                ofCustomers(
                  emailCampaignRecipients.dotyposCustomerId,
                  customers
                ),
                withinBounds(dispatchedAt, dispatched)
              )
            )
            .groupBy(emailCampaignRecipients.dotyposCustomerId);
          return new Map(
            rows.map((row) => [row.dotyposCustomerId, row.count] as const)
          );
        }),
        accountCreations: Effect.fn(
          "CampaignCandidateRepository.accountCreations"
        )(function* (created, customers) {
          const rows = yield* db
            .select({
              dotyposCustomerId: accountCustomerId,
              inPeriod: sql<boolean>`${and(
                sql`true`,
                withinBounds(authUser.createdAt, created)
              )}`,
            })
            .from(authUser)
            .leftJoin(customerAccounts, eq(customerAccounts.id, authUser.id))
            .leftJoin(
              customerAccountLinks,
              eq(customerAccountLinks.customerAccountId, authUser.id)
            )
            .where(
              and(
                verifiedLogin,
                isNotNull(linkedDotyposCustomerId),
                ofCustomers(linkedDotyposCustomerId, customers)
              )
            );
          return {
            withValue: new Set(rows.map((row) => row.dotyposCustomerId)),
            inPeriod: new Set(
              rows.flatMap((row) =>
                row.inPeriod ? [row.dotyposCustomerId] : []
              )
            ),
          };
        }),
        earliestReservationAt: db
          .select({ createdAt: min(workspaceReservations.createdAt) })
          .from(workspaceReservations)
          .pipe(Effect.map(([row]) => row?.createdAt ?? null)),
        listBookedReservations: Effect.fn(
          "CampaignCandidateRepository.listBookedReservations"
        )(function* (dotyposReservationIds, selection) {
          if (dotyposReservationIds.length === 0) return [];
          const rows = yield* db
            .select({
              dotyposReservationId: workspaceReservations.dotyposReservationId,
              dotyposCustomerId: workspaceReservations.dotyposCustomerId,
            })
            .from(workspaceReservations)
            .where(
              reservationSelection({ ...selection, dotyposReservationIds })
            );
          return rows.flatMap(({ dotyposReservationId, dotyposCustomerId }) =>
            dotyposReservationId === null
              ? []
              : [{ dotyposReservationId, dotyposCustomerId }]
          );
        }),
      } satisfies ICampaignCandidateRepository;
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}

/**
 * The ids of the customers `listCandidates` returns for the purpose, in id
 * order: a schedule fire's pool (§5.7). It runs on the caller's database
 * or transaction, so the pool is read in the transaction that creates the
 * fire.
 */
export const listCampaignCandidateIds = Effect.fn("listCampaignCandidateIds")(
  function* (
    db: Pick<WorkspaceDatabaseClient, "select" | "selectDistinct">,
    purpose: CampaignPurpose
  ) {
    const consents = db
      .select({
        dotyposCustomerId: customerMarketingConsents.dotyposCustomerId,
      })
      .from(customerMarketingConsents);
    if (purpose === "marketing") {
      const active = yield* consents.where(
        isNull(customerMarketingConsents.withdrawnAt)
      );
      return sortedCustomerIds(active);
    }
    const [reservations, accounts, all] = yield* Effect.all([
      db
        .selectDistinct({
          dotyposCustomerId: workspaceReservations.dotyposCustomerId,
        })
        .from(workspaceReservations),
      db
        .select({ dotyposCustomerId: customerAccountLinks.dotyposCustomerId })
        .from(customerAccountLinks),
      consents,
    ]);
    return sortedCustomerIds([...reservations, ...accounts, ...all]);
  }
);

const sortedCustomerIds = (
  rows: readonly { readonly dotyposCustomerId: DotyposCustomerId }[]
): readonly DotyposCustomerId[] =>
  [...new Set(rows.map(({ dotyposCustomerId }) => dotyposCustomerId))].sort();

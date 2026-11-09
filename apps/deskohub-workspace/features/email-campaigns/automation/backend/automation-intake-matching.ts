import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { Effect, Option } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import {
  emailCampaignAutomations as automations,
  customerEvents,
  emailCampaigns,
  workspaceReservations,
} from "@/db/schema";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type {
  CustomerEventId,
  CustomerEventKind,
} from "@/shared/backend/customer-events/customer-event";
import { canonicalJson } from "@/shared/utils/canonical-json";
import { reservationProductCondition } from "../../backend/reservation-product-condition";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationVersionId } from "../automation-identifiers";
import { automationTriggerKind } from "../automation-triggers";
import {
  type AutomationVersionActivation,
  versionInForce,
} from "../automation-versions";
import { takenReceiptKeys } from "./automation-run-entry";
import { triggeringCustomerEvent } from "./automation-triggering-events";

import { loadAutomationVersionActivations } from "./automation-version-activations";

/** A recorded customer event as intake reads it. */
export type IntakeEvent = {
  readonly id: CustomerEventId;
  readonly kind: CustomerEventKind;
  readonly occurredAt: Temporal.Instant;
  readonly recordedAt: Temporal.Instant;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly workspaceReservationId: WorkspaceReservationId | null;
  readonly customerAccountId: CustomerAccountId | null;
  /** False for an event no automation takes in (`triggeringCustomerEvent`). */
  readonly triggering: boolean;
};

/** The columns `IntakeEvent` reads. */
export const intakeEventColumns = {
  id: customerEvents.id,
  kind: customerEvents.kind,
  occurredAt: customerEvents.occurredAt,
  recordedAt: customerEvents.recordedAt,
  dotyposCustomerId: customerEvents.dotyposCustomerId,
  workspaceReservationId: customerEvents.workspaceReservationId,
  customerAccountId: customerEvents.customerAccountId,
  triggering: triggeringCustomerEvent,
};

/** One event an automation's version in force at its occurrence takes. */
export type IntakeMatch = {
  readonly event: IntakeEvent;
  readonly campaignId: CampaignId;
  readonly versionId: AutomationVersionId;
  /** The receipt key: at most one receipt per reservation or account (D31.7). */
  readonly dedupKey: string;
};

/** An automation accepting events, with every version it published. */
type AcceptingAutomation = {
  readonly campaignId: CampaignId;
  readonly acceptingSince: Temporal.Instant;
  readonly versions: readonly AutomationVersionActivation[];
};

/**
 * The receipt key of an event: one per reservation and kind, or per
 * account, across versions (§1.2.7).
 */
const intakeDedupKey = (event: IntakeEvent) =>
  `${event.kind}:${event.workspaceReservationId ?? event.customerAccountId ?? event.id}`;

/**
 * Matches events to the active automations that take them (§5.6): the
 * event can trigger at all (D37), the version in force at the occurrence
 * has a trigger of the event's kind, the event occurred at or after
 * `accepting_since` (D21, D12), the receipt key is free, and the trigger's
 * product filter holds on the reservation.
 * Reads only; the caller's transaction gives it one snapshot.
 */
export const matchIntakeEvents = Effect.fn("automationIntake.match")(function* (
  events: readonly IntakeEvent[]
) {
  if (events.length === 0) return [];
  const accepting = yield* acceptingAutomations();
  const triggering = events.filter((event) => event.triggering);

  const candidates = accepting.flatMap((automation) =>
    triggering.flatMap((event) =>
      Option.match(versionInForce(automation.versions, event.occurredAt), {
        onNone: () => [],
        onSome: (version) =>
          automationTriggerKind(version.trigger) === event.kind &&
          Temporal.Instant.compare(
            event.occurredAt,
            automation.acceptingSince
          ) >= 0
            ? [{ event, automation, version }]
            : [],
      })
    )
  );

  const productMatches = yield* reservationsOfProducts(
    candidates.flatMap(({ event, version }) =>
      "product" in version.trigger &&
      version.trigger.product !== undefined &&
      event.workspaceReservationId !== null
        ? [
            {
              product: version.trigger.product,
              reservationId: event.workspaceReservationId,
            },
          ]
        : []
    )
  );
  const productHolds = (candidate: (typeof candidates)[number]) => {
    const { trigger } = candidate.version;
    if (!("product" in trigger) || trigger.product === undefined) {
      return true;
    }
    const reservationId = candidate.event.workspaceReservationId;
    return (
      reservationId !== null &&
      productMatches.has(productKey(trigger.product, reservationId))
    );
  };

  const matches = candidates.filter(productHolds).map(
    ({ event, automation, version }): IntakeMatch => ({
      event,
      campaignId: automation.campaignId,
      versionId: version.id,
      dedupKey: intakeDedupKey(event),
    })
  );
  const taken = yield* Effect.forEach(
    Map.groupBy(matches, ({ campaignId }) => campaignId),
    ([campaignId, ofCampaign]) =>
      takenReceiptKeys(
        campaignId,
        ofCampaign.map(({ dedupKey }) => dedupKey)
      ).pipe(
        Effect.map((keys) => [...keys].map((key) => receiptOf(campaignId, key)))
      )
  ).pipe(Effect.map((keys) => new Set(keys.flat())));
  return matches.filter(
    ({ campaignId, dedupKey }) => !taken.has(receiptOf(campaignId, dedupKey))
  );
});

const receiptOf = (campaignId: CampaignId, dedupKey: string) =>
  `${campaignId}\u0000${dedupKey}`;

/** Active automations accepting events, each with its versions. */
const acceptingAutomations = () =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .select({
        campaignId: automations.campaignId,
        acceptingSince: automations.acceptingSince,
      })
      .from(automations)
      .innerJoin(emailCampaigns, eq(emailCampaigns.id, automations.campaignId))
      .where(
        and(
          eq(emailCampaigns.status, "active"),
          isNotNull(automations.acceptingSince)
        )
      )
      .orderBy(asc(automations.campaignId))
      .pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(rows, ({ campaignId, acceptingSince }) =>
            loadAutomationVersionActivations(campaignId).pipe(
              Effect.map(
                (versions): AcceptingAutomation => ({
                  campaignId,
                  // Filtered on non-null above.
                  acceptingSince: acceptingSince!,
                  versions,
                })
              )
            )
          )
        )
      )
  );

type ProductFilter = NonNullable<
  Extract<
    AutomationVersionActivation["trigger"],
    { readonly product?: unknown }
  >["product"]
>;

const productKey = (
  product: ProductFilter,
  reservationId: WorkspaceReservationId
) => `${canonicalJson(product)}\u0000${reservationId}`;

/** The (product filter, reservation) pairs whose reservation is of the product, in SQL. */
const reservationsOfProducts = (
  pairs: readonly {
    readonly product: ProductFilter;
    readonly reservationId: WorkspaceReservationId;
  }[]
) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    Effect.forEach(
      Map.groupBy(pairs, ({ product }) => canonicalJson(product)),
      ([, group]) =>
        db
          .select({ id: workspaceReservations.id })
          .from(workspaceReservations)
          .where(
            and(
              inArray(workspaceReservations.id, [
                ...new Set(group.map(({ reservationId }) => reservationId)),
              ]),
              reservationProductCondition(group[0]!.product)
            )
          )
          .pipe(
            Effect.map((rows) =>
              rows.map(({ id }) => productKey(group[0]!.product, id))
            )
          )
    ).pipe(Effect.map((keys) => new Set(keys.flat())))
  );

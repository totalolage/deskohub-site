import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { makeInMemoryDotypos } from "@deskohub/dotypos/testing";
import { Effect, Layer, Option } from "effect";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { createWorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AudienceFilter } from "../audience-filter";
import { campaignIdSchema } from "../campaign-identifiers";
import { evaluateAudienceFilter } from "./audience-evaluation";
import {
  AudienceFactSource,
  AudienceScope,
  audienceEvaluationAt,
} from "./audience-evaluation-context";
import { AudienceFactsService } from "./audience-facts.service";
import { CampaignCandidateRepository } from "./campaign-candidate.repository";

const database =
  await createWorkspacePostgresSuiteDatabase("return_conditions");
afterAll(() => database?.close());
const at = (value: string) => Temporal.Instant.from(value);
const now = at("2026-10-15T08:00:00Z");
const customer = DotyposCustomerIdSchema.make(`return-${crypto.randomUUID()}`);
const campaign = campaignIdSchema.make(crypto.randomUUID());
const otherCampaign = campaignIdSchema.make(crypto.randomUUID());

/** Ordinary conditions reused by the first- and second-visit offers. */
const offer = (count: number, status?: "cancelled"): AudienceFilter => ({
  _tag: "Group",
  operator: "and",
  filters: [
    {
      attribute: "reservationCount",
      _tag: "Condition",
      params: {
        dateBasis: "visitEnd",
        period: { _tag: "Past" },
        product: { family: "cowork", properties: [] },
        ...(status && { status }),
      },
      operator: "eq",
      value: count,
    },
    {
      attribute: "campaignEmailCount",
      _tag: "Condition",
      params: {
        purpose: "any",
        campaign: { _tag: "This" },
        period: { _tag: "Past" },
      },
      operator: "eq",
      value: 0,
    },
  ],
});

describe.skipIf(!database)(
  "ordinary coworking return conditions on Postgres",
  () => {
    test("counts full-history completions at condition time and this campaign's accepted or uncertain emails", async () => {
      if (!database) return;
      const fixtures = workspaceFixtures(database.db);
      const visits = [
        // The first visit is deliberately older than 30 days.
        {
          name: "first",
          start: "2026-06-01T08:00:00Z",
          end: "2026-06-01T09:00:00Z",
        },
        {
          name: "second",
          start: "2026-10-15T07:00:00Z",
          end: "2026-10-15T09:00:00Z",
        },
        {
          name: "third",
          start: "2026-10-16T07:00:00Z",
          end: "2026-10-16T09:00:00Z",
        },
        {
          name: "local-cancel",
          start: "2026-09-01T07:00:00Z",
          end: "2026-09-01T09:00:00Z",
        },
        {
          name: "provider-cancel",
          start: "2026-09-02T07:00:00Z",
          end: "2026-09-02T09:00:00Z",
        },
        {
          name: "room",
          start: "2026-09-03T07:00:00Z",
          end: "2026-09-03T09:00:00Z",
        },
        // A Dotypos reservation without a Workspace booking never counts.
        {
          name: "external",
          start: "2026-09-04T07:00:00Z",
          end: "2026-09-04T09:00:00Z",
        },
      ].map((visit) => ({
        ...visit,
        id: DotyposReservationIdSchema.make(`return-${visit.name}-${campaign}`),
      }));
      await Effect.runPromise(
        fixtures.reservations(
          visits
            .filter(({ name }) => name !== "external")
            .map(({ name, id }) => ({
              customer,
              locale: "cs-CZ" as const,
              at: at("2026-05-01T00:00:00Z"),
              details:
                name === "room"
                  ? { kind: "meeting-room" as const, earlySetup: false }
                  : {
                      kind: "cowork" as const,
                      entryTier: "open-space" as const,
                      coffee: false,
                    },
              stage:
                name === "local-cancel"
                  ? {
                      reservation: "cancelled" as const,
                      payment: "paid" as const,
                    }
                  : {
                      reservation: "confirmed" as const,
                      payment: "paid" as const,
                      fulfillment: "fulfilled" as const,
                    },
              overrides: {
                createdAt: at("2026-05-01T00:00:00Z"),
                dotyposReservationId: id,
                reservationConfirmedAt: at("2026-05-01T00:00:00Z"),
              },
            }))
        )
      );
      const layer = AudienceFactsService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            CampaignCandidateRepository.Default.pipe(
              Layer.provide(database.layer)
            ),
            DotyposServiceMock(
              makeInMemoryDotypos({
                reservations: visits.map(({ id, name, start, end }) => ({
                  id,
                  startDate: start,
                  endDate: end,
                  status:
                    name === "provider-cancel"
                      ? ("CANCELLED" as const)
                      : ("NEW" as const),
                })),
              }).service
            )
          )
        )
      );
      const evaluate = async (
        count: number,
        time: Temporal.Instant,
        fetched = false,
        replayed = false,
        status?: "cancelled"
      ) => {
        const filter = offer(count, status);
        const context = {
          ...audienceEvaluationAt(time),
          campaignId: Option.some(campaign),
          ...(replayed && { replayed: true }),
        };
        const facts = await Effect.runPromise(
          Effect.flatMap(AudienceFactsService, (service) =>
            service.resolve({
              filter,
              contexts: [context],
              scope: AudienceScope.Customers({ ids: [customer] }),
              ...(fetched && {
                facts: AudienceFactSource.Fetched({
                  profiles: Option.none(),
                  visits: Option.some(
                    new Map([
                      [
                        customer,
                        visits.map(({ id, name, start, end }) => ({
                          workspaceReservationId:
                            workspaceReservationIdSchema.make(
                              crypto.randomUUID()
                            ),
                          dotyposCustomerId: customer,
                          dotyposReservationId: id,
                          startsAt: at(start),
                          endsAt: at(end),
                          status:
                            name === "provider-cancel"
                              ? ("cancelled" as const)
                              : ("active" as const),
                        })),
                      ],
                    ])
                  ),
                }),
              }),
            })
          ).pipe(Effect.provide(layer))
        );
        return evaluateAudienceFilter({
          filter,
          context,
          facts,
          candidate: {
            dotyposCustomerId: customer,
            locale: "cs-CZ",
            hasAccount: false,
          },
          profile: Option.none(),
        });
      };
      for (const fetched of [false, true]) {
        // Only the locally cancelled reservation matches an explicit status;
        // confirmed provider-cancelled and active reservations remain excluded.
        expect(await evaluate(1, now, fetched, false, "cancelled")).toBe(
          "match"
        );
        expect(await evaluate(1, at("2026-05-31T00:00:00Z"), fetched)).toBe(
          "noMatch"
        );
        expect(await evaluate(1, at("2026-06-01T09:00:00Z"), fetched)).toBe(
          "match"
        );
        expect(await evaluate(1, now, fetched)).toBe("match"); // second has started but not ended
        expect(await evaluate(2, now, fetched)).toBe("noMatch");
        expect(await evaluate(1, at("2026-10-15T09:00:00Z"), fetched)).toBe(
          "noMatch"
        );
        expect(await evaluate(2, at("2026-10-15T09:00:00Z"), fetched)).toBe(
          "match"
        );
        expect(await evaluate(2, at("2026-10-16T09:00:00Z"), fetched)).toBe(
          "noMatch"
        );
        expect(
          await evaluate(2, at("2026-10-15T09:00:00Z"), fetched, true)
        ).toBe("match");
      }
      await database.pool.query(
        "insert into email_campaigns (id, title, purpose, template_key, status) values ($1, 'Return', 'marketing', 'workspace', 'sent'), ($2, 'Other', 'marketing', 'workspace', 'sent')",
        [campaign, otherCampaign]
      );
      const send = crypto.randomUUID();
      await database.pool.query(
        "insert into email_campaign_sends (id, campaign_id, audience_filter, content_hash, delivery_attempt) values ($1, $2, $3, 'hash', 1)",
        [send, otherCampaign, JSON.stringify(offer(1))]
      );
      await database.pool.query(
        "insert into email_campaign_recipients (send_id, dotypos_customer_id, locale, status, delivery_attempt, status_updated_at) values ($1, $2, 'cs-CZ', 'sent', 1, $3)",
        [send, customer, now.toString()]
      );
      expect(await evaluate(1, now)).toBe("match"); // another campaign does not suppress this offer
      await database.pool.query(
        "update email_campaign_sends set campaign_id = $1 where id = $2",
        [campaign, send]
      );
      for (const status of [
        "sent",
        "delivered",
        "complained",
        "unconfirmed",
        "failed",
      ] as const) {
        await database.pool.query(
          "update email_campaign_recipients set status = $1 where send_id = $2",
          [status, send]
        );
        expect(await evaluate(1, now)).toBe(
          status === "failed" ? "match" : "noMatch"
        );
        expect(await evaluate(1, now, true, true)).toBe(
          status === "failed" ? "match" : "noMatch"
        );
      }
    });
  }
);

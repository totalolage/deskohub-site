import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import {
  DotyposServiceMock,
  seededReservationReads,
} from "@deskohub/dotypos/backend/service.mock";
import {
  AdministrationCampaignId,
  type AudienceCountOperatorType,
  audienceAttributeCatalogue,
} from "@deskohub/workspace-admin-api";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import type { AudienceCondition, AudienceFilter } from "../../audience-filter";
import { evaluateAudienceFilter } from "../../backend/audience-evaluation";
import { audienceEvaluationAt } from "../../backend/audience-evaluation-context";
import { AudienceFactsService } from "../../backend/audience-facts.service";
import { CampaignService } from "../../backend/campaign.service";
import { CampaignAudienceService } from "../../backend/campaign-audience.service";
import { CampaignCandidateRepository } from "../../backend/campaign-candidate.repository";
import {
  campaignContentFixture,
  everyoneFilter,
} from "../../backend/email-campaigns.test-utils";
import type {
  CampaignAudienceId,
  CampaignId,
} from "../../campaign-identifiers";
import {
  type AudienceValueLookups,
  describeAudienceFilter,
} from "../audience-filter-summary";
import {
  type AudienceCountWording,
  audienceAttributeWording,
} from "./audience-attribute-wording";

const testDatabase = await connectWorkspacePostgresTestDatabase();

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { cleanup, render } = await import("@testing-library/react");
const { CountConditionControls } = await import(
  "./audience-condition-controls"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

describe.skipIf(!testDatabase)(
  "an audience whose campaign is deleted, on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const audienceIds: CampaignAudienceId[] = [];
    const campaignIds: CampaignId[] = [];
    const customer = DotyposCustomerIdSchema.make(
      `deleted-campaign-${crypto.randomUUID()}`
    );
    const context = audienceEvaluationAt(
      Temporal.Instant.from("2026-10-15T10:00:00Z")
    );

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from email_campaigns where id = any($1)",
        [campaignIds]
      );
      await testDatabase.pool.query(
        "delete from email_campaign_audiences where id = any($1)",
        [audienceIds]
      );
    });

    const run = <A, E>(
      effect: Effect.Effect<A, E, CampaignAudienceService | CampaignService>
    ) =>
      Effect.runPromiseExit(
        effect.pipe(
          Effect.provide(
            Layer.mergeAll(
              CampaignAudienceService.Default,
              CampaignService.Default
            ).pipe(Layer.provide(testDatabase.layer))
          )
        )
      );

    const succeed = async <A, E>(
      effect: Effect.Effect<A, E, CampaignAudienceService | CampaignService>
    ) => {
      const exit = await run(effect);
      if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
      return exit.value;
    };

    const createAudience = async (title: string, filter: AudienceFilter) => {
      const audience = await succeed(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.create({ title, filter }))
        )
      );
      audienceIds.push(audience.id);
      return audience;
    };

    const fromCampaign = (
      campaignId: CampaignId,
      operator: AudienceCountOperatorType,
      value: number
    ): AudienceCondition & { readonly attribute: "campaignEmailCount" } => ({
      attribute: "campaignEmailCount",
      _tag: "Condition",
      params: {
        purpose: "any",
        period: { _tag: "Past" },
        campaign: {
          _tag: "Specific",
          campaignId: AdministrationCampaignId.make(campaignId),
        },
      },
      operator,
      value,
    });

    /** Whether the filter matches the customer, from facts Postgres resolves. */
    const matches = async (filter: AudienceFilter) => {
      const facts = await Effect.runPromise(
        AudienceFactsService.pipe(
          Effect.flatMap((service) =>
            service.resolve({ filter, contexts: [context] })
          ),
          Effect.provide(
            AudienceFactsService.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  CampaignCandidateRepository.Default.pipe(
                    Layer.provide(testDatabase.layer)
                  ),
                  DotyposServiceMock(seededReservationReads([]))
                )
              )
            )
          )
        )
      );
      return (
        evaluateAudienceFilter({
          filter,
          candidate: {
            dotyposCustomerId: customer,
            locale: "cs-CZ",
            hasAccount: false,
          },
          context,
          facts,
          profile: Option.none(),
        }) === "match"
      );
    };

    /** The campaigns the Admin UI looks up, as `loadAudienceValueLookups` does. */
    const lookups = async (): Promise<AudienceValueLookups> => ({
      campaigns: (
        await succeed(CampaignService.pipe(Effect.flatMap(({ list }) => list)))
      ).map(({ id, title, delivery, status }) => ({
        id,
        name: title,
        delivery,
        status,
      })),
    });

    const pickerText = (
      condition: AudienceCondition & {
        readonly attribute: "campaignEmailCount";
      },
      values: AudienceValueLookups,
      locale: Locale
    ) => {
      const view = render(
        <RouteLocaleProvider locale={locale}>
          <CountConditionControls
            entry={audienceAttributeCatalogue.campaignEmailCount}
            wording={
              audienceAttributeWording(
                "campaignEmailCount",
                locale
              ) as AudienceCountWording
            }
            value={condition}
            onChange={() => undefined}
            errorAt={() => undefined}
            lookups={values}
          />
        </RouteLocaleProvider>
      );
      const name = locale === "cs-CZ" ? "Kampaň" : "Campaign";
      const text = view.getByRole("combobox", { name }).textContent;
      cleanup();
      return text;
    };

    test("keeps the audience, counts none, names the campaign deleted, and refuses a re-save", async () => {
      const holder = await createAudience(
        "Deleted source holder",
        everyoneFilter
      );
      const source = await succeed(
        CampaignService.pipe(
          Effect.flatMap((campaigns) =>
            campaigns.create({
              title: "Spring sale 2026",
              purpose: "marketing",
              templateKey: "workspace",
              content: campaignContentFixture(),
              audienceId: holder.id,
            })
          )
        )
      );
      campaignIds.push(source.id);
      const none = fromCampaign(source.id, "eq", 0);
      const some = fromCampaign(source.id, "gte", 1);
      const audience = await createAudience("Emails from a deleted campaign", {
        _tag: "Group",
        operator: "and",
        filters: [none],
      });

      const before = await lookups();
      expect(describeAudienceFilter(none, "cs-CZ", before)).toBe(
        "Zákazníci, kteří neobdrželi žádný e-mail z kampaně „Spring sale 2026“ kdykoli dosud"
      );
      expect(pickerText(none, before, "en-US")).toBe("Spring sale 2026");

      await succeed(
        CampaignService.pipe(
          Effect.flatMap((campaigns) => campaigns.delete(source.id))
        )
      );

      const stored = await succeed(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) => audiences.get(audience.id))
        )
      );
      expect(stored.filter).toEqual(audience.filter);
      expect(await matches(stored.filter)).toBe(true);
      expect(await matches(some)).toBe(false);

      const after = await lookups();
      expect(describeAudienceFilter(stored.filter, "en-US", after)).toBe(
        "Customers who received no emails from a deleted campaign at any time so far"
      );
      expect(describeAudienceFilter(stored.filter, "cs-CZ", after)).toBe(
        "Zákazníci, kteří neobdrželi žádný e-mail ze smazané kampaně kdykoli dosud"
      );
      expect(pickerText(none, after, "en-US")).toBe("Deleted campaign");
      expect(pickerText(none, after, "cs-CZ")).toBe("Smazaná kampaň");

      const resave = await run(
        CampaignAudienceService.pipe(
          Effect.flatMap((audiences) =>
            audiences.update({
              audienceId: audience.id,
              title: "Renamed by a refused re-save",
              filter: stored.filter,
            })
          )
        )
      );
      expect(
        Exit.isFailure(resave) ? Cause.squash(resave.cause) : undefined
      ).toMatchObject({
        _tag: "AudienceFilterCampaignNotFound",
        campaignIds: [source.id],
      });
    });
  }
);

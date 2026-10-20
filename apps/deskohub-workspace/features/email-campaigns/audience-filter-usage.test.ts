import { describe, expect, test } from "bun:test";
import type { CampaignEmailSourceType } from "@deskohub/workspace-admin-api";
import { Effect, Exit } from "effect";
import type { AudienceCondition, AudienceFilter } from "./audience-filter";
import {
  type AudienceFilterUses,
  audienceFilterUsage,
  ensureSavedAudienceFilter,
  isSavedAudienceFilter,
  savedAudienceUnavailableUsesIn,
} from "./audience-filter-usage";
import { campaignIdSchema } from "./campaign-identifiers";

const springCampaign = campaignIdSchema.make("spring-campaign");
const autumnCampaign = campaignIdSchema.make("autumn-campaign");

const anyCampaignEmails: AudienceCondition = {
  attribute: "campaignEmailCount",
  _tag: "Condition",
  params: { purpose: "any", period: { _tag: "AnyTime" } },
  operator: "eq",
  value: 0,
};

const campaignEmails = (
  campaign: CampaignEmailSourceType
): AudienceCondition => ({
  attribute: "campaignEmailCount",
  _tag: "Condition",
  params: { purpose: "any", period: { _tag: "AnyTime" }, campaign },
  operator: "eq",
  value: 0,
});

const noUses: AudienceFilterUses = {
  attributes: [],
  periods: [],
  campaignSources: [],
};

const group = (
  operator: "and" | "or",
  filters: readonly AudienceFilter[]
): AudienceFilter => ({ _tag: "Group", operator, filters: [...filters] });

describe("audienceFilterUsage", () => {
  test("collects attributes, periods, and campaign sources from nested groups", () => {
    const filter = group("and", [
      {
        attribute: "locale",
        _tag: "Condition",
        operator: "anyOf",
        value: ["cs-CZ"],
      },
      group("or", [
        {
          attribute: "reservationCount",
          _tag: "Condition",
          params: {
            dateBasis: "visit",
            period: { _tag: "Last", count: 3, unit: "month" },
          },
          operator: "gt",
          value: 0,
        },
        group("and", [
          campaignEmails({ _tag: "Specific", campaignId: springCampaign }),
          campaignEmails({ _tag: "Specific", campaignId: autumnCampaign }),
          campaignEmails({ _tag: "Specific", campaignId: springCampaign }),
          {
            attribute: "accountCreated",
            _tag: "Condition",
            operator: "notIn",
            value: { _tag: "Since", date: "2026-01-01" },
          },
        ]),
      ]),
    ]);

    const usage = audienceFilterUsage(filter);

    expect([...usage.attributes].sort()).toEqual([
      "accountCreated",
      "campaignEmailCount",
      "locale",
      "reservationCount",
    ]);
    expect([...usage.periods].sort()).toEqual(["AnyTime", "Last", "Since"]);
    expect([...usage.campaignSources]).toEqual(["Specific"]);
    expect(usage.specificCampaignIds).toEqual([springCampaign, autumnCampaign]);
  });

  test("ignores the period of a date condition without a value and an absent campaign", () => {
    const usage = audienceFilterUsage(
      group("and", [
        { attribute: "lastVisit", _tag: "Condition", operator: "none" },
        anyCampaignEmails,
      ])
    );

    expect([...usage.periods]).toEqual(["AnyTime"]);
    expect(usage.campaignSources.size).toBe(0);
    expect(usage.specificCampaignIds).toEqual([]);
  });
});

describe("saved audience shapes", () => {
  const unavailable: readonly {
    readonly use: string;
    readonly filter: AudienceFilter;
    readonly uses: AudienceFilterUses;
  }[] = [
    {
      use: "a trigger window",
      filter: {
        attribute: "reservationCount",
        _tag: "Condition",
        params: {
          dateBasis: "booking",
          period: {
            _tag: "TriggerWindow",
            side: "after",
            count: 2,
            unit: "week",
          },
        },
        operator: "eq",
        value: 0,
      },
      uses: { ...noUses, periods: ["TriggerWindow"] },
    },
    {
      use: "this campaign's emails",
      filter: campaignEmails({ _tag: "This" }),
      uses: { ...noUses, campaignSources: ["This"] },
    },
  ];

  test.each(unavailable)("reports $use, even nested", ({ filter, uses }) => {
    const nested = group("or", [group("and", [filter])]);

    expect(savedAudienceUnavailableUsesIn(nested)).toEqual(uses);
    expect(isSavedAudienceFilter(nested)).toBe(false);
    expect(
      Effect.runSync(Effect.flip(ensureSavedAudienceFilter(nested)))
    ).toMatchObject({ _tag: "AudienceFilterContextInvalid", uses });
  });

  test("reports nothing for supported saved audience uses", () => {
    const filter = group("and", [
      { attribute: "firstVisit", _tag: "Condition", operator: "none" },
      {
        attribute: "hasAccount",
        _tag: "Condition",
        operator: "is",
        value: true,
      },
      {
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "in",
        value: { _tag: "Range", from: "2026-01-01", to: "2026-03-31" },
      },
      {
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "in",
        value: { _tag: "Past" },
      },
      {
        attribute: "accountCreated",
        _tag: "Condition",
        operator: "in",
        value: { _tag: "Onward", date: "2026-01-01" },
      },
      {
        attribute: "reservationCount",
        _tag: "Condition",
        params: {
          dateBasis: "visit",
          period: { _tag: "Until", date: "2026-12-31" },
        },
        operator: "gte",
        value: 2,
      },
      anyCampaignEmails,
      campaignEmails({ _tag: "Specific", campaignId: springCampaign }),
    ]);

    expect(savedAudienceUnavailableUsesIn(filter)).toEqual(noUses);
    expect(isSavedAudienceFilter(filter)).toBe(true);
    expect(
      Exit.isSuccess(Effect.runSyncExit(ensureSavedAudienceFilter(filter)))
    ).toBe(true);
  });
});

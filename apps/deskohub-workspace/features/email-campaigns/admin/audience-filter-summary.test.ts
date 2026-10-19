import { describe, expect, test } from "bun:test";
import type { AudienceCountOperatorType } from "@deskohub/workspace-admin-api";
import type { Locale } from "@/features/i18n";
import type { AudienceCondition, AudienceFilter } from "../audience-filter";
import type { DatePeriod } from "../date-period";
import {
  describeAudienceFilter,
  hasPeriodEndingAtEvaluation,
} from "./audience-filter-summary";
import { describeDatePeriod } from "./date-period-phrases";

const and = (...filters: AudienceFilter[]): AudienceFilter => ({
  _tag: "Group",
  operator: "and",
  filters,
});
const or = (...filters: AudienceFilter[]): AudienceFilter => ({
  _tag: "Group",
  operator: "or",
  filters,
});
const czech: AudienceCondition = {
  attribute: "locale",
  _tag: "Condition",
  operator: "anyOf",
  value: ["cs-CZ"],
};

const reservations = (
  operator: AudienceCountOperatorType,
  value: number,
  params: Partial<
    Extract<AudienceCondition, { attribute: "reservationCount" }>["params"]
  > = {}
): AudienceCondition => ({
  attribute: "reservationCount",
  _tag: "Condition",
  params: { dateBasis: "visit", period: { _tag: "AnyTime" }, ...params },
  operator,
  value,
});

const campaignEmails = (
  operator: AudienceCountOperatorType,
  value: number,
  params: Partial<
    Extract<AudienceCondition, { attribute: "campaignEmailCount" }>["params"]
  > = {}
): AudienceCondition => ({
  attribute: "campaignEmailCount",
  _tag: "Condition",
  params: { purpose: "any", period: { _tag: "AnyTime" }, ...params },
  operator,
  value,
});

const describe_ = (filter: AudienceFilter, locale: Locale = "en-US") =>
  describeAudienceFilter(filter, locale);

describe("describeAudienceFilter", () => {
  test("describes empty groups", () => {
    expect(describe_(and())).toBe("Every customer Workspace knows");
    expect(describe_(or())).toBe("Nobody");
  });

  test("describes counts naturally", () => {
    expect(describe_(reservations("gt", 0))).toBe(
      "Customers who have any booked reservations"
    );
    expect(describe_(reservations("eq", 0))).toBe(
      "Customers who have no booked reservations"
    );
    expect(
      describe_(
        reservations("gte", 2, {
          dateBasis: "booking",
          period: { _tag: "Last", count: 1, unit: "month" },
          status: "cancelled",
        })
      )
    ).toBe(
      "Customers who have at least 2 cancelled reservations confirmed in the last month"
    );
    expect(
      describe_({
        attribute: "campaignEmailCount",
        _tag: "Condition",
        params: {
          purpose: "marketing",
          period: { _tag: "Last", count: 10, unit: "day" },
        },
        operator: "eq",
        value: 0,
      })
    ).toBe(
      "Customers who received no marketing campaign emails in the last 10 days"
    );
  });

  test.each<[AudienceCountOperatorType, number, string]>([
    ["eq", 0, "no emails"],
    ["eq", 1, "exactly 1 email"],
    // Only "= 0" and "< 1" read as "no", and "> 0" and "≥ 1" as "any".
    ["ne", 0, "other than 0 emails"],
    ["ne", 2, "other than 2 emails"],
    ["lt", 0, "fewer than 0 emails"],
    ["lt", 1, "no emails"],
    ["lt", 3, "fewer than 3 emails"],
    ["lte", 0, "at most 0 emails"],
    ["lte", 2, "at most 2 emails"],
    ["gt", 0, "any emails"],
    ["gt", 1, "more than 1 email"],
    ["gte", 0, "at least 0 emails"],
    ["gte", 1, "any emails"],
    ["gte", 3, "at least 3 emails"],
    ["gt", Number.NaN, "… emails"],
  ])("phrases %s %d as “%s”", (operator, value, phrase) => {
    expect(describe_(campaignEmails(operator, value))).toBe(
      `Customers who received ${phrase.replace("email", "campaign email")}`
    );
  });

  test.each<[AudienceCountOperatorType, number, string]>([
    ["eq", 0, "neobdrželi žádný e-mail z kampaně"],
    ["gte", 1, "obdrželi alespoň jeden e-mail z kampaně"],
    ["eq", 1, "obdrželi přesně 1 e-mail z kampaně"],
    ["gt", 2, "obdrželi více než 2 e-maily z kampaní"],
    ["lte", 5, "obdrželi nejvýše 5 e-mailů z kampaní"],
    ["ne", 3, "obdrželi jiný počet e-mailů z kampaní než 3"],
  ])("phrases %s %d in Czech as “%s”", (operator, value, phrase) => {
    expect(describe_(campaignEmails(operator, value), "cs-CZ")).toBe(
      `Zákazníci, kteří ${phrase}`
    );
  });

  test("describes date attributes", () => {
    expect(
      describe_({
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "notIn",
        value: { _tag: "Last", count: 30, unit: "day" },
      })
    ).toBe(
      "Customers who have visited, with the last visit not in the last 30 days"
    );
    expect(
      describe_({ attribute: "lastVisit", _tag: "Condition", operator: "none" })
    ).toBe("Customers who have never visited");
    expect(
      describe_({
        attribute: "accountCreated",
        _tag: "Condition",
        operator: "in",
        value: { _tag: "Since", date: "2026-09-01" },
      })
    ).toBe("Customers who created a Workspace account since Sep 1, 2026");
  });

  test("describes the first visit", () => {
    const firstVisit = (
      condition: Omit<
        Extract<AudienceCondition, { attribute: "firstVisit" }>,
        "attribute" | "_tag"
      >
    ): AudienceCondition => ({
      attribute: "firstVisit",
      _tag: "Condition",
      ...condition,
    });
    const cowork = { product: { family: "cowork", properties: [] } } as const;
    expect(
      describe_(
        firstVisit({
          params: cowork,
          operator: "in",
          value: { _tag: "Last", count: 30, unit: "day" },
        })
      )
    ).toBe("Customers who first visited for cowork in the last 30 days");
    expect(
      describe_(firstVisit({ operator: "in", value: { _tag: "AnyTime" } }))
    ).toBe("Customers who have visited");
    expect(
      describe_(
        firstVisit({
          operator: "notIn",
          value: { _tag: "Since", date: "2026-09-01" },
        })
      )
    ).toBe(
      "Customers who have visited, with the first visit not since Sep 1, 2026"
    );
    expect(describe_(firstVisit({ operator: "none" }))).toBe(
      "Customers who have never visited"
    );
    expect(
      describe_(
        firstVisit({
          operator: "in",
          value: { _tag: "Last", count: 30, unit: "day" },
        }),
        "cs-CZ"
      )
    ).toBe("Zákazníci, kteří nás poprvé navštívili za posledních 30 dní");
    expect(
      describe_(
        firstVisit({
          operator: "notIn",
          value: { _tag: "Last", count: 1, unit: "month" },
        }),
        "cs-CZ"
      )
    ).toBe("Zákazníci, kteří nás navštívili, ale poprvé ne za poslední měsíc");
    expect(describe_(firstVisit({ operator: "none" }), "cs-CZ")).toBe(
      "Zákazníci, kteří nás nikdy nenavštívili"
    );
  });

  describe("campaign source", () => {
    const lastTenDays = { _tag: "Last", count: 10, unit: "day" } as const;
    const fromSpring = campaignEmails("gte", 2, {
      period: lastTenDays,
      campaign: { _tag: "Specific", campaignId: "campaign-spring" },
    });
    const campaigns = [{ id: "campaign-spring", name: "Spring sale" }];

    test("leaves counts of any campaign as they were", () => {
      expect(describe_(campaignEmails("gte", 2, { period: lastTenDays }))).toBe(
        "Customers who received at least 2 campaign emails in the last 10 days"
      );
    });

    test("names the evaluating campaign", () => {
      const fromThis = campaignEmails("eq", 0, {
        period: lastTenDays,
        campaign: { _tag: "This" },
      });
      expect(describe_(fromThis)).toBe(
        "Customers who received no emails from this campaign in the last 10 days"
      );
      expect(describe_(fromThis, "cs-CZ")).toBe(
        "Zákazníci, kteří neobdrželi žádný e-mail z této kampaně za posledních 10 dní"
      );
    });

    test("names a looked-up campaign, otherwise shows its ID", () => {
      expect(describeAudienceFilter(fromSpring, "en-US", { campaigns })).toBe(
        "Customers who received at least 2 emails from campaign “Spring sale” in the last 10 days"
      );
      expect(describeAudienceFilter(fromSpring, "cs-CZ", { campaigns })).toBe(
        "Zákazníci, kteří obdrželi alespoň 2 e-maily z kampaně „Spring sale“ za posledních 10 dní"
      );
      expect(describe_(fromSpring)).toBe(
        "Customers who received at least 2 emails from campaign campaign-spring in the last 10 days"
      );
    });

    test.each([
      [
        "eq",
        0,
        "Zákazníci, kteří neobdrželi žádný e-mail z kampaně „Spring sale“ za posledních 10 dní",
      ],
      [
        "gte",
        1,
        "Zákazníci, kteří obdrželi alespoň jeden e-mail z kampaně „Spring sale“ za posledních 10 dní",
      ],
      [
        "eq",
        2,
        "Zákazníci, kteří obdrželi přesně 2 e-maily z kampaně „Spring sale“ za posledních 10 dní",
      ],
      [
        "gte",
        5,
        "Zákazníci, kteří obdrželi alespoň 5 e-mailů z kampaně „Spring sale“ za posledních 10 dní",
      ],
    ] as const)(
      "names one campaign once in Czech for %s %d",
      (operator, value, expected) => {
        const filter = campaignEmails(operator, value, {
          period: lastTenDays,
          campaign: { _tag: "Specific", campaignId: "campaign-spring" },
        });
        expect(describeAudienceFilter(filter, "cs-CZ", { campaigns })).toBe(
          expected
        );
      }
    );

    test("calls a campaign missing from the lookup deleted", () => {
      const fromDeleted = campaignEmails("eq", 0, {
        period: lastTenDays,
        campaign: { _tag: "Specific", campaignId: "campaign-deleted" },
      });
      expect(describeAudienceFilter(fromDeleted, "en-US", { campaigns })).toBe(
        "Customers who received no emails from a deleted campaign in the last 10 days"
      );
      expect(describeAudienceFilter(fromDeleted, "cs-CZ", { campaigns })).toBe(
        "Zákazníci, kteří neobdrželi žádný e-mail ze smazané kampaně za posledních 10 dní"
      );
    });
  });

  test("describes in Czech", () => {
    expect(describe_(and(), "cs-CZ")).toBe(
      "Každý zákazník, kterého Workspace zná"
    );
    expect(
      describe_(
        and(
          czech,
          reservations("gte", 2, {
            dateBasis: "booking",
            period: { _tag: "Last", count: 3, unit: "month" },
            status: "cancelled",
          }),
          {
            attribute: "lastVisit",
            _tag: "Condition",
            operator: "in",
            value: { _tag: "Last", count: 30, unit: "day" },
          }
        ),
        "cs-CZ"
      )
    ).toBe(
      "Zákazníci, kteří mluví česky a mají alespoň 2 zrušené rezervace s potvrzením za poslední 3 měsíce a nás naposledy navštívili za posledních 30 dní"
    );
    expect(
      describe_(
        reservations("eq", 0, {
          product: {
            family: "office",
            properties: [{ property: "seats", operator: "gte", value: 4 }],
          },
        }),
        "cs-CZ"
      )
    ).toBe(
      "Zákazníci, kteří nemají žádnou potvrzenou rezervaci (kancelář, alespoň 4 místa)"
    );
  });

  test("describes set and boolean attributes, with names for known groups", () => {
    expect(
      describeAudienceFilter(
        and(
          czech,
          {
            attribute: "dotyposTags",
            _tag: "Condition",
            operator: "noneOf",
            value: ["vip", "staff"],
          },
          {
            attribute: "discountGroup",
            _tag: "Condition",
            operator: "anyOf",
            value: ["1", "2"],
          },
          {
            attribute: "hasAccount",
            _tag: "Condition",
            operator: "is",
            value: false,
          }
        ),
        "en-US",
        { discountGroups: [{ id: "1", name: "Students" }] }
      )
    ).toBe(
      "Customers who speak Czech and aren’t tagged “vip” or “staff” and are in discount group “Students” or 2 and have no Workspace account"
    );
  });

  test("brackets nested groups with more than one condition", () => {
    expect(
      describe_(and(czech, or(reservations("gt", 0), reservations("eq", 0))))
    ).toBe(
      "Customers who speak Czech and (have any booked reservations or have no booked reservations)"
    );
  });
});

describe("describeDatePeriod", () => {
  test.each<[DatePeriod, string]>([
    [{ _tag: "AnyTime" }, "at any time"],
    [{ _tag: "Last", count: 1, unit: "week" }, "in the last week"],
    [{ _tag: "Last", count: 2, unit: "year" }, "in the last 2 years"],
    [
      { _tag: "Range", from: "2026-01-01", to: "2026-03-31" },
      "from Jan 1, 2026 to Mar 31, 2026",
    ],
    [{ _tag: "Since", date: "2026-01-01" }, "since Jan 1, 2026"],
    [{ _tag: "Onward", date: "2026-01-01" }, "from Jan 1, 2026 onward"],
    [{ _tag: "Until", date: "2026-01-01" }, "until Jan 1, 2026"],
    [{ _tag: "Past" }, "at any time so far"],
    [
      { _tag: "TriggerWindow", side: "before", count: 1, unit: "month" },
      "within 1 month before the trigger",
    ],
    [
      { _tag: "TriggerWindow", side: "after", count: 2, unit: "week" },
      "within 2 weeks after the trigger",
    ],
  ])("names %o as “%s”", (period, phrase) => {
    expect(describeDatePeriod(period, "en-US")).toBe(phrase);
  });

  test("names periods in Czech, with Czech dates", () => {
    expect(
      describeDatePeriod(
        { _tag: "Range", from: "2026-01-01", to: "2026-03-31" },
        "cs-CZ"
      )
    ).toBe("od 1. 1. 2026 do 31. 3. 2026");
    expect(
      describeDatePeriod({ _tag: "Last", count: 1, unit: "day" }, "cs-CZ")
    ).toBe("za poslední den");
  });

  test.each<[DatePeriod, string]>([
    [{ _tag: "Past" }, "kdykoli dosud"],
    [
      { _tag: "TriggerWindow", side: "before", count: 1, unit: "month" },
      "během 1 měsíce před spouštěcí událostí",
    ],
    [
      { _tag: "TriggerWindow", side: "after", count: 2, unit: "week" },
      "během 2 týdnů po spouštěcí události",
    ],
    [
      { _tag: "TriggerWindow", side: "after", count: 5, unit: "year" },
      "během 5 let po spouštěcí události",
    ],
    [
      { _tag: "TriggerWindow", side: "before", count: 3, unit: "day" },
      "během 3 dní před spouštěcí událostí",
    ],
  ])("names %o in Czech as “%s”", (period, phrase) => {
    expect(describeDatePeriod(period, "cs-CZ")).toBe(phrase);
  });
});

describe("hasPeriodEndingAtEvaluation", () => {
  test("finds last-N and since periods anywhere in the tree", () => {
    expect(hasPeriodEndingAtEvaluation(and(czech, reservations("gt", 0)))).toBe(
      false
    );
    expect(
      hasPeriodEndingAtEvaluation(
        and(
          czech,
          or(
            reservations("gt", 0, {
              period: { _tag: "Last", count: 2, unit: "week" },
            })
          )
        )
      )
    ).toBe(true);
    expect(
      hasPeriodEndingAtEvaluation({
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "in",
        value: { _tag: "Since", date: "2026-01-01" },
      })
    ).toBe(true);
    expect(
      hasPeriodEndingAtEvaluation({
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "none",
      })
    ).toBe(false);
  });

  test.each<[DatePeriod, boolean]>([
    [{ _tag: "AnyTime" }, false],
    [{ _tag: "Past" }, true],
    [{ _tag: "Range", from: "2026-01-01", to: "2026-02-01" }, false],
    [{ _tag: "Onward", date: "2026-01-01" }, false],
    [{ _tag: "Until", date: "2026-01-01" }, false],
    [{ _tag: "TriggerWindow", side: "before", count: 1, unit: "month" }, true],
  ])("moves with the evaluation time for %o: %p", (period, moves) => {
    expect(hasPeriodEndingAtEvaluation(reservations("gt", 0, { period }))).toBe(
      moves
    );
    expect(
      hasPeriodEndingAtEvaluation({
        attribute: "firstVisit",
        _tag: "Condition",
        operator: "in",
        value: period,
      })
    ).toBe(moves);
  });
});

describe("reservation product phrasing", () => {
  test("names the product by its catalog names", () => {
    expect(
      describe_(
        reservations("gte", 1, {
          period: { _tag: "Last", count: 1, unit: "month" },
          product: {
            family: "cowork",
            properties: [
              { property: "tier", operator: "anyOf", value: ["reserved-desk"] },
            ],
          },
        })
      )
    ).toBe(
      "Customers who have any booked reservations for cowork with tier Reserved Desk visiting in the last month"
    );
  });

  test("adds the other property conditions after the product", () => {
    expect(
      describe_(
        reservations("eq", 0, {
          product: {
            family: "office",
            properties: [
              { property: "seats", operator: "gte", value: 4 },
              { property: "days", operator: "lt", value: 3 },
            ],
          },
        })
      )
    ).toBe(
      "Customers who have no booked reservations for office with at least 4 seats and fewer than 3 days"
    );
    expect(
      describe_({
        attribute: "lastVisit",
        _tag: "Condition",
        params: {
          product: {
            family: "cowork",
            properties: [
              { property: "coffee", operator: "is", value: false },
              { property: "tier", operator: "noneOf", value: ["basic"] },
            ],
          },
        },
        operator: "none",
      })
    ).toBe(
      "Customers who have never visited for cowork with no coffee and tier other than Basic Day Pass"
    );
  });
});

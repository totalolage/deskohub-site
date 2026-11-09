import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import { AudienceFilter } from "./audience-filter";
import {
  AdministrationCampaignAudienceCreateRequest,
  AdministrationCampaignAudienceInput,
  AdministrationCampaignAudienceUpdate,
  AdministrationCampaignCreateInput,
  AdministrationCampaignCreateRequest,
  AdministrationCampaignDuplicateRequest,
  AdministrationCampaignRetryInput,
  AdministrationCampaignSendInput,
  AdministrationCampaignSendStatusResult,
  AdministrationCampaignTemplatePreviewInput,
  AdministrationCampaignUpdateInput,
} from "./email-campaigns";

const decodes = <A, I>(schema: Schema.Codec<A, I>, input: unknown) =>
  Result.isSuccess(Schema.decodeUnknownResult(schema)(input));

/**
 * A filter of every attribute kind as Workspace stores it and dhw sends it.
 * `attribute` precedes `_tag` in each condition: the union dispatches on the
 * first literal key it indexes, so errors name the condition's own fields.
 */
const storedFilterJson =
  '{"_tag":"Group","operator":"or","filters":[{"attribute":"reservationCount","_tag":"Condition","params":{"dateBasis":"booking","period":{"_tag":"Range","from":"2026-01-01","to":"2026-06-30"},"status":"complete"},"operator":"eq","value":0},{"attribute":"campaignEmailCount","_tag":"Condition","params":{"purpose":"marketing","period":{"_tag":"Last","count":10,"unit":"day"}},"operator":"lt","value":2},{"_tag":"Group","operator":"and","filters":[{"attribute":"lastVisit","_tag":"Condition","operator":"notIn","value":{"_tag":"Onward","date":"2026-09-01"}},{"attribute":"accountCreated","_tag":"Condition","operator":"none"},{"attribute":"locale","_tag":"Condition","operator":"anyOf","value":["cs-CZ","en-US"]},{"attribute":"hasAccount","_tag":"Condition","operator":"is","value":false},{"attribute":"dotyposTags","_tag":"Condition","operator":"allOf","value":["vip","coworker"]},{"attribute":"discountGroup","_tag":"Condition","operator":"noneOf","value":["42"]}]},{"_tag":"Group","operator":"and","filters":[]}]}';

/** A filter in the key order Postgres `jsonb` returns. */
const jsonbFilterJson =
  '{"_tag":"Group","filters":[{"_tag":"Condition","value":0,"params":{"period":{"to":"2026-06-30","_tag":"Range","from":"2026-01-01"},"status":"complete","dateBasis":"booking"},"operator":"gt","attribute":"reservationCount"}],"operator":"and"}';

const reencode = (json: string) =>
  JSON.stringify(
    Schema.encodeSync(AudienceFilter)(
      Schema.decodeUnknownSync(AudienceFilter)(JSON.parse(json))
    )
  );

const issuePaths = (input: unknown) => {
  const result = Schema.toStandardSchemaV1(AudienceFilter, {
    parseOptions: { errors: "all" },
  })["~standard"].validate(input);
  return "issues" in result && result.issues
    ? result.issues.map(({ path }) => (path ?? []).join("."))
    : [];
};

describe("campaign admin API contract", () => {
  test("keeps the stored audience filter wire format byte for byte", () => {
    expect(reencode(storedFilterJson)).toBe(storedFilterJson);
  });

  test.each([
    [
      "the first visit",
      '{"attribute":"firstVisit","_tag":"Condition","params":{"product":{"family":"cowork","properties":[]}},"operator":"in","value":{"_tag":"Last","count":30,"unit":"day"}}',
    ],
    [
      "a trigger-relative period",
      '{"attribute":"reservationCount","_tag":"Condition","params":{"dateBasis":"visit","period":{"_tag":"TriggerWindow","side":"after","count":2,"unit":"week"}},"operator":"gt","value":0}',
    ],
    [
      "the past",
      '{"attribute":"lastVisit","_tag":"Condition","operator":"notIn","value":{"_tag":"Past"}}',
    ],
    [
      "emails of one campaign",
      '{"_tag":"Group","operator":"or","filters":[{"attribute":"campaignEmailCount","_tag":"Condition","params":{"purpose":"any","period":{"_tag":"AnyTime"},"campaign":{"_tag":"Specific","campaignId":"campaign-1"}},"operator":"eq","value":0},{"attribute":"campaignEmailCount","_tag":"Condition","params":{"purpose":"any","period":{"_tag":"Last","count":3,"unit":"month"},"campaign":{"_tag":"This"}},"operator":"eq","value":0}]}',
    ],
  ])("keeps the wire format of %s byte for byte", (_shape, json) => {
    expect(reencode(json)).toBe(json);
  });

  test("rejects a campaign purpose beside one campaign's emails", () => {
    const fromCampaign = (purpose: string) => ({
      attribute: "campaignEmailCount",
      _tag: "Condition",
      params: {
        purpose,
        period: { _tag: "AnyTime" },
        campaign: { _tag: "This" },
      },
      operator: "eq",
      value: 0,
    });
    expect(issuePaths(fromCampaign("marketing"))).toEqual(["params.purpose"]);
    expect(issuePaths(fromCampaign("any"))).toEqual([]);
  });

  test("decodes an audience filter in jsonb key order", () => {
    expect(reencode(jsonbFilterJson)).toBe(
      '{"_tag":"Group","operator":"and","filters":[{"attribute":"reservationCount","_tag":"Condition","params":{"dateBasis":"booking","period":{"_tag":"Range","from":"2026-01-01","to":"2026-06-30"},"status":"complete"},"operator":"gt","value":0}]}'
    );
  });

  test("reports an invalid condition's errors at its own fields only", () => {
    expect(
      issuePaths({
        _tag: "Group",
        operator: "and",
        filters: [
          {
            attribute: "dotyposTags",
            _tag: "Condition",
            operator: "anyOf",
            value: [],
          },
          {
            attribute: "reservationCount",
            _tag: "Condition",
            params: {
              dateBasis: "visit",
              period: { _tag: "Range", from: "2026-02-01", to: "2026-01-01" },
            },
            operator: "gt",
            value: -1,
          },
        ],
      })
    ).toEqual([
      "filters.0.value",
      "filters.1.params.period",
      "filters.1.value",
    ]);
  });

  test("rejects zero comparisons that match nobody or everyone, on the operator", () => {
    const emailCount = (operator: string, value: number) => ({
      attribute: "campaignEmailCount",
      _tag: "Condition",
      params: { purpose: "any", period: { _tag: "AnyTime" } },
      operator,
      value,
    });
    const seats = (operator: string, value: number) => ({
      attribute: "reservationCount",
      _tag: "Condition",
      params: {
        dateBasis: "visit",
        period: { _tag: "AnyTime" },
        product: {
          family: "office",
          properties: [{ property: "seats", operator, value }],
        },
      },
      operator: "gt",
      value: 0,
    });
    expect(issuePaths(emailCount("lt", 0))).toEqual(["operator"]);
    expect(issuePaths(emailCount("gte", 0))).toEqual(["operator"]);
    // Property conditions have no discriminator, so every shape reports.
    expect(issuePaths(seats("lt", 0))).toContain(
      "params.product.properties.0.operator"
    );
    for (const [operator, value] of [
      ["eq", 0],
      ["ne", 0],
      ["lte", 0],
      ["gt", 0],
      ["lt", 1],
      ["gte", 1],
    ] as const) {
      expect(issuePaths(emailCount(operator, value))).toEqual([]);
      expect(issuePaths(seats(operator, value))).toEqual([]);
    }
    expect(
      Schema.decodeUnknownResult(AudienceFilter)(emailCount("lt", 0)).pipe(
        Result.match({
          onFailure: (issue) => String(issue),
          onSuccess: () => "",
        })
      )
    ).toContain("“< 0” never matches. Use “= 0” for none.");
  });

  test("accepts a stored audience filter in every API input that embeds it", () => {
    const filter = JSON.parse(storedFilterJson);

    expect(
      decodes(AdministrationCampaignAudienceInput, {
        title: "Audience",
        filter,
      })
    ).toBe(true);
    expect(decodes(AdministrationCampaignAudienceUpdate, { filter })).toBe(
      true
    );
  });

  test.each([
    [
      "an unknown attribute",
      { attribute: "spend", _tag: "Condition", operator: "gt", value: 100 },
    ],
    ["a legacy condition", { _tag: "Locale", locales: ["cs-CZ"] }],
    [
      "an invalid calendar date",
      {
        attribute: "lastVisit",
        _tag: "Condition",
        operator: "in",
        value: { _tag: "Since", date: "2026-02-30" },
      },
    ],
    [
      "an empty locale list",
      { attribute: "locale", _tag: "Condition", operator: "anyOf", value: [] },
    ],
    [
      "an unsupported locale",
      {
        attribute: "locale",
        _tag: "Condition",
        operator: "anyOf",
        value: ["de-DE"],
      },
    ],
    [
      "a negative count",
      {
        attribute: "campaignEmailCount",
        _tag: "Condition",
        params: { purpose: "any", period: { _tag: "AnyTime" } },
        operator: "eq",
        value: -1,
      },
    ],
    [
      "an unknown property in a nested condition",
      {
        _tag: "Group",
        operator: "and",
        filters: [
          {
            attribute: "hasAccount",
            _tag: "Condition",
            operator: "is",
            value: true,
            extra: 1,
          },
        ],
      },
    ],
  ])("rejects an audience filter with %s", (_, filter) => {
    expect(
      decodes(AdministrationCampaignAudienceInput, {
        title: "Audience",
        filter,
      })
    ).toBe(false);
    expect(decodes(AdministrationCampaignAudienceUpdate, { filter })).toBe(
      false
    );
  });

  test("trims titles and rejects blank ones", () => {
    const input = {
      purpose: "marketing",
      templateKey: "workspace",
      audienceId: null,
      content: {
        "cs-CZ": {
          subject: "Novinky",
          preheader: "",
          bodyMarkdown: "Ahoj",
        },
      },
    };

    expect(
      Schema.decodeUnknownSync(AdministrationCampaignCreateInput)({
        ...input,
        title: "  News  ",
      }).title
    ).toBe("News");
    expect(
      decodes(AdministrationCampaignCreateInput, { ...input, title: "   " })
    ).toBe(false);
  });

  test("accepts only known locales and fields in campaign content", () => {
    const content = { subject: "News", preheader: "", bodyMarkdown: "Hi" };
    const create = (overrides: object) => ({
      title: "News",
      purpose: "operational",
      templateKey: "workspace",
      audienceId: null,
      content: { "en-US": content },
      ...overrides,
    });

    expect(decodes(AdministrationCampaignCreateInput, create({}))).toBe(true);
    expect(
      decodes(
        AdministrationCampaignCreateInput,
        create({ content: { "de-DE": content } })
      )
    ).toBe(false);
    expect(
      decodes(
        AdministrationCampaignCreateInput,
        create({ content: { "en-US": { ...content, body: {} } } })
      )
    ).toBe(false);
    expect(
      decodes(AdministrationCampaignCreateInput, create({ status: "sent" }))
    ).toBe(false);
  });

  test("takes a body as Markdown or as the editor's document, never both", () => {
    const bodyDocument = {
      formatVersion: 1 as const,
      doc: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "# News" }],
          },
        ],
      },
    };
    const texts = { subject: "News", preheader: "" };
    const create = (content: object) => ({
      title: "News",
      purpose: "operational",
      templateKey: "workspace",
      audienceId: null,
      content: { "en-US": content },
    });

    expect(
      Schema.decodeUnknownSync(AdministrationCampaignCreateInput)(
        create({ ...texts, bodyDocument })
      ).content["en-US"]
    ).toEqual({ ...texts, bodyDocument });
    for (const content of [
      texts,
      { ...texts, bodyMarkdown: "Hi", bodyDocument },
      { ...texts, bodyDocument: { ...bodyDocument, formatVersion: 2 } },
      { ...texts, bodyDocument: { ...bodyDocument, extra: true } },
      { ...texts, bodyDocument: { formatVersion: 1, doc: { text: "Hi" } } },
    ]) {
      expect(decodes(AdministrationCampaignCreateInput, create(content))).toBe(
        false
      );
    }

    expect(
      decodes(AdministrationCampaignUpdateInput, {
        content: { "en-US": { bodyDocument } },
      })
    ).toBe(true);
    expect(
      decodes(AdministrationCampaignUpdateInput, {
        content: { "en-US": { bodyMarkdown: "Hi", bodyDocument } },
      })
    ).toBe(false);
    expect(
      decodes(AdministrationCampaignTemplatePreviewInput, {
        _tag: "UnfinishedContent",
        purpose: "operational",
        locale: "en-US",
        content: { ...texts, bodyDocument },
      })
    ).toBe(true);
  });

  test("expresses removals in a campaign update", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationCampaignUpdateInput)({
        audienceId: null,
        content: {
          "cs-CZ": { subject: "Novinky", operationalReason: null },
          "en-US": null,
        },
      })
    ).toEqual({
      audienceId: null,
      content: {
        "cs-CZ": { subject: "Novinky", operationalReason: null },
        "en-US": null,
      },
    });
    expect(decodes(AdministrationCampaignUpdateInput, {})).toBe(true);
  });

  test("requires a confirmation code for the real send", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationCampaignSendInput)({
        confirmationCode: " ABC123 ",
      })
    ).toEqual({ confirmationCode: "ABC123" });
    expect(decodes(AdministrationCampaignSendInput, {})).toBe(false);
    expect(
      decodes(AdministrationCampaignSendInput, { confirmationCode: "  " })
    ).toBe(false);
  });

  test("previews unsaved content, unfinished content or a saved campaign", () => {
    expect(
      decodes(AdministrationCampaignTemplatePreviewInput, {
        _tag: "Content",
        purpose: "marketing",
        locale: "cs-CZ",
        content: { subject: "Novinky", preheader: "", bodyMarkdown: "Ahoj" },
      })
    ).toBe(true);
    expect(
      decodes(AdministrationCampaignTemplatePreviewInput, {
        _tag: "UnfinishedContent",
        purpose: "operational",
        locale: "en-US",
        content: {
          subject: "",
          preheader: "",
          bodyMarkdown: "[[button: ]()]",
        },
      })
    ).toBe(true);
    expect(
      decodes(AdministrationCampaignTemplatePreviewInput, {
        _tag: "UnfinishedContent",
        purpose: "operational",
        locale: "en-US",
        content: { subject: "", preheader: "", bodyMarkdown: "" },
        campaignId: "01990000-0000-7000-8000-000000000001",
      })
    ).toBe(false);
    expect(
      decodes(AdministrationCampaignTemplatePreviewInput, {
        _tag: "Campaign",
        campaignId: "01990000-0000-7000-8000-000000000001",
        locale: "en-US",
      })
    ).toBe(true);
    expect(
      decodes(AdministrationCampaignTemplatePreviewInput, {
        _tag: "Campaign",
        locale: "en-US",
      })
    ).toBe(false);
  });

  test("reports an unsent campaign's status as no send", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationCampaignSendStatusResult)({
        send: null,
      })
    ).toEqual({ send: null });
  });

  const localeFilter = {
    attribute: "locale",
    _tag: "Condition",
    operator: "anyOf",
    value: ["cs-CZ"],
  };

  test("reports unconfirmed recipients and why a recipient was skipped", () => {
    const recipient = {
      customerId: "101",
      locale: "cs-CZ",
      statusUpdatedAt: "2026-10-14T10:00:00Z",
    };
    const status = (
      recipients: ReadonlyArray<Record<string, unknown>>
    ): unknown => ({
      send: {
        sendId: "send-1",
        createdAt: "2026-10-14T10:00:00Z",
        completedAt: null,
        audienceId: null,
        audienceFilter: localeFilter,
        counts: {
          pending: 0,
          sent: 0,
          delivered: 0,
          bounced: 0,
          complained: 0,
          failed: 0,
          unconfirmed: 1,
          skipped: 1,
        },
        recipients,
      },
    });

    expect(
      decodes(
        AdministrationCampaignSendStatusResult,
        status([
          { ...recipient, status: "unconfirmed", skipReason: null },
          {
            ...recipient,
            status: "skipped",
            skipReason: "outside-test-domain",
          },
        ])
      )
    ).toBe(true);
    expect(
      decodes(
        AdministrationCampaignSendStatusResult,
        status([{ ...recipient, status: "skipped", skipReason: "bored" }])
      )
    ).toBe(false);
  });

  test("states whether a retry includes unconfirmed recipients", () => {
    expect(
      decodes(AdministrationCampaignRetryInput, { includeUnconfirmed: true })
    ).toBe(true);
    expect(decodes(AdministrationCampaignRetryInput, {})).toBe(false);
    expect(
      decodes(AdministrationCampaignRetryInput, {
        includeUnconfirmed: false,
        includeSkipped: true,
      })
    ).toBe(false);
  });

  test("carries a request ID on every creation", () => {
    const requestId = "01990000-0000-7000-8000-000000000010";
    const campaign = {
      title: "News",
      purpose: "marketing",
      templateKey: "workspace",
      audienceId: null,
      content: {},
    };
    const audience = { title: "Everyone", filter: localeFilter };

    expect(
      decodes(AdministrationCampaignCreateRequest, { requestId, campaign })
    ).toBe(true);
    expect(decodes(AdministrationCampaignCreateRequest, { campaign })).toBe(
      false
    );
    expect(
      decodes(AdministrationCampaignCreateRequest, {
        requestId: "not-a-uuid",
        campaign,
      })
    ).toBe(false);
    expect(
      decodes(AdministrationCampaignAudienceCreateRequest, {
        requestId,
        audience,
      })
    ).toBe(true);
    expect(
      decodes(AdministrationCampaignAudienceCreateRequest, {
        requestId,
        ...audience,
      })
    ).toBe(false);
    expect(decodes(AdministrationCampaignDuplicateRequest, { requestId })).toBe(
      true
    );
    expect(decodes(AdministrationCampaignDuplicateRequest, {})).toBe(false);
  });
});

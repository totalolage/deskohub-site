import { describe, expect, mock, test } from "bun:test";
import {
  type DotyposCustomer,
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import {
  DotyposServiceMock,
  seededCustomerReads,
} from "@deskohub/dotypos/backend/service.mock";
import { testEmailAddress } from "@deskohub/test-email";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import type { AudienceFilter } from "../audience-filter";
import { campaignIdSchema } from "../campaign-identifiers";
import {
  type AudienceEvaluationContext,
  AudienceFactSource,
  type AudienceFactSource as AudienceFactSourceType,
  AudienceScope,
  audienceEvaluationAt,
} from "./audience-evaluation-context";
import { AudienceFactsService } from "./audience-facts.service";
import {
  type CampaignCandidateFacts,
  CampaignCandidateRepository,
} from "./campaign-candidate.repository";
import { CampaignRecipientService } from "./campaign-recipient.service";

const customerId = (value: string) => DotyposCustomerIdSchema.make(value);

const facts = (
  id: string,
  overrides: Partial<CampaignCandidateFacts> = {}
): CampaignCandidateFacts => ({
  dotyposCustomerId: customerId(id),
  hasAccount: false,
  accountLocale: null,
  latestReservationLocale: null,
  latestReservationAt: null,
  consentLocale: null,
  ...overrides,
});

const customer = (
  id: string,
  overrides: Partial<DotyposCustomer> = {}
): DotyposCustomer =>
  ({
    id,
    _cloudId: "cloud",
    email: testEmailAddress(`customer-${id}`),
    points: "0",
    flags: "0",
    display: true,
    deleted: false,
    ...overrides,
  }) as DotyposCustomer;

const everyone: AudienceFilter = {
  _tag: "Group",
  operator: "and",
  filters: [],
};

const resolve = async (input: {
  readonly candidates: readonly CampaignCandidateFacts[];
  readonly customers?: readonly DotyposCustomer[];
  readonly filter?: AudienceFilter;
  readonly purpose?: "marketing" | "operational";
  /** Received campaign emails per customer, for any query. */
  readonly receivedEmails?: ReadonlyMap<DotyposCustomerId, number>;
  readonly dotypos?: Parameters<typeof DotyposServiceMock>[0];
  readonly scope?: AudienceScope;
  readonly context?: AudienceEvaluationContext;
  readonly facts?: AudienceFactSourceType;
}) => {
  const listCandidates = mock(() => Effect.succeed(input.candidates));
  const countReceivedCampaignEmails = mock(() =>
    Effect.succeed(input.receivedEmails ?? new Map())
  );
  const getCustomers = mock((ids: readonly DotyposCustomerId[]) =>
    Effect.succeed(
      (input.customers ?? []).filter(
        ({ id }) => id !== undefined && ids.includes(id)
      )
    ).pipe(
      Effect.map(
        (customers) =>
          new Map(
            customers.flatMap((customer) =>
              customer.id === undefined
                ? []
                : [[customer.id, customer] as const]
            )
          )
      )
    )
  );
  const exit = await Effect.runPromiseExit(
    CampaignRecipientService.pipe(
      Effect.flatMap((service) =>
        service.resolve({
          purpose: input.purpose ?? "operational",
          filter: input.filter ?? everyone,
          ...(input.scope && { scope: input.scope }),
          ...(input.context && { context: input.context }),
          ...(input.facts && { facts: input.facts }),
        })
      )
    ).pipe(
      Effect.provide(
        CampaignRecipientService.Default.pipe(
          Layer.provide(AudienceFactsService.Default),
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(CampaignCandidateRepository)({
                listCandidates,
                countReceivedCampaignEmails,
              }),
              DotyposServiceMock({
                getCustomersByIds: getCustomers,
                ...input.dotypos,
              })
            )
          )
        )
      )
    )
  );
  return { exit, listCandidates, countReceivedCampaignEmails, getCustomers };
};

const resolution = (exit: Awaited<ReturnType<typeof resolve>>["exit"]) => {
  if (Exit.isFailure(exit)) throw new Error("resolution failed");
  return exit.value;
};

describe("CampaignRecipientService.resolve", () => {
  test("limits marketing campaigns to the consented candidate pool", async () => {
    const { listCandidates } = await resolve({
      candidates: [],
      purpose: "marketing",
    });
    expect(listCandidates).toHaveBeenCalledWith({ purpose: "marketing" });
  });

  test("limits the candidates and counts to a customer scope", async () => {
    const { listCandidates, countReceivedCampaignEmails } = await resolve({
      candidates: [],
      purpose: "marketing",
      scope: AudienceScope.Customers({ ids: [customerId("1")] }),
      filter: {
        attribute: "campaignEmailCount",
        _tag: "Condition",
        params: { purpose: "any", period: { _tag: "AnyTime" } },
        operator: "eq",
        value: 0,
      },
    });
    expect(listCandidates).toHaveBeenCalledWith({
      purpose: "marketing",
      ids: [customerId("1")],
    });
    expect(countReceivedCampaignEmails).toHaveBeenCalledWith({
      dispatched: {},
      customers: [customerId("1")],
    });
  });

  test("evaluates in the given context", async () => {
    const campaignId = campaignIdSchema.make("campaign-1");
    const { countReceivedCampaignEmails } = await resolve({
      candidates: [],
      context: {
        ...audienceEvaluationAt(Temporal.Instant.from("2026-10-15T10:00:00Z")),
        campaignId: Option.some(campaignId),
      },
      filter: {
        attribute: "campaignEmailCount",
        _tag: "Condition",
        params: {
          purpose: "any",
          period: { _tag: "Past" },
          campaign: { _tag: "This" },
        },
        operator: "eq",
        value: 0,
      },
    });
    expect(countReceivedCampaignEmails).toHaveBeenCalledWith({
      campaignId,
      dispatched: {
        startsAtOrBefore: Temporal.Instant.from("2026-10-15T10:00:00Z"),
      },
    });
  });

  test("resolves the recipient locale from account, reservation, consent, then Czech", async () => {
    const { exit } = await resolve({
      candidates: [
        facts("1", { accountLocale: "en-US", consentLocale: "cs-CZ" }),
        facts("2", { latestReservationLocale: "en-US" }),
        facts("3"),
      ],
      customers: [customer("1"), customer("2"), customer("3")],
    });
    expect(
      resolution(exit).recipients.map(({ dotyposCustomerId, locale }) => [
        dotyposCustomerId,
        locale,
      ])
    ).toEqual([
      ["1", "en-US"],
      ["2", "en-US"],
      ["3", "cs-CZ"],
    ]);
  });

  test("drops customers local conditions rule out before calling Dotypos", async () => {
    const { exit, getCustomers } = await resolve({
      candidates: [facts("1", { hasAccount: true }), facts("2")],
      customers: [customer("1"), customer("2")],
      filter: {
        attribute: "hasAccount",
        _tag: "Condition",
        operator: "is",
        value: true,
      },
    });
    expect(getCustomers).toHaveBeenCalledTimes(1);
    expect(getCustomers.mock.calls[0]?.[0]).toEqual(["1"]);
    expect(
      resolution(exit).recipients.map(
        ({ dotyposCustomerId }) => dotyposCustomerId
      )
    ).toEqual(["1"]);
  });

  test("delegates the full survivor selection to the sequential ID read", async () => {
    const candidates = Array.from({ length: 250 }, (_, index) =>
      facts(String(index).padStart(3, "0"))
    );
    const { getCustomers } = await resolve({
      candidates,
      customers: candidates.map(({ dotyposCustomerId }) =>
        customer(dotyposCustomerId)
      ),
    });
    expect(getCustomers.mock.calls.map(([ids]) => ids.length)).toEqual([250]);
  });

  test("applies Dotypos tag and discount-group conditions after hydration", async () => {
    const { exit } = await resolve({
      candidates: [facts("1"), facts("2"), facts("3")],
      customers: [
        customer("1", { tags: ["vip"] }),
        customer("2", { tags: ["vip"], _discountGroupId: null }),
        customer("3", { tags: [] }),
      ],
      filter: {
        _tag: "Group",
        operator: "and",
        filters: [
          {
            attribute: "dotyposTags",
            _tag: "Condition",
            operator: "anyOf",
            value: ["vip"],
          },
          {
            _tag: "Group",
            operator: "or",
            filters: [
              {
                attribute: "locale",
                _tag: "Condition",
                operator: "anyOf",
                value: ["cs-CZ"],
              },
              {
                attribute: "discountGroup",
                _tag: "Condition",
                operator: "anyOf",
                value: ["gold"],
              },
            ],
          },
        ],
      },
    });
    expect(
      resolution(exit).recipients.map(
        ({ dotyposCustomerId }) => dotyposCustomerId
      )
    ).toEqual(["1", "2"]);
  });

  test("uses fetched profiles for tags and excludes customers absent from Dotypos", async () => {
    const { exit, getCustomers } = await resolve({
      candidates: [facts("1"), facts("2"), facts("3")],
      facts: AudienceFactSource.Fetched({
        visits: Option.none(),
        profiles: Option.some(
          new Map<DotyposCustomerId, DotyposCustomer>([
            [customerId("1"), customer("1", { tags: ["vip"] })],
            [customerId("2"), customer("2", { tags: [] })],
          ])
        ),
      }),
      filter: {
        attribute: "dotyposTags",
        _tag: "Condition",
        operator: "anyOf",
        value: ["vip"],
      },
    });

    expect(getCustomers).not.toHaveBeenCalled();
    expect(
      resolution(exit).recipients.map(
        ({ dotyposCustomerId }) => dotyposCustomerId
      )
    ).toEqual([customerId("1")]);
    expect(resolution(exit).exclusions).toEqual([
      {
        dotyposCustomerId: customerId("3"),
        reason: "missing-from-dotypos",
      },
    ]);
  });

  test("lists matching customers it can't reach with a reason", async () => {
    const { exit } = await resolve({
      candidates: ["1", "2", "3", "4", "5"].map((id) => facts(id)),
      customers: [
        customer("2", { deleted: true }),
        customer("3", { email: "  " }),
        customer("4", { email: "not-an-address" }),
        customer("5"),
      ],
    });
    const { recipients, exclusions } = resolution(exit);
    expect(exclusions).toEqual([
      { dotyposCustomerId: customerId("1"), reason: "missing-from-dotypos" },
      { dotyposCustomerId: customerId("2"), reason: "deleted-customer" },
      { dotyposCustomerId: customerId("3"), reason: "missing-email" },
      { dotyposCustomerId: customerId("4"), reason: "invalid-email" },
    ]);
    expect(
      recipients.map(({ dotyposCustomerId }) => dotyposCustomerId)
    ).toEqual(["5"]);
  });

  test("mails one record per address and reports the duplicate group", async () => {
    const shared = testEmailAddress("shared");
    const run = async (order: readonly string[]) =>
      resolution(
        (
          await resolve({
            candidates: order.map((id) =>
              facts(id, {
                latestReservationAt:
                  id === "b"
                    ? Temporal.Instant.from("2026-05-01T00:00:00Z")
                    : null,
              })
            ),
            customers: [
              customer("a", { email: shared.toUpperCase() }),
              customer("b", { email: ` ${shared}` }),
              customer("c", { email: shared }),
            ],
          })
        ).exit
      );
    const forward = await run(["a", "b", "c"]);
    expect(await run(["c", "b", "a"])).toEqual(forward);
    expect(forward.recipients).toEqual([
      { dotyposCustomerId: customerId("b"), locale: "cs-CZ", email: shared },
    ]);
    expect(forward.duplicates).toEqual([
      {
        email: shared,
        recipientCustomerId: customerId("b"),
        duplicateCustomerIds: [customerId("a"), customerId("c")],
      },
    ]);
  });

  test("counts within the candidate pool, so = 0 and < N include customers without records", async () => {
    const receivedEmails = (operator: "eq" | "lt", value: number) =>
      resolve({
        candidates: [facts("1"), facts("2"), facts("3")],
        customers: [customer("1"), customer("2"), customer("3")],
        receivedEmails: new Map([
          [customerId("1"), 3],
          [customerId("2"), 1],
        ]),
        filter: {
          attribute: "campaignEmailCount",
          _tag: "Condition",
          params: {
            purpose: "marketing",
            period: { _tag: "Last", count: 10, unit: "day" },
          },
          operator,
          value,
        },
      });
    const ids = async (pending: ReturnType<typeof receivedEmails>) =>
      resolution((await pending).exit).recipients.map(
        ({ dotyposCustomerId }) => dotyposCustomerId
      );
    expect(await ids(receivedEmails("eq", 0))).toEqual(["3"]);
    expect(await ids(receivedEmails("lt", 2))).toEqual(["2", "3"]);
  });

  test("fails the whole resolution with a retryable error when Dotypos fails", async () => {
    const { exit } = await resolve({
      candidates: [facts("1"), facts("2")],
      dotypos: {
        getCustomersByIds: (ids) =>
          Effect.fail(
            new DotyposUnavailable({
              operation: "getCustomersByIds",
              reason: "transport",
            })
          ).pipe(
            Effect.flatMap((records) =>
              seededCustomerReads(records).getCustomersByIds(ids)
            )
          ),
      },
    });
    expect(Exit.isFailure(exit) && Cause.squash(exit.cause)).toMatchObject({
      _tag: "CampaignRecipientResolutionError",
      source: "dotypos",
    });
  });
});

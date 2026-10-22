import { describe, expect, test } from "bun:test";
import { Context, Option, Result, Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  CampaignRef,
  campaignOperationEndpoints,
  campaignOperations,
  defineOperations,
  type LedgerOperationName,
  OperationInputInvalid,
  operationEndpoints,
  query,
} from "./campaign-operations";
import { MinimumDhwVersion } from "./dhw-version";
import { AdminCliAutomationsApi } from "./email-automations";
import { AdminCliCampaignsApi } from "./email-campaigns";

const operationGroups = [AdminCliCampaignsApi, AdminCliAutomationsApi];

describe("campaign operations", () => {
  // test.each clones its cases, so the cases are names. The endpoint holds
  // its success schema's JSON codec, so the two compare as JSON Schema.
  const names = Object.keys(campaignOperations) as Array<
    keyof typeof campaignOperations
  >;

  test.each(names)(
    "%s has an endpoint of its name answering with its output",
    (name) => {
      const endpoint = campaignOperationEndpoints[name];
      const { output } = campaignOperations[name];

      expect(endpoint.name).toBe(name);
      expect(
        [...endpoint.success].map((schema) =>
          Schema.toJsonSchemaDocument(schema)
        )
      ).toEqual([Schema.toJsonSchemaDocument(output)]);
    }
  );

  test.each(names)(
    "%s requires the same dhw version as its endpoint",
    (name) => {
      const endpoint = campaignOperationEndpoints[name];
      const group = operationGroups.find((candidate) =>
        Object.hasOwn(candidate.endpoints, name)
      );

      expect(group).toBeDefined();
      expect(
        Option.getOrUndefined(
          Context.get(
            Context.merge(
              group?.annotations ?? Context.empty(),
              endpoint.annotations
            ),
            MinimumDhwVersion
          )
        )
      ).toBe(campaignOperations[name].minimumDhwVersion);
    }
  );

  test("an operation without an endpoint fails the typecheck", () => {
    const operations = defineOperations({
      getThing: query({ input: CampaignRef, output: Schema.String }),
      listThings: query({ input: CampaignRef, output: Schema.String }),
    });
    const group = HttpApiGroup.make("things").add(
      HttpApiEndpoint.get("getThing", "/things", { success: Schema.String })
    );

    // @ts-expect-error listThings has no endpoint
    const endpoints = operationEndpoints(operations, [group]);

    expect(endpoints.listThings).toBeUndefined();
  });

  test.each([
    ["listCampaigns", {}],
    ["getCampaign", { campaignId: "campaign-1" }],
    [
      "previewCampaignTemplate",
      {
        templateKey: "workspace",
        preview: {
          _tag: "Campaign",
          campaignId: "campaign-1",
          locale: "cs-CZ",
        },
      },
    ],
    ["sendCampaign", { campaignId: "campaign-1", confirmationCode: "code" }],
    [
      "activateAutomation",
      { campaignId: "campaign-1", previewId: "preview-1" },
    ],
    ["getAutomationEngineHealth", {}],
    [
      "listAutomationRuns",
      { campaignId: "campaign-1", state: "active", limit: 100 },
    ],
  ] as const)("%s rejects an unknown key", (name, input) => {
    const decode = Schema.decodeUnknownResult(
      campaignOperations[name].input as Schema.Decoder<unknown>
    );

    expect(Result.isSuccess(decode(input))).toBe(true);
    expect(Result.isFailure(decode({ ...input, unexpected: true }))).toBe(true);
  });

  test("knows the ledger operations by type", () => {
    const ledgerOperations: ReadonlyArray<
      LedgerOperationName<typeof campaignOperations>
    > = ["createCampaign", "createCampaignAudience", "duplicateCampaign"];
    // @ts-expect-error a query never goes through the ledger
    const notLedger: LedgerOperationName<typeof campaignOperations> =
      "getCampaign";

    expect(
      Object.values(campaignOperations)
        .filter(({ ledger }) => ledger)
        .map(({ name }) => name)
        .sort()
    ).toEqual([...ledgerOperations]);
    expect<string>(notLedger).toBe("getCampaign");
  });

  test("records name, kind and ledger", () => {
    expect(campaignOperations.createCampaign).toMatchObject({
      name: "createCampaign",
      kind: "mutation",
      ledger: true,
    });
    expect(campaignOperations.getCampaign).toMatchObject({
      name: "getCampaign",
      kind: "query",
      ledger: false,
    });
  });

  test("an error category keeps its code, message, issues and cause", () => {
    const cause = new Error("domain failure");
    const error = new OperationInputInvalid({
      code: "flow-invalid",
      message: "The flow needs a send step.",
      issues: [{ path: ["flow", "steps"], message: "Missing send step." }],
      cause,
    });

    expect(error._tag).toBe("OperationInputInvalid");
    expect(error.code).toBe("flow-invalid");
    expect(error.cause).toBe(cause);
  });
});

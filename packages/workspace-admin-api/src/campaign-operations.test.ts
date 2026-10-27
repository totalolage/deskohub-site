import { describe, expect, test } from "bun:test";
import { Result, Schema } from "effect";
import {
  campaignOperations,
  type LedgerOperationName,
  OperationInputInvalid,
} from "./campaign-operations";

describe("campaign operations", () => {
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

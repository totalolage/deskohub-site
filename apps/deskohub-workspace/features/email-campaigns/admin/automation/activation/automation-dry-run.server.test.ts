import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import { OperationNotFound } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { stubCampaignPageQueries } from "../../campaign-operation-query.test-utils";
import { automationDetailFixture } from "./automation-detail.test-utils";
import { automationDryRunFixture } from "./automation-dry-run.test-utils";

const port = stubCampaignPageQueries();

const { loadAutomationDryRun } = await import("./automation-dry-run.server");

const dryRunInputs = () =>
  port.invoked
    .filter((call) => call.name === "getAutomationDryRun")
    .map(({ input }) => input);

const running = {
  _tag: "PreviewRunning",
  previewId: "preview-running",
  unitsDone: 1,
  unitsTotal: 4,
};
const ready = { _tag: "Ready", previewId: "preview-ready", draftHash: "hash" };

beforeEach(() => {
  port.access.set("administrator");
  port.invoked.length = 0;
  port.responses = {
    getAutomationDryRun: Effect.succeed(automationDryRunFixture()),
  };
});

describe("loadAutomationDryRun", () => {
  test.each([
    ["running", running, "preview-running"],
    ["ready", ready, "preview-ready"],
  ] as const)(
    "loads the %s job activation names, over the URL's preview",
    async (_, activation, previewId) => {
      const dryRun = await loadAutomationDryRun(
        automationDetailFixture({ activation }),
        { preview: "preview-from-url" }
      );

      expect(dryRunInputs()).toEqual([{ previewId }]);
      expect(dryRun).toEqual(automationDryRunFixture());
    }
  );

  test("falls back to the URL's preview and passes its cursor", async () => {
    await loadAutomationDryRun(automationDetailFixture(), {
      preview: "preview-from-url",
      cursor: "cursor-2",
    });

    expect(dryRunInputs()).toEqual([
      { previewId: "preview-from-url", cursor: "cursor-2" },
    ]);
  });

  test("loads nothing without a job to show", async () => {
    const withoutPreview = await loadAutomationDryRun(
      automationDetailFixture(),
      {}
    );
    const emptyPreview = await loadAutomationDryRun(
      automationDetailFixture({ activation: { _tag: "Published" } }),
      { preview: "" }
    );

    expect(withoutPreview).toBeUndefined();
    expect(emptyPreview).toBeUndefined();
    expect(dryRunInputs()).toEqual([]);
  });

  test("shows nothing for an expired job", async () => {
    port.responses.getAutomationDryRun = Effect.fail(
      new OperationNotFound({ code: "preview-not-found", message: "gone" })
    );

    expect(
      await loadAutomationDryRun(automationDetailFixture(), {
        preview: "preview-expired",
      })
    ).toBeUndefined();
  });

  test("shows nothing for another campaign's job", async () => {
    port.responses.getAutomationDryRun = Effect.succeed(
      automationDryRunFixture({ campaignId: "another-campaign" })
    );

    expect(
      await loadAutomationDryRun(automationDetailFixture(), {
        preview: "preview-elsewhere",
      })
    ).toBeUndefined();
  });
});

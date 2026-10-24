import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { automationServiceStubs } from "../backend/campaign-operations.test-utils";
import type { ICampaignSendService } from "../backend/campaign-send.service";
import {
  campaignAudienceIdSchema,
  campaignIdSchema,
} from "../campaign-identifiers";
import { CampaignConfirmationRejected, CampaignReadOnly } from "../errors";

const revalidatePath = mock((_path: string) => undefined);

mock.module("next/cache", () => ({
  revalidatePath,
  revalidateTag: () => undefined,
}));
mock.module("next/server", () => ({
  after: () => undefined,
  connection: async () => undefined,
}));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () => new Headers({ referer: "https://deskohub.test/en-US" }),
}));

const operationsModule = await import("../backend/campaign-operations.service");
const grantsModule = await import(
  "@/features/administrators/backend/account-role-grants.service"
);
const audienceModule = await import("../backend/campaign-audience.service");
const campaignModule = await import("../backend/campaign.service");
const recipientModule = await import("../backend/campaign-recipient.service");
const sendModule = await import("../backend/campaign-send.service");
const sendStatusModule = await import(
  "../backend/campaign-send-status.service"
);
const realAuthorizationModule = await import(
  "@/features/administrators/server/administrator-authorization.server"
);
const realUnauthorizedError = await Effect.runPromise(
  Effect.flip(realAuthorizationModule.requireAdministratorAuthorization)
);

const administrator = {
  accountId: "synthetic-administrator-account",
  email: "synthetic-administrator",
};
let authorizationResult: Effect.Effect<unknown, unknown> =
  Effect.succeed(administrator);
mock.module(
  "@/features/administrators/server/administrator-authorization.server",
  () => ({
    requireAdministratorAuthorization: Effect.suspend(
      () => authorizationResult
    ),
  })
);

const campaignId = campaignIdSchema.make("synthetic-campaign");
const audienceId = campaignAudienceIdSchema.make("synthetic-audience");
const syntheticInstant = Temporal.Instant.from("2026-10-01T08:00:00Z");
const archivedAudience = {
  id: audienceId,
  title: "Synthetic audience",
  filter: { _tag: "Group", operator: "and", filters: [] },
  archivedAt: syntheticInstant,
  createdAt: syntheticInstant,
  updatedAt: syntheticInstant,
};
const archiveAudience = mock((_audienceId: string) =>
  Effect.succeed(archivedAudience)
);

let holdsGrant = true;
let sendResult: Effect.Effect<unknown, unknown> = Effect.succeed({});
let deleteResult: Effect.Effect<unknown, unknown> = Effect.void;
const deleteCampaign = mock((_campaignId: string) => deleteResult);
const send = mock(
  (_input: Parameters<ICampaignSendService["send"]>[0]) => sendResult
);

const stubbedDomain = Layer.mergeAll(
  Layer.succeed(
    grantsModule.AccountRoleGrants,
    grantsModule.AccountRoleGrants.of({
      has: () => Effect.succeed(holdsGrant),
    } as never)
  ),
  Layer.succeed(
    audienceModule.CampaignAudienceService,
    audienceModule.CampaignAudienceService.of({
      archive: archiveAudience,
    } as never)
  ),
  Layer.succeed(
    campaignModule.CampaignService,
    campaignModule.CampaignService.of({ delete: deleteCampaign } as never)
  ),
  Layer.succeed(
    recipientModule.CampaignRecipientService,
    recipientModule.CampaignRecipientService.of({} as never)
  ),
  Layer.succeed(
    sendModule.CampaignSendService,
    sendModule.CampaignSendService.of({ send } as never)
  ),
  Layer.succeed(
    sendStatusModule.CampaignSendStatusService,
    sendStatusModule.CampaignSendStatusService.of({} as never)
  ),
  automationServiceStubs()
);

// The real port over stubbed domain services.
class StubbedCampaignOperations extends operationsModule.CampaignOperations {
  static override Live = operationsModule.CampaignOperations.Default.pipe(
    Layer.provide(stubbedDomain)
  );
}

mock.module("../backend/campaign-operations.service", () => ({
  ...operationsModule,
  CampaignOperations: StubbedCampaignOperations,
}));

const { runCampaignOperation } = await import("./campaign-operations.actions");
const { CurrentAdministrator } = await import(
  "@/features/administrators/backend/current-administrator"
);
const { OperationRequestLedger } = await import(
  "../backend/operation-request-ledger.service"
);
const { toCampaignPreviewInput } = await import(
  "./composer/campaign-composer-fields"
);

beforeEach(() => {
  authorizationResult = Effect.succeed(administrator);
  holdsGrant = true;
  sendResult = Effect.succeed({});
  deleteResult = Effect.void;
  deleteCampaign.mockClear();
  send.mockClear();
  revalidatePath.mockClear();
});

describe("runCampaignOperation", () => {
  test("returns a query's output without revalidating", async () => {
    const result = await runCampaignOperation({
      operation: "listCampaignTemplates",
      input: {},
    });

    expect(result?.data).toEqual({
      _tag: "Success",
      output: [expect.objectContaining({ key: "workspace" })],
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("revalidates the campaign pages after a mutation succeeds", async () => {
    const result = await runCampaignOperation({
      operation: "deleteCampaign",
      input: { campaignId },
    });

    expect(result?.data).toEqual({
      _tag: "Success",
      output: { id: campaignId },
    });
    expect(deleteCampaign).toHaveBeenCalledWith(campaignId);
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        "/en-US/admin/email-campaigns",
        "/cs-CZ/admin/email-campaigns",
        "/en-US/admin/email-audiences",
        `/en-US/admin/email-campaigns/${campaignId}`,
        `/cs-CZ/admin/email-campaigns/${campaignId}`,
      ])
    );
  });

  test("revalidates an audience's page after an audience mutation", async () => {
    const result = await runCampaignOperation({
      operation: "archiveCampaignAudience",
      input: { audienceId },
    });

    expect(result?.data).toMatchObject({
      _tag: "Success",
      output: { id: audienceId, archivedAt: syntheticInstant.toString() },
    });
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual(
      expect.arrayContaining([
        "/en-US/admin/email-audiences",
        `/en-US/admin/email-audiences/${audienceId}`,
        `/cs-CZ/admin/email-audiences/${audienceId}`,
      ])
    );
  });

  test("returns a domain failure as data with its category and code", async () => {
    sendResult = Effect.fail(
      new CampaignConfirmationRejected({ campaignId, reason: "expired" })
    );

    const result = await runCampaignOperation({
      operation: "sendCampaign",
      input: { campaignId, confirmationCode: "ABCD-1234" },
    });

    expect(result?.data).toEqual({
      _tag: "Failure",
      category: "OperationConflict",
      code: "confirmation-expired",
      message: expect.any(String),
    });
    expect(result?.serverError).toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("doesn't revalidate after a failed mutation", async () => {
    deleteResult = Effect.fail(
      new CampaignReadOnly({ campaignId, status: "sent" } as never)
    );

    const result = await runCampaignOperation({
      operation: "deleteCampaign",
      input: { campaignId },
    });

    expect(result?.data).toMatchObject({
      _tag: "Failure",
      category: "OperationConflict",
      code: "campaign-read-only",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("refuses a caller without an administrator session", async () => {
    authorizationResult = Effect.fail(realUnauthorizedError);

    const result = await runCampaignOperation({
      operation: "deleteCampaign",
      input: { campaignId },
    });

    expect(result?.data).toMatchObject({
      _tag: "Failure",
      category: "OperationUnauthorized",
      code: "administrator-required",
    });
    expect(deleteCampaign).not.toHaveBeenCalled();
  });

  test("refuses an administrator whose grant was revoked", async () => {
    holdsGrant = false;

    const result = await runCampaignOperation({
      operation: "deleteCampaign",
      input: { campaignId },
    });

    expect(result?.data).toMatchObject({
      _tag: "Failure",
      category: "OperationUnauthorized",
      code: "administrator-required",
    });
    expect(deleteCampaign).not.toHaveBeenCalled();
  });

  test("returns input the port rejects as an invalid-input failure", async () => {
    const result = await runCampaignOperation({
      operation: "deleteCampaign",
      input: { campaignId, unexpected: true } as never,
    });

    expect(result?.data).toMatchObject({
      _tag: "Failure",
      category: "OperationInputInvalid",
      code: "input-invalid",
    });
    expect(deleteCampaign).not.toHaveBeenCalled();
  });

  test("rejects an operation the registry doesn't know", async () => {
    const result = await runCampaignOperation({
      operation: "dropAllCampaigns" as never,
      input: {},
    });

    expect(result?.data).toBeUndefined();
    expect(result?.validationErrors).toBeDefined();
  });
});

describe("composer preview", () => {
  /** The port itself, without the Admin UI bridge in between. */
  const invokePort = (input: ReturnType<typeof toCampaignPreviewInput>) =>
    Effect.runPromiseExit(
      operationsModule.CampaignOperations.pipe(
        Effect.flatMap((operations) =>
          operations.invoke("previewCampaignTemplate", input)
        ),
        Effect.provideService(CurrentAdministrator, administrator as never),
        Effect.provide(
          Layer.mergeAll(
            OperationRequestLedger.unscoped,
            StubbedCampaignOperations.Live
          )
        )
      )
    );

  const link = (href: string | null) => ({
    type: "paragraph",
    content: [
      { type: "text", text: "Visit " },
      {
        type: "text",
        text: "our site",
        marks: [{ type: "link", attrs: { href } }],
      },
    ],
  });

  const previewInput = (...content: ReadonlyArray<object>) =>
    toCampaignPreviewInput({
      templateKey: "workspace",
      purpose: "operational",
      locale: "en-US",
      fields: {
        subject: " Synthetic news ",
        preheader: "Synthetic preheader",
        body: { type: "doc", content } as never,
        operationalReason: "",
      },
    });

  const strict = (input: ReturnType<typeof previewInput>) => ({
    ...input,
    preview: { ...input.preview, _tag: "Content" as const },
  });

  test("renders unfinished buttons and links as the port does", async () => {
    const input = previewInput(
      link(""),
      link("htt"),
      { type: "ctaButton", attrs: { label: "", href: null } },
      { type: "ctaButton", attrs: { label: "Book", href: "javascript:x" } }
    );

    const direct = await invokePort(input);
    const bridged = await runCampaignOperation({
      operation: "previewCampaignTemplate",
      input,
    });

    expect(Exit.isSuccess(direct)).toBe(true);
    if (!Exit.isSuccess(direct)) return;
    expect(direct.value.subject).toBe("Synthetic news");
    expect(direct.value.html).toContain("our site");
    expect(direct.value.html).toContain("Book");
    expect(bridged?.data).toEqual({ _tag: "Success", output: direct.value });
  });

  test("refuses the same unfinished content as unsaved content", async () => {
    const input = strict(
      previewInput({ type: "ctaButton", attrs: { label: "", href: null } })
    );

    const direct = await invokePort(input);
    const bridged = await runCampaignOperation({
      operation: "previewCampaignTemplate",
      input,
    });

    expect(Exit.isFailure(direct)).toBe(true);
    expect(bridged?.data).toMatchObject({
      _tag: "Failure",
      category: "OperationInputInvalid",
      code: "content-document-invalid",
    });
  });

  test("renders finished content the same in either mode", async () => {
    const input = previewInput(link("https://workspace.deskohub.cz"), {
      type: "ctaButton",
      attrs: { label: "Book", href: "https://workspace.deskohub.cz" },
    });

    const unfinished = await runCampaignOperation({
      operation: "previewCampaignTemplate",
      input,
    });
    const finished = await runCampaignOperation({
      operation: "previewCampaignTemplate",
      input: strict(input),
    });

    expect(unfinished?.data?._tag).toBe("Success");
    expect(unfinished?.data).toEqual(finished?.data);
  });
});

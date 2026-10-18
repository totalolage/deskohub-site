import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { SqlError } from "effect/unstable/sql";
import type { ICampaignService } from "../../backend/campaign.service";
import type { ICampaignSendService } from "../../backend/campaign-send.service";
import { campaignIdSchema } from "../../campaign-identifiers";
import { CampaignConfirmationRejected } from "../../errors";

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

const sendServiceModule = await import("../../backend/campaign-send.service");
const campaignServiceModule = await import("../../backend/campaign.service");
const realAuthorizationModule = await import(
  "@/features/administrators/server/administrator-authorization.server"
);
const realUnauthorizedError = await Effect.runPromise(
  Effect.flip(realAuthorizationModule.requireAdministratorAuthorization)
);

let authorizationCalls = 0;
let authorizationResult: Effect.Effect<unknown, unknown> =
  Effect.succeed("Fixture Operator");
const authorization = Effect.suspend(() => {
  authorizationCalls += 1;
  return authorizationResult;
});

mock.module(
  "@/features/administrators/server/administrator-authorization.server",
  () => ({ requireAdministratorAuthorization: authorization })
);

const campaignId = campaignIdSchema.make("synthetic-campaign");
const duplicateCampaignId = campaignIdSchema.make("synthetic-copy");
const sendReceipt = { sendId: "synthetic-send", recipientCount: 2 };

let testSendResult: Effect.Effect<unknown, unknown> = Effect.succeed({});
let sendResult: Effect.Effect<unknown, unknown> = Effect.succeed(sendReceipt);
let retryResult: Effect.Effect<unknown, unknown> = Effect.succeed({});
let duplicateResult: Effect.Effect<unknown, unknown> = Effect.succeed({
  id: duplicateCampaignId,
});

const testSendCalls: Parameters<ICampaignSendService["testSend"]>[0][] = [];
const sendCalls: Parameters<ICampaignSendService["send"]>[0][] = [];
const retryCalls: Parameters<ICampaignSendService["retryUndelivered"]>[0][] =
  [];
const duplicateCalls: Parameters<ICampaignService["duplicate"]>[0][] = [];

const testSend = mock(
  (input: Parameters<ICampaignSendService["testSend"]>[0]) => {
    testSendCalls.push(input);
    return testSendResult;
  }
);
const send = mock((input: Parameters<ICampaignSendService["send"]>[0]) => {
  sendCalls.push(input);
  return sendResult;
});
const retryUndelivered = mock(
  (input: Parameters<ICampaignSendService["retryUndelivered"]>[0]) => {
    retryCalls.push(input);
    return retryResult;
  }
);
const duplicate = mock(
  (input: Parameters<ICampaignService["duplicate"]>[0]) => {
    duplicateCalls.push(input);
    return duplicateResult;
  }
);

const sendServiceLive = Layer.succeed(
  sendServiceModule.CampaignSendService,
  sendServiceModule.CampaignSendService.of({
    testSend,
    send,
    retryUndelivered,
  } as never)
);

class StubCampaignSendService extends sendServiceModule.CampaignSendService {
  static override Live = sendServiceLive;
}

mock.module("../../backend/campaign-send.service", () => ({
  ...sendServiceModule,
  CampaignSendService: StubCampaignSendService,
}));

const campaignServiceLive = Layer.succeed(
  campaignServiceModule.CampaignService,
  campaignServiceModule.CampaignService.of({ duplicate } as never)
);

class StubCampaignService extends campaignServiceModule.CampaignService {
  static override Live = campaignServiceLive;
}

mock.module("../../backend/campaign.service", () => ({
  ...campaignServiceModule,
  CampaignService: StubCampaignService,
}));

// Every tag's copy is covered in campaign-sending-failure.test.ts; these
// cases prove the actions route typed failures through that mapping.
const sendFailureCases = [
  {
    name: "unknown confirmation code",
    error: new CampaignConfirmationRejected({
      campaignId,
      reason: "unknown-code",
    }),
    serverError:
      "That code doesn't match the latest test email. Check it for typos and try again.",
  },
  {
    name: "SQL failure",
    error: new SqlError.SqlError({
      reason: new SqlError.UnknownError({
        cause: new Error("synthetic database failure"),
        message: "synthetic database failure",
        operation: "send",
      }),
    }),
    serverError: "Something went wrong. Try again in a moment.",
  },
] as const;

beforeEach(() => {
  authorizationCalls = 0;
  authorizationResult = Effect.succeed("Fixture Operator");
  testSendResult = Effect.succeed({});
  sendResult = Effect.succeed(sendReceipt);
  retryResult = Effect.succeed({});
  duplicateResult = Effect.succeed({ id: duplicateCampaignId });
  testSendCalls.length = 0;
  sendCalls.length = 0;
  retryCalls.length = 0;
  duplicateCalls.length = 0;
  revalidatePath.mockClear();
});

describe("email campaign sending actions", () => {
  test("maps the real administrator authorization error and skips the send service", async () => {
    authorizationResult = Effect.fail(realUnauthorizedError);

    const { sendCampaign } = await import("./actions");
    const result = await sendCampaign({
      campaignId,
      confirmationCode: "synthetic-code",
    });

    expect(result?.serverError).toBe(
      "Your admin sign-in is no longer valid. Reload the page and sign in again."
    );
    expect(authorizationCalls).toBe(1);
    expect(testSendCalls).toHaveLength(0);
    expect(sendCalls).toHaveLength(0);
    expect(retryCalls).toHaveLength(0);
  });

  test("validates input before authorization or send service calls", async () => {
    const { sendCampaign } = await import("./actions");

    const malformedCampaign = await sendCampaign({
      campaignId: "",
      confirmationCode: "synthetic-code",
    } as never);
    const missingConfirmationCode = await sendCampaign({
      campaignId,
    } as never);

    expect(malformedCampaign).toMatchObject({
      validationErrors: {
        fieldErrors: { campaignId: expect.any(Array) },
      },
    });
    expect(missingConfirmationCode).toMatchObject({
      validationErrors: {
        fieldErrors: { confirmationCode: expect.any(Array) },
      },
    });
    expect(authorizationCalls).toBe(0);
    expect(sendCalls).toHaveLength(0);
  });

  test.each(sendFailureCases)(
    "maps $name to the public send error",
    async ({ error, serverError }) => {
      sendResult = Effect.fail(error);

      const { sendCampaign } = await import("./actions");
      const result = await sendCampaign({
        campaignId,
        confirmationCode: "synthetic-code",
      });

      expect(result?.serverError).toBe(serverError);
      expect(sendCalls).toHaveLength(1);
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );

  test("revalidates the campaign list and sent campaign after a successful send", async () => {
    const { sendCampaign } = await import("./actions");

    const result = await sendCampaign({
      campaignId,
      confirmationCode: "synthetic-code",
    });

    expect(result?.data).toEqual(sendReceipt);
    expect(revalidatePath.mock.calls).toEqual([
      ["/en-US/admin/email-campaigns"],
      ["/cs-CZ/admin/email-campaigns"],
      [`/en-US/admin/email-campaigns/${campaignId}`],
      [`/cs-CZ/admin/email-campaigns/${campaignId}`],
    ]);
  });

  test.each([
    ["excludes", false],
    ["includes", true],
  ] as const)(
    "retries undelivered recipients and %s unconfirmed ones as chosen",
    async (_, includeUnconfirmed) => {
      retryResult = Effect.succeed({
        sendId: "synthetic-send",
        retriedCount: 3,
      });

      const { retryUndeliveredCampaignRecipients } = await import("./actions");
      const result = await retryUndeliveredCampaignRecipients({
        campaignId,
        includeUnconfirmed,
      });

      expect(result?.data).toEqual({
        sendId: "synthetic-send",
        retriedCount: 3,
      });
      expect(retryCalls).toEqual([{ campaignId, includeUnconfirmed }]);
      expect(revalidatePath.mock.calls).toEqual([
        ["/en-US/admin/email-campaigns"],
        ["/cs-CZ/admin/email-campaigns"],
        [`/en-US/admin/email-campaigns/${campaignId}`],
        [`/cs-CZ/admin/email-campaigns/${campaignId}`],
      ]);
    }
  );

  test("requires an explicit unconfirmed-recipient choice to retry", async () => {
    const { retryUndeliveredCampaignRecipients } = await import("./actions");

    const result = await retryUndeliveredCampaignRecipients({
      campaignId,
    } as never);

    expect(result).toMatchObject({
      validationErrors: {
        fieldErrors: { includeUnconfirmed: expect.any(Array) },
      },
    });
    expect(retryCalls).toHaveLength(0);
  });

  test("returns the duplicate campaign ID and revalidates the campaign list", async () => {
    const { duplicateCampaign: duplicateCampaignAction } = await import(
      "./actions"
    );

    const result = await duplicateCampaignAction({ campaignId });

    expect(result?.data).toEqual({ campaignId: duplicateCampaignId });
    expect(duplicateCalls).toEqual([campaignId]);
    expect(revalidatePath.mock.calls).toEqual([
      ["/en-US/admin/email-campaigns"],
      ["/cs-CZ/admin/email-campaigns"],
    ]);
  });
});

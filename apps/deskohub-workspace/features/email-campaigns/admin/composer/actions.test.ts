import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { ICampaignService } from "../../backend/campaign.service";
import { campaignContentFixture } from "../../backend/email-campaigns.test-utils";
import { campaignIdSchema } from "../../campaign-identifiers";
import {
  CampaignAudienceArchived,
  CampaignAudienceNotFound,
  CampaignContentInvalid,
  CampaignNotFound,
  CampaignReadOnly,
} from "../../errors";

const revalidatePath = mock((_path: string) => undefined);

mock.module("next/cache", () => ({ revalidatePath }));
mock.module("next/server", () => ({
  after: () => undefined,
}));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));
let refererLocale = "en-US";
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () =>
    new Headers({ referer: `https://deskohub.test/${refererLocale}` }),
}));

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

const campaignServiceModule = await import("../../backend/campaign.service");
const campaignId = campaignIdSchema.make("synthetic-campaign");
const validInput = {
  title: "Synthetic campaign",
  purpose: "marketing",
  templateKey: "workspace",
  audienceId: null,
  content: campaignContentFixture(),
};
let createResult: Effect.Effect<unknown, unknown> = Effect.succeed({
  id: campaignId,
});
let updateResult: Effect.Effect<unknown, unknown> = Effect.succeed({
  id: campaignId,
});
let deleteResult: Effect.Effect<unknown, unknown> = Effect.succeed(undefined);
const createCalls: Parameters<ICampaignService["create"]>[0][] = [];
const updateCalls: Parameters<ICampaignService["update"]>[0][] = [];
const deleteCalls: Parameters<ICampaignService["delete"]>[0][] = [];

const create = mock((input: Parameters<ICampaignService["create"]>[0]) => {
  createCalls.push(input);
  return createResult;
});
const update = mock((input: Parameters<ICampaignService["update"]>[0]) => {
  updateCalls.push(input);
  return updateResult;
});

const deleteCampaign = mock(
  (input: Parameters<ICampaignService["delete"]>[0]) => {
    deleteCalls.push(input);
    return deleteResult;
  }
);

const campaignServiceLive = Layer.succeed(
  campaignServiceModule.CampaignService,
  campaignServiceModule.CampaignService.of({
    create,
    update,
    delete: deleteCampaign,
  } as never)
);

class StubCampaignService extends campaignServiceModule.CampaignService {
  static override Live = campaignServiceLive;
}

mock.module("../../backend/campaign.service", () => ({
  ...campaignServiceModule,
  CampaignService: StubCampaignService,
}));

const saveErrorCases = [
  {
    name: "invalid content",
    operation: "create",
    error: new CampaignContentInvalid({
      cause: new Error("synthetic schema failure") as never,
    }),
    serverError: "The content has problems. Fix the listed issues, then save.",
  },
  {
    name: "archived audience",
    operation: "create",
    error: new CampaignAudienceArchived({
      audienceId: campaignId as never,
    }),
    serverError: "The selected audience is archived. Choose another audience.",
  },
  {
    name: "missing audience",
    operation: "create",
    error: new CampaignAudienceNotFound({
      audienceId: campaignId as never,
    }),
    serverError: "The selected audience no longer exists.",
  },
  {
    name: "read-only campaign",
    operation: "update",
    error: new CampaignReadOnly({ campaignId, status: "sent" }),
    serverError: "This campaign has left Draft and can no longer be edited.",
  },
  {
    name: "missing campaign",
    operation: "update",
    error: new CampaignNotFound({ campaignId }),
    serverError: "This campaign no longer exists.",
  },
  {
    name: "unexpected save error",
    operation: "create",
    error: new Error("synthetic campaign service failure"),
    serverError: "The campaign could not be saved. Try again.",
  },
] as const;

beforeEach(() => {
  refererLocale = "en-US";
  authorizationCalls = 0;
  authorizationResult = Effect.succeed("Fixture Operator");
  createResult = Effect.succeed({ id: campaignId });
  updateResult = Effect.succeed({ id: campaignId });
  deleteResult = Effect.succeed(undefined);
  createCalls.length = 0;
  updateCalls.length = 0;
  deleteCalls.length = 0;
  revalidatePath.mockClear();
});

describe("email campaign composer actions", () => {
  test("does not call the campaign service when administrator authorization fails", async () => {
    authorizationResult = Effect.fail(
      new Error("synthetic authorization failure")
    );

    const { createCampaign } = await import("./actions");
    const result = await createCampaign(validInput as never);

    expect(result?.serverError).toBeDefined();
    expect(authorizationCalls).toBe(1);
    expect(createCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  test("reports an invalid draft through schema validation", async () => {
    const { createCampaign } = await import("./actions");

    const result = await createCampaign({
      ...validInput,
      title: "   ",
    } as never);

    expect(result).toMatchObject({
      validationErrors: {
        fieldErrors: { title: expect.any(Array) },
      },
    });
    expect(authorizationCalls).toBe(0);
    expect(createCalls).toHaveLength(0);
  });

  test.each(saveErrorCases)(
    "maps $name to its public save message",
    async ({ error, operation, serverError }) => {
      if (operation === "update") {
        updateResult = Effect.fail(error);
      } else {
        createResult = Effect.fail(error);
      }

      const { createCampaign, updateCampaign } = await import("./actions");
      const result =
        operation === "update"
          ? await updateCampaign({ ...validInput, campaignId } as never)
          : await createCampaign(validInput as never);

      expect(result?.serverError).toBe(serverError);
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );

  test("revalidates the campaign list and updated campaign after successful saves", async () => {
    const { createCampaign, updateCampaign } = await import("./actions");

    const created = await createCampaign(validInput as never);
    const updated = await updateCampaign({
      ...validInput,
      campaignId,
    } as never);

    expect(created?.data).toEqual({ campaignId });
    expect(updated?.data).toEqual({ campaignId });
    expect(revalidatePath.mock.calls).toEqual([
      ["/en-US/admin/email-campaigns"],
      ["/cs-CZ/admin/email-campaigns"],
      ["/en-US/admin/email-campaigns"],
      ["/cs-CZ/admin/email-campaigns"],
      [`/en-US/admin/email-campaigns/${campaignId}`],
      [`/cs-CZ/admin/email-campaigns/${campaignId}`],
    ]);
    expect(createCalls).toHaveLength(1);
    expect(updateCalls).toHaveLength(1);
  });

  test("deletes a draft and revalidates the campaign list and its page", async () => {
    const { deleteCampaign: deleteCampaignAction } = await import("./actions");

    const result = await deleteCampaignAction({ campaignId });

    expect(result?.data).toEqual({ campaignId });
    expect(authorizationCalls).toBe(1);
    expect(deleteCalls).toEqual([campaignId]);
    expect(revalidatePath.mock.calls).toEqual([
      ["/en-US/admin/email-campaigns"],
      ["/cs-CZ/admin/email-campaigns"],
      [`/en-US/admin/email-campaigns/${campaignId}`],
      [`/cs-CZ/admin/email-campaigns/${campaignId}`],
    ]);
  });

  test.each([
    {
      name: "a campaign that left Draft",
      error: new CampaignReadOnly({ campaignId, status: "sending" }),
      serverError: "This campaign has left Draft and can no longer be deleted.",
    },
    {
      name: "a missing campaign",
      error: new CampaignNotFound({ campaignId }),
      serverError: "This campaign no longer exists.",
    },
    {
      name: "an unexpected failure",
      error: new Error("synthetic campaign service failure"),
      serverError: "The campaign could not be deleted. Try again.",
    },
  ])(
    "refuses to delete $name with a public message",
    async ({ error, serverError }) => {
      deleteResult = Effect.fail(error);

      const { deleteCampaign: deleteCampaignAction } = await import(
        "./actions"
      );
      const result = await deleteCampaignAction({ campaignId });

      expect(result?.serverError).toBe(serverError);
      expect(result?.data).toBeUndefined();
      expect(deleteCalls).toEqual([campaignId]);
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );

  test("words the public message in the admin's language", async () => {
    refererLocale = "cs-CZ";
    deleteResult = Effect.fail(new CampaignNotFound({ campaignId }));

    const { deleteCampaign: deleteCampaignAction } = await import("./actions");
    const result = await deleteCampaignAction({ campaignId });

    expect(result?.serverError).toBe("Tato kampaň už neexistuje.");
  });

  test("does not delete a campaign when administrator authorization fails", async () => {
    authorizationResult = Effect.fail(
      new Error("synthetic authorization failure")
    );

    const { deleteCampaign: deleteCampaignAction } = await import("./actions");
    const result = await deleteCampaignAction({ campaignId });

    expect(result?.serverError).toBeDefined();
    expect(result?.data).toBeUndefined();
    expect(authorizationCalls).toBe(1);
    expect(deleteCalls).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

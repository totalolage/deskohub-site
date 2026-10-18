import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import type { ICampaignAudienceService } from "../../backend/campaign-audience.service";
import { everyoneFilter } from "../../backend/email-campaigns.test-utils";
import {
  campaignAudienceIdSchema,
  campaignIdSchema,
} from "../../campaign-identifiers";
import { CampaignAudienceInUse } from "../../errors";

mock.module("next/server", () => ({
  after: () => undefined,
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

const audienceServiceModule = await import(
  "../../backend/campaign-audience.service"
);
const audienceId = campaignAudienceIdSchema.make("synthetic-audience");
const audience = { id: audienceId };
let createResult: Effect.Effect<unknown, unknown> = Effect.succeed(audience);
let deleteResult: Effect.Effect<unknown, unknown> = Effect.succeed(undefined);
const createCalls: Parameters<ICampaignAudienceService["create"]>[0][] = [];
const deleteCalls: Parameters<ICampaignAudienceService["delete"]>[0][] = [];

const create = mock(
  (input: Parameters<ICampaignAudienceService["create"]>[0]) => {
    createCalls.push(input);
    return createResult;
  }
);
const update = mock(
  (_input: Parameters<ICampaignAudienceService["update"]>[0]) =>
    Effect.succeed(audience)
);
const archive = mock(
  (_input: Parameters<ICampaignAudienceService["archive"]>[0]) =>
    Effect.succeed(audience)
);
const unarchive = mock(
  (_input: Parameters<ICampaignAudienceService["unarchive"]>[0]) =>
    Effect.succeed(audience)
);
const deleteAudience = mock(
  (input: Parameters<ICampaignAudienceService["delete"]>[0]) => {
    deleteCalls.push(input);
    return deleteResult;
  }
);

const audienceServiceLive = Layer.succeed(
  audienceServiceModule.CampaignAudienceService,
  audienceServiceModule.CampaignAudienceService.of({
    create,
    update,
    archive,
    unarchive,
    delete: deleteAudience,
  } as never)
);

class StubCampaignAudienceService extends audienceServiceModule.CampaignAudienceService {
  static override Live = audienceServiceLive;
}

mock.module("../../backend/campaign-audience.service", () => ({
  ...audienceServiceModule,
  CampaignAudienceService: StubCampaignAudienceService,
}));

const validInput = {
  title: "Synthetic audience",
  filter: everyoneFilter,
};

beforeEach(() => {
  authorizationCalls = 0;
  authorizationResult = Effect.succeed("Fixture Operator");
  createResult = Effect.succeed(audience);
  deleteResult = Effect.succeed(undefined);
  createCalls.length = 0;
  deleteCalls.length = 0;
});

describe("email campaign audience actions", () => {
  test("does not call the audience service when administrator authorization fails", async () => {
    authorizationResult = Effect.fail(
      new Error("synthetic authorization failure")
    );

    const { saveAudience } = await import("./actions");
    const result = await saveAudience(validInput);

    expect(result?.serverError).toBeDefined();
    expect(authorizationCalls).toBe(1);
    expect(createCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  test("reports a blank audience title as a title field error", async () => {
    const { saveAudience } = await import("./actions");

    const result = await saveAudience({
      ...validInput,
      title: "   ",
    });

    // The editor words the issue in its locale before it submits; the action
    // only rejects the title.
    expect(result?.validationErrors?.fieldErrors?.title).toHaveLength(1);
    expect(authorizationCalls).toBe(0);
    expect(createCalls).toHaveLength(0);
  });

  test.each([
    {
      draftCampaignIds: [campaignIdSchema.make("synthetic-draft")],
      serverError:
        "A draft campaign uses this audience, so it can only be archived. Move those drafts to another audience before deleting it.",
    },
    {
      draftCampaignIds: [
        campaignIdSchema.make("synthetic-draft-a"),
        campaignIdSchema.make("synthetic-draft-b"),
      ],
      serverError:
        "2 draft campaigns use this audience, so it can only be archived. Move those drafts to another audience before deleting it.",
    },
  ])(
    "maps audience-in-use errors for $draftCampaignIds.length draft campaigns",
    async ({ draftCampaignIds, serverError }) => {
      deleteResult = Effect.fail(
        new CampaignAudienceInUse({ audienceId, draftCampaignIds })
      );

      const { deleteAudience: deleteAudienceAction } = await import(
        "./actions"
      );
      const result = await deleteAudienceAction({ audienceId });

      expect(result?.serverError).toBe(serverError);
      expect(deleteCalls).toHaveLength(1);
    }
  );

  test("returns the saved audience ID on success", async () => {
    const { saveAudience } = await import("./actions");

    const result = await saveAudience(validInput);

    expect(result?.data).toEqual({ audienceId });
    expect(createCalls).toHaveLength(1);
  });
});

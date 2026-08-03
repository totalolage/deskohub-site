import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { GoogleCalendarAPIError } from "@deskohub/google-calendar";
import { Effect, Layer } from "effect";
import type { IOpeningHoursCalendarService } from "@/features/opening-hours/backend/opening-hours-calendar.service";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { openingHoursTags } from "@/shared/utils/cache-tags";

setBoardgameTestEnv();

mock.module("server-only", () => ({}));

const maintenanceOperations: string[] = [];
const revalidateTag = mock(() => {
  maintenanceOperations.push("invalidate");
});
mock.module("next/cache", () => ({ revalidateTag }));

type WatchChanges = IOpeningHoursCalendarService["watchChanges"];

const watchChanges = mock<WatchChanges>((input) => {
  maintenanceOperations.push("watch");
  return Effect.succeed({
    channelId: input.channelId,
    expiration: 1_785_902_400_000,
  });
});

let GET: typeof import("./route").GET;

beforeAll(async () => {
  const { OpeningHoursCalendarService } = await import(
    "@/features/opening-hours/backend/opening-hours-calendar.service"
  );

  OpeningHoursCalendarService.LiveWithDependencies = Layer.succeed(
    OpeningHoursCalendarService,
    {
      listExceptions: () => Effect.succeed([]),
      watchChanges,
    }
  );

  ({ GET } = await import("./route"));
});

const makeRequest = (authorization?: string) =>
  new Request("https://bar.example.test/api/cron/opening-hours?force=1", {
    ...(authorization && { headers: { authorization } }),
  });

describe("opening-hours midnight maintenance cron", () => {
  beforeEach(() => {
    maintenanceOperations.length = 0;
    revalidateTag.mockClear();
    revalidateTag.mockImplementation(() => {
      maintenanceOperations.push("invalidate");
    });
    watchChanges.mockClear();
    watchChanges.mockImplementation((input) => {
      maintenanceOperations.push("watch");
      return Effect.succeed({
        channelId: input.channelId,
        expiration: 1_785_902_400_000,
      });
    });
  });

  test("rejects requests without the Vercel cron secret", async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(watchChanges).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("renews the watch and expires the static page data", async () => {
    const response = await GET(
      makeRequest(`Bearer ${process.env.CRON_SECRET}`)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      maintained: true,
      expiration: 1_785_902_400_000,
    });
    expect(watchChanges).toHaveBeenCalledTimes(1);
    expect(watchChanges.mock.calls[0]?.[0]).toMatchObject({
      webhookUrl:
        "https://bar.deskohub.cz/api/webhooks/google-calendar/opening-hours",
      ttlSeconds: 259_200,
    });
    expect(watchChanges.mock.calls[0]?.[0].channelId).toMatch(
      /^[0-9a-f-]{36}$/u
    );
    expect(watchChanges.mock.calls[0]?.[0].webhookToken).toMatch(
      /^[0-9a-f]{64}$/u
    );
    expect(revalidateTag).toHaveBeenCalledWith(openingHoursTags.exceptions(), {
      expire: 0,
    });
    expect(maintenanceOperations).toEqual(["watch", "invalidate"]);
  });

  test("reports provider registration failures", async () => {
    watchChanges.mockImplementationOnce(() => {
      maintenanceOperations.push("watch");
      return Effect.fail(
        new GoogleCalendarAPIError({ operation: "events.watch" })
      );
    });

    const response = await GET(
      makeRequest(`Bearer ${process.env.CRON_SECRET}`)
    );

    expect(response.status).toBe(500);
    expect(revalidateTag).toHaveBeenCalledWith(openingHoursTags.exceptions(), {
      expire: 0,
    });
    expect(maintenanceOperations).toEqual(["watch", "invalidate"]);
  });

  test("reports cache invalidation failures", async () => {
    revalidateTag.mockImplementationOnce(() => {
      throw new Error("cache unavailable");
    });

    const response = await GET(
      makeRequest(`Bearer ${process.env.CRON_SECRET}`)
    );

    expect(response.status).toBe(500);
  });
});

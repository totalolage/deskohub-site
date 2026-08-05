import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { openingHoursTags } from "@/shared/utils/cache-tags";

setBoardgameTestEnv();

const revalidateTag = mock(() => undefined);

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ revalidateTag }));

const cronSecret = process.env.CRON_SECRET;
if (!cronSecret) throw new Error("Test CRON_SECRET is missing");
let webhookToken = "";
let POST: typeof import("./route").POST;

beforeAll(async () => {
  const { deriveOpeningHoursCalendarWebhookToken } = await import(
    "@/features/opening-hours/backend/opening-hours-calendar-webhook-auth"
  );
  ({ POST } = await import("./route"));
  webhookToken = deriveOpeningHoursCalendarWebhookToken(cronSecret);
});

const makeRequest = (resourceState: string, token = webhookToken) =>
  new Request(
    "https://bar.example.test/api/webhooks/google-calendar/opening-hours",
    {
      method: "POST",
      headers: {
        "x-goog-channel-token": token,
        "x-goog-resource-state": resourceState,
      },
    }
  );

describe("Google Calendar opening-hours webhook", () => {
  beforeEach(() => {
    revalidateTag.mockClear();
    revalidateTag.mockImplementation(() => undefined);
  });

  test("rejects an invalid channel token", async () => {
    const response = await POST(makeRequest("exists", "invalid-token"));

    expect(response.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("acknowledges channel synchronization without refreshing data", async () => {
    const response = await POST(makeRequest("sync"));

    expect(response.status).toBe(204);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("immediately expires the opening-hours cache after an event change", async () => {
    const response = await POST(makeRequest("exists"));

    expect(response.status).toBe(204);
    expect(revalidateTag).toHaveBeenCalledWith(openingHoursTags.exceptions(), {
      expire: 0,
    });
  });

  test("rejects unknown notification states", async () => {
    const response = await POST(makeRequest("unknown"));

    expect(response.status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  test("returns a retryable error when invalidation fails", async () => {
    revalidateTag.mockImplementationOnce(() => {
      throw new Error("cache unavailable");
    });

    const response = await POST(makeRequest("exists"));

    expect(response.status).toBe(500);
  });
});

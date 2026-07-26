import "../../shared/polyfills/temporal";

import { expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import type { WorkspaceE2EConfig } from "../config";
import { makeMeetingRoomCheckoutData } from "../checkout/data";
import { workspaceE2ETimeouts } from "../timeouts";
import { assertMeetingRoomSlotUnavailable } from "./meeting-room";

test("treats an occupied interval as unavailable without requiring the whole date", async () => {
  const interval = getMeetingRoomReservationInterval(
    "2099-09-01T10:00",
    60
  );
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
    {
      date: "2099-09-01",
      durationMinutes: 60,
      startDateTime: "2099-09-01T10:00",
      ...interval!,
    }
  );
  const config: WorkspaceE2EConfig = {
    baseUrl:
      "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
    bypassSecret: undefined,
    expectedHost:
      "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
    timeouts: { ...workspaceE2ETimeouts, datasource: 1 },
  };
  const fetchMock = mock(() =>
    Promise.resolve(
      Response.json({
        meetingRoomUnavailable: true,
        unavailableDates: [],
      })
    )
  );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        fetchMock as unknown as typeof globalThis.fetch
      )
    )
  );

  await expect(
    Effect.runPromise(
      assertMeetingRoomSlotUnavailable(config, data).pipe(
        Effect.provide(httpClientLayer)
      )
    )
  ).resolves.toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

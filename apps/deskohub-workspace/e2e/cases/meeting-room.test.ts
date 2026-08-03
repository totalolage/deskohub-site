import "../../shared/polyfills/temporal";

import { expect, mock, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { makeMeetingRoomCheckoutData } from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceE2ETimeouts } from "../timeouts";
import { assertMeetingRoomSlotUnavailable } from "./meeting-room";

test("keeps the deployed E2E runner independent of generated translations", async () => {
  const source = await Bun.file(
    fileURLToPath(new URL("./meeting-room.ts", import.meta.url))
  ).text();

  expect(source).not.toContain("product-catalog.i18n");
  expect(source).not.toContain("@/features/i18n");
});

test("treats an occupied interval as unavailable without requiring the whole date", async () => {
  const interval = getMeetingRoomReservationInterval("2099-09-01T10:00", {
    unit: "hour",
    amount: 1,
  });
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
    {
      date: "2099-09-01",
      duration: { unit: "hour", amount: 1 },
      startDateTime: "2099-09-01T10:00",
      ...interval!,
    }
  );
  const config: WorkspaceE2EConfig = {
    baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
    bypassSecret: undefined,
    expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
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

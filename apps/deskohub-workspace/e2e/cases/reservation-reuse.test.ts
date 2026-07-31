import "../../shared/polyfills/temporal";

import { expect, test } from "bun:test";
import { Effect } from "effect";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { makeMeetingRoomCheckoutData } from "../checkout/data";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import { returnToPrefilledReservation } from "./reservation-reuse";

test("waits for the meeting-room consent control before checking restored state", async () => {
  const interval = getMeetingRoomReservationInterval(
    "2099-09-01T10:00",
    { unit: "hour", amount: 1 }
  );
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData(
    "https://workspace.example.test",
    {
      date: "2099-09-01",
      durationMinutes: 60,
      startDateTime: "2099-09-01T10:00",
      ...interval!,
    }
  );
  const calls: string[][] = [];
  const run: Runner = async (_command, args) => {
    calls.push(args);
    return {
      exitCode: 0,
      stderr: "",
      stdout: args.includes("url")
        ? "https://workspace.example.test/en-US/reservation/meeting-room?payState=signed"
        : "",
    };
  };

  await Effect.runPromise(
    returnToPrefilledReservation({
      data,
      reservationPath: "/en-US/reservation/meeting-room",
      run,
      session: "meeting-room-replacement",
      timeouts: workspaceE2ETimeouts,
    })
  );

  const hydrationScripts = calls
    .filter((args) => args.includes("--fn"))
    .map((args) => args.at(-1))
    .filter((script) => script?.includes("__reactProps$"));
  expect(hydrationScripts).toHaveLength(2);
  expect(hydrationScripts[1]).toContain("#reservation-privacy-consent");
});

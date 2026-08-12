import { Effect } from "effect";
import { prepareDiscountAvailabilityE2E } from "../cases/discounts";
import { prepareMeetingRoomE2E } from "../cases/meeting-room";
import { prepareOfficeE2E } from "../cases/office";
import { getConfig } from "../config";
import { E2ETelemetryService } from "../services/telemetry";
import { writeWorkspaceE2EPreparationPart } from "./run-plan";
import { runtimeTest as test } from "./runtime-fixtures";

test("prepare cowork availability", async ({
  environment,
  runContext,
  runEffect,
}) => {
  const config = getConfig(environment);
  const preparation = await runEffect(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      return yield* telemetry.tracePhase({
        effect: prepareDiscountAvailabilityE2E(config, runContext.allocation),
        phaseId: "cowork-availability-preparation",
      });
    })
  );
  await writeWorkspaceE2EPreparationPart("discounts", preparation);
});

test("prepare meeting-room availability", async ({
  environment,
  runContext,
  runEffect,
}) => {
  const config = getConfig(environment);
  const preparation = await runEffect(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      return yield* telemetry.tracePhase({
        effect: prepareMeetingRoomE2E(config, runContext.allocation),
        phaseId: "meeting-room-availability-preparation",
      });
    })
  );
  await writeWorkspaceE2EPreparationPart("meetingRoom", preparation);
});

test("prepare office availability", async ({
  environment,
  runContext,
  runEffect,
}) => {
  const config = getConfig(environment);
  const preparation = await runEffect(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      return yield* telemetry.tracePhase({
        effect: prepareOfficeE2E(config, runContext.allocation),
        phaseId: "office-availability-preparation",
      });
    })
  );
  await writeWorkspaceE2EPreparationPart("office", preparation);
});

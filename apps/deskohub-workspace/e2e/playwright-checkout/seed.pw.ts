import { Effect } from "effect";
import { seedDiscountE2EFixtures } from "../integrations/discount-fixtures";
import { E2ETelemetryService } from "../services/telemetry";
import { runtimeTest as test } from "./runtime-fixtures";

test("seed workspace checkout fixtures", async ({ runEffect }) => {
  await runEffect(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      yield* telemetry.tracePhase({
        effect: seedDiscountE2EFixtures,
        phaseId: "fixture-seeding",
      });
    })
  );
});

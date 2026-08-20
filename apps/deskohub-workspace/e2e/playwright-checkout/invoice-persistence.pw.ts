import { Effect } from "effect";
import { assertInvoicePersistence } from "../integrations/invoice-persistence";
import { E2ETelemetryService } from "../services/telemetry";
import { runtimeTest as test } from "./runtime-fixtures";

test("validate invoice persistence", async ({ runEffect }) => {
  await runEffect(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      yield* telemetry.tracePhase({
        effect: assertInvoicePersistence,
        phaseId: "invoice-persistence",
      });
    })
  );
});

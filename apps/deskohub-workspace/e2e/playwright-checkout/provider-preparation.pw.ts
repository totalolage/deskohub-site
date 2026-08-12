import { Effect } from "effect";
import { getDatasourceConfig } from "../config";
import { resolveE2EDotyposDiscountGroup } from "../integrations/dotypos";
import { E2ETelemetryService } from "../services/telemetry";
import { writeWorkspaceE2EPreparationPart } from "./run-plan";
import { runtimeTest as test } from "./runtime-fixtures";

test("prepare provider fixtures", async ({ environment, runEffect }) => {
  const datasourceConfig = getDatasourceConfig(environment);
  const preparation = await runEffect(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      return yield* telemetry.tracePhase({
        effect: resolveE2EDotyposDiscountGroup(datasourceConfig),
        phaseId: "provider-preparation",
      });
    })
  );
  await writeWorkspaceE2EPreparationPart("customerDiscountGroup", preparation);
});

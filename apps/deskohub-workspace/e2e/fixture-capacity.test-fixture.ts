import {
  DotyposCloudIdSchema,
  DotyposTableIdSchema,
  DotyposTableSchema,
} from "@deskohub/dotypos";
import type { DatasourceConfig } from "./config";
import {
  fixtureCapacityLifetime,
  makeFixtureCapacityObservation,
} from "./fixture-capacity";

export const fixtureCapacityTestTable = DotyposTableSchema.make({
  id: DotyposTableIdSchema.make("table"),
  _cloudId: DotyposCloudIdSchema.make("cloud"),
  name: "Synthetic table",
  enabled: true,
  display: true,
  seats: "24",
});

export const makeFixtureCapacityTestObservation = (
  config: DatasourceConfig,
  now = Date.now()
) =>
  makeFixtureCapacityObservation({
    config,
    startMillis: now,
    endMillis: now + fixtureCapacityLifetime,
    observedMillis: now,
    tables: [fixtureCapacityTestTable],
    past: [],
    future: [],
  });

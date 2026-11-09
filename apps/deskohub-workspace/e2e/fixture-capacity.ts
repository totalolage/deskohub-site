import { readFile, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { DotyposReservation, DotyposTable } from "@deskohub/dotypos";
import { Effect, Result, Schema } from "effect";
import {
  decodeTableSeatCapacity,
  workspaceMeetingRoomReservationTableTag,
  workspaceOfficeReservationTableTag,
} from "@/features/checkout/backend/reservation/workspace-table-selection";
import { workspaceE2EConcurrentRunTarget } from "./allocation";
import type { DatasourceConfig } from "./config";
import { workspaceE2EError } from "./errors";
import { workspaceDir, writeJsonAtomically } from "./runtime";
import { evidenceDigest } from "./soak-native";
import { workspaceE2ETimeouts } from "./timeouts";

const day = 24 * 60 * 60 * 1000;
export const syntheticReservationDuration = 2 * 60 * 60 * 1000;
export const syntheticReservationFutureOffset = 120 * day;
export const syntheticReservationPastOffset =
  -2 * day - syntheticReservationDuration;
export const fixtureCapacityLifetime =
  workspaceE2ETimeouts.fixtureCapacityLifetime;
export const workspaceE2EFixtureCapacityPath = resolve(
  workspaceDir,
  ".workspace-e2e.local",
  "fixture-capacity.json"
);

const integer = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const observationSchema = Schema.Struct({
  startMillis: integer,
  endMillis: integer,
  observedMillis: integer,
  fingerprint: digest,
  inventoryDigest: digest,
  selectedTableDigest: digest,
  seatCapacity: integer,
  pastPeak: integer,
  futurePeak: integer,
  supportedConcurrentRuns: Schema.Literal(workspaceE2EConcurrentRunTarget),
  meetsRequiredCapacity: Schema.Boolean,
});
type FixtureCapacityObservation = typeof observationSchema.Type;

const unavailable = () =>
  workspaceE2EError(
    "Synthetic fixture capacity is Unknown; run e2e:capacity before admitting fixtures",
    {
      diagnosticCode: "dotypos_account_fixture_mutation_failed",
      operation: "admit synthetic reservation",
    }
  );

const fingerprint = (config: DatasourceConfig) => {
  if (!config.fixtureCapacityTarget.targetSha) throw unavailable();
  return evidenceDigest(
    JSON.stringify({
      target: config.fixtureCapacityTarget,
      dotypos: config.dotypos,
      databaseUrl: config.databaseUrl,
      databaseUrlUnpooled: config.databaseUrlUnpooled,
    })
  );
};

/** Provider order is part of the fixture's table selection contract. */
export const selectSyntheticReservationTable = (
  tables: readonly DotyposTable[]
) =>
  tables.find(
    (candidate) =>
      candidate.enabled === true &&
      candidate.display === true &&
      !candidate.tags?.includes(workspaceOfficeReservationTableTag) &&
      !candidate.tags?.includes(workspaceMeetingRoomReservationTableTag)
  );

const tableIdentity = (table: DotyposTable) => ({
  id: table.id,
  cloud: table._cloudId,
  branch: table._branchId,
  enabled: table.enabled,
  display: table.display,
  seats: table.seats,
  tags: table.tags,
});

const selectedCapacity = (tables: readonly DotyposTable[]) => {
  const table = selectSyntheticReservationTable(tables);
  if (!table) throw unavailable();
  const seats = decodeTableSeatCapacity(table);
  if (Result.isFailure(seats) || !Number.isSafeInteger(seats.success))
    throw unavailable();
  return { table, seats: seats.success };
};

export const fixtureCapacityWindows = (
  startMillis: number,
  endMillis: number
) => ({
  past: {
    startDate: new Date(startMillis + syntheticReservationPastOffset),
    endDate: new Date(endMillis - 2 * day),
  },
  future: {
    startDate: new Date(startMillis + syntheticReservationFutureOffset),
    endDate: new Date(
      endMillis +
        syntheticReservationFutureOffset +
        syntheticReservationDuration
    ),
  },
});

const peakSeats = (
  reservations: readonly DotyposReservation[],
  table: DotyposTable,
  interval: { startDate: Date; endDate: Date }
) => {
  const events: { at: number; delta: number }[] = [];
  for (const reservation of reservations) {
    if (reservation.status === "CANCELLED") continue;
    const start = Date.parse(reservation.startDate);
    const end = Date.parse(reservation.endDate);
    const seats = Number(reservation.seats);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      !Number.isSafeInteger(seats) ||
      seats <= 0
    )
      throw unavailable();
    if (
      reservation._tableId !== table.id ||
      start >= interval.endDate.getTime() ||
      end <= interval.startDate.getTime()
    )
      continue;
    events.push(
      { at: Math.max(start, interval.startDate.getTime()), delta: seats },
      { at: Math.min(end, interval.endDate.getTime()), delta: -seats }
    );
  }
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let peak = 0;
  let occupied = 0;
  for (const event of events) {
    occupied += event.delta;
    peak = Math.max(peak, occupied);
  }
  if (!Number.isSafeInteger(peak)) throw unavailable();
  return peak;
};

export const makeFixtureCapacityObservation = (input: {
  readonly config: DatasourceConfig;
  readonly startMillis: number;
  readonly endMillis: number;
  readonly observedMillis: number;
  readonly tables: readonly DotyposTable[];
  readonly past: readonly DotyposReservation[];
  readonly future: readonly DotyposReservation[];
}): FixtureCapacityObservation => {
  const { table, seats } = selectedCapacity(input.tables);
  const windows = fixtureCapacityWindows(input.startMillis, input.endMillis);
  const pastPeak = peakSeats(input.past, table, windows.past);
  const futurePeak = peakSeats(input.future, table, windows.future);
  const observation = observationSchema.make({
    startMillis: input.startMillis,
    endMillis: input.endMillis,
    observedMillis: input.observedMillis,
    fingerprint: fingerprint(input.config),
    inventoryDigest: evidenceDigest(
      JSON.stringify(input.tables.map(tableIdentity))
    ),
    selectedTableDigest: evidenceDigest(JSON.stringify(tableIdentity(table))),
    seatCapacity: seats,
    pastPeak,
    futurePeak,
    supportedConcurrentRuns: workspaceE2EConcurrentRunTarget,
    meetsRequiredCapacity:
      pastPeak + 4 * workspaceE2EConcurrentRunTarget <= seats &&
      futurePeak + 2 * workspaceE2EConcurrentRunTarget <= seats,
  });
  assertFixtureCapacityTime(observation, input.observedMillis);
  return observation;
};

export const fixtureCapacityReport = (
  observation: FixtureCapacityObservation
) => {
  const windows = fixtureCapacityWindows(
    observation.startMillis,
    observation.endMillis
  );
  const windowReport = (
    interval: { startDate: Date; endDate: Date },
    peakOccupiedSeats: number,
    perRun: number
  ) => ({
    from: interval.startDate.toISOString(),
    to: interval.endDate.toISOString(),
    peakOccupiedSeats,
    plannedFixtureSeats: perRun * observation.supportedConcurrentRuns,
    meetsRequiredCapacity:
      peakOccupiedSeats + perRun * observation.supportedConcurrentRuns <=
      observation.seatCapacity,
  });
  return {
    from: new Date(observation.startMillis).toISOString(),
    to: new Date(observation.endMillis).toISOString(),
    observedAt: new Date(observation.observedMillis).toISOString(),
    selectedTableCount: 1,
    seatCapacity: observation.seatCapacity,
    supportedConcurrentRuns: observation.supportedConcurrentRuns,
    past: windowReport(windows.past, observation.pastPeak, 4),
    future: windowReport(windows.future, observation.futurePeak, 2),
    meetsRequiredCapacity: observation.meetsRequiredCapacity,
  };
};

const assertFixtureCapacityTime = (
  observation: FixtureCapacityObservation,
  now = Date.now()
) => {
  if (
    observation.endMillis - observation.startMillis !==
      fixtureCapacityLifetime ||
    observation.observedMillis < observation.startMillis ||
    observation.observedMillis > now ||
    now < observation.startMillis ||
    now >= observation.endMillis
  )
    throw unavailable();
};

export const invalidateFixtureCapacityObservation = () =>
  rm(workspaceE2EFixtureCapacityPath, { force: true });
export const writeFixtureCapacityObservation = (
  observation: FixtureCapacityObservation
) => {
  assertFixtureCapacityTime(observation);
  if (!observation.meetsRequiredCapacity) throw unavailable();
  return writeJsonAtomically(workspaceE2EFixtureCapacityPath, observation);
};

/** No missing-file fallback, refresh, or context-free test bypass. */
export const admitSyntheticReservation = (input: {
  readonly config: DatasourceConfig;
  readonly tables: readonly DotyposTable[];
  readonly startsAtMillis: number;
  readonly seats: number;
  readonly window: "past" | "future";
}) =>
  Effect.tryPromise({
    try: async () => {
      const metadata = await stat(workspaceE2EFixtureCapacityPath);
      if (
        !metadata.isFile() ||
        (metadata.mode & 0o777) !== 0o600 ||
        metadata.size > 4096
      )
        throw unavailable();
      const observation = Schema.decodeUnknownSync(observationSchema)(
        JSON.parse(await readFile(workspaceE2EFixtureCapacityPath, "utf8"))
      );
      assertFixtureCapacityTime(observation);
      const { table, seats } = selectedCapacity(input.tables);
      if (
        !observation.meetsRequiredCapacity ||
        observation.fingerprint !== fingerprint(input.config) ||
        observation.inventoryDigest !==
          evidenceDigest(JSON.stringify(input.tables.map(tableIdentity))) ||
        observation.selectedTableDigest !==
          evidenceDigest(JSON.stringify(tableIdentity(table))) ||
        observation.seatCapacity !== seats ||
        observation.pastPeak + 4 * workspaceE2EConcurrentRunTarget > seats ||
        observation.futurePeak + 2 * workspaceE2EConcurrentRunTarget > seats ||
        input.seats !== 1 ||
        !Number.isSafeInteger(input.startsAtMillis)
      )
        throw unavailable();
      const endsAtMillis = input.startsAtMillis + syntheticReservationDuration;
      const window = fixtureCapacityWindows(
        observation.startMillis,
        observation.endMillis
      )[input.window];
      if (
        input.startsAtMillis < window.startDate.getTime() ||
        endsAtMillis > window.endDate.getTime()
      )
        throw unavailable();
      return { observation, table };
    },
    catch: unavailable,
  });

export const recheckFixtureCapacityTime = (
  observation: FixtureCapacityObservation
) =>
  Effect.try({
    try: () => assertFixtureCapacityTime(observation),
    catch: unavailable,
  });

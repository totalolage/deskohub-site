import {
  DotyposRuntimeConfig,
  DotyposRuntimeConfigSchema,
  DotyposService,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema, Scope } from "effect";
import { env } from "@/env";
import { expireCacheTag } from "@/shared/backend/cache-invalidation";
import {
  availabilityTags,
  reservationRecordTags,
} from "@/shared/utils/cache-tags";

export const WorkspaceDotyposRuntimeConfigLayer = Layer.effect(
  DotyposRuntimeConfig,
  Schema.decodeUnknownEffect(DotyposRuntimeConfigSchema)({
    clientId: env.DOTYPOS_CLIENT_ID,
    clientSecret: env.DOTYPOS_CLIENT_SECRET,
    refreshToken: env.DOTYPOS_REFRESH_TOKEN,
    cloudId: env.DOTYPOS_CLOUD_ID,
    branchId: env.DOTYPOS_BRANCH_ID,
    employeeId: env.DOTYPOS_EMPLOYEE_ID,
    apiUrl: env.DOTYPOS_API_URL,
    apiTimeout: env.DOTYPOS_API_TIMEOUT,
    reservationTableIds: [],
  })
);

/**
 * Every reservation write marks the shared reservation snapshots stale, even
 * when the write fails, because a timed-out write may still have landed.
 * Confirming a hold keeps its seats occupied, so it expires only the
 * customer-facing reservation records, not availability.
 */
export const ReservationWritesExpireSharedReads = Layer.effect(
  DotyposService,
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    const expiringOccupancy = expiringTags(
      availabilityTags.reservations,
      reservationRecordTags.records
    );
    const expiringRecords = expiringTags(reservationRecordTags.records);
    return {
      ...dotypos,
      createReservation: expiringOccupancy(dotypos.createReservation),
      updateReservation: expiringOccupancy(dotypos.updateReservation),
      cancelReservation: expiringOccupancy(dotypos.cancelReservation),
      confirmReservation: expiringRecords(dotypos.confirmReservation),
    };
  })
);

const configuredDotyposLayer = ReservationWritesExpireSharedReads.pipe(
  Layer.provide(DotyposService.Live),
  Layer.provide(WorkspaceDotyposRuntimeConfigLayer)
);
const processScope = Scope.makeUnsafe();
const processMemoMap = Layer.makeMemoMapUnsafe();

export const WorkspaceDotyposLayer = Layer.fromBuild(() =>
  Layer.buildWithMemoMap(configuredDotyposLayer, processMemoMap, processScope)
);

function expiringTags(...tags: readonly string[]) {
  return <Args extends readonly unknown[], A, E, R>(
    write: (...args: Args) => Effect.Effect<A, E, R>
  ) =>
    (...args: Args) =>
      write(...args).pipe(
        Effect.ensuring(Effect.forEach(tags, expireCacheTag, { discard: true }))
      );
}

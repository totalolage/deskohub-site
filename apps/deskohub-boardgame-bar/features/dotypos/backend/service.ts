import { DotyposService as SharedDotyposService } from "@deskohub/dotypos/backend/service";
import { Effect, Layer } from "effect";
import { getLocale } from "@/features/i18n";
import type { TableReservationFormData } from "@/features/table-reservation/schemas/table-reservation";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
export class DotyposService extends Effect.Service<DotyposService>()(
  "DotyposService",
  {
    effect: Effect.gen(function* () {
      const sharedDotypos = yield* SharedDotyposService;

      return {
        ...sharedDotypos,
        createReservation: (input: TableReservationFormData) =>
          sharedDotypos.createReservation({
            ...input,
            locale: getLocale(),
          }),
      };
    }),
    dependencies: [
      Layer.provide(SharedDotyposService.Default, DotyposRuntimeConfigLive),
    ],
  }
) {}

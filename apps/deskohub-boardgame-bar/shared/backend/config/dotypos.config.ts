import {
  type DotyposRuntimeConfigObj,
  DotyposTableIdSchema,
  makeDotyposRuntimeConfigLayer,
} from "@deskohub/dotypos";
import { Schema } from "effect";
import { siteConstants } from "@/shared/utils/constants";

const dotyposTableId = Schema.decodeUnknownSync(DotyposTableIdSchema);

export const makeDotyposConfigLayer = (
  input: Omit<DotyposRuntimeConfigObj, "reservationTableIds">
) =>
  makeDotyposRuntimeConfigLayer({
    ...input,
    reservationTableIds:
      siteConstants.tableReservation.tablesToAssignReservationsTo.map(
        (tableId) => dotyposTableId(tableId)
      ),
  });

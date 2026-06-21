import {
  type DotyposRuntimeConfigObj,
  makeDotyposRuntimeConfigLayer,
} from "@deskohub/dotypos";
import { siteConstants } from "@/shared/utils/constants";

export const makeDotyposConfigLayer = (
  input: Omit<DotyposRuntimeConfigObj, "reservationTableIds">
) =>
  makeDotyposRuntimeConfigLayer({
    ...input,
    reservationTableIds:
      siteConstants.tableReservation.tablesToAssignReservationsTo,
  });

import { Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database-live.server";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { GoogleCalendarServiceLive } from "@/shared/backend/config/google-calendar.config";
import { DiscountAdministration } from "./discount-administration.service";

const DiscountAdministrationDependenciesLive = Layer.mergeAll(
  WorkspaceDatabaseLive,
  DotyposServiceLive,
  GoogleCalendarServiceLive,
  CalendarResourceConfig.Live
);

export const DiscountAdministrationLive = DiscountAdministration.Live.pipe(
  Layer.provide(DiscountAdministrationDependenciesLive)
);

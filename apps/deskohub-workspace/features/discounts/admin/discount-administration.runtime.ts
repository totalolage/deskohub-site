import { Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { GoogleCalendarServiceLive } from "@/shared/backend/config/google-calendar.config";
import { DiscountAdministration } from "./discount-administration.service";

const DiscountAdministrationDependenciesLive = Layer.mergeAll(
  WorkspaceDatabaseLive,
  GoogleCalendarServiceLive,
  CalendarResourceConfig.Live
);

export const DiscountAdministrationLive = DiscountAdministration.Live.pipe(
  Layer.provide(DiscountAdministrationDependenciesLive)
);

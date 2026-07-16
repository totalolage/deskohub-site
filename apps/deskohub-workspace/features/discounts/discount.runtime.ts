import "server-only";
import { Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { GoogleCalendarServiceLive } from "@/shared/backend/config/google-calendar.config";
import { processLifetimeLayer } from "@/shared/backend/utils/process-lifetime-layer";
import { CalendarDiscountProvider } from "./calendar-discount-provider.service";
import { CodeDiscountProvider } from "./code-discount-provider.service";
import { CustomerDiscountProvider } from "./customer-discount-provider.service";
import { DiscountService } from "./discount.service";
import { DiscountCodeRepository } from "./discount-code.repository";
import { DiscountDefinitionRepository } from "./discount-definition.repository";

const discountRepositories = Layer.mergeAll(
  DiscountDefinitionRepository.Live,
  DiscountCodeRepository.Live
).pipe(Layer.provide(WorkspaceDatabaseLive));

const providerDependencies = Layer.mergeAll(
  discountRepositories,
  GoogleCalendarServiceLive,
  CalendarResourceConfig.Live,
  DotyposServiceLive
);

const discountProviders = Layer.mergeAll(
  CalendarDiscountProvider.Live,
  CustomerDiscountProvider.Live,
  CodeDiscountProvider.Live
).pipe(Layer.provide(providerDependencies));

export const DiscountServiceLiveWithDependencies = processLifetimeLayer(
  DiscountService.Live.pipe(Layer.provide(discountProviders))
);

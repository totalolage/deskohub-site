import "server-only";
import { Layer, Scope } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { GoogleCalendarServiceLive } from "@/shared/backend/config/google-calendar.config";
import { CalendarDiscountProvider } from "./calendar-discount-provider.service";
import { CodeDiscountProvider } from "./code-discount-provider.service";
import { CustomerDiscountProvider } from "./customer-discount-provider.service";
import { DiscountService } from "./discount.service";
import { DiscountCodeRepository } from "./discount-code.repository";
import { DiscountDefinitionRepository } from "./discount-definition.repository";
import { DiscountReleaseGateEvaluatorLive } from "./discount-release-gate.server";
import { DiscountReleaseGateService } from "./discount-release-gate.service";

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

const discountServiceDependencies = Layer.merge(
  discountProviders,
  DiscountReleaseGateService.Live.pipe(
    Layer.provide(DiscountReleaseGateEvaluatorLive)
  )
);

const processScope = Scope.makeUnsafe();
const processMemoMap = Layer.makeMemoMapUnsafe();

export const DiscountServiceLiveWithDependencies = Layer.fromBuild(() =>
  Layer.buildWithMemoMap(
    DiscountService.Live.pipe(Layer.provide(discountServiceDependencies)),
    processMemoMap,
    processScope
  )
);

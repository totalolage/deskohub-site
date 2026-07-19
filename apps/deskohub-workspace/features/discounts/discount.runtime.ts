import "server-only";
import { GoogleCalendarService } from "@deskohub/google-calendar";
import { Effect, Layer, Scope } from "effect";
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

const discountRepositories = Layer.mergeAll(
  DiscountDefinitionRepository.Live,
  DiscountCodeRepository.Live
).pipe(Layer.provide(WorkspaceDatabaseLive));

const recoverableGoogleCalendarService = GoogleCalendarServiceLive.pipe(
  Layer.catchTag("GoogleCalendarConfigError", (cause) =>
    Layer.succeed(GoogleCalendarService, {
      listEvents: () => Effect.fail(cause),
    })
  )
);

const providerDependencies = Layer.mergeAll(
  discountRepositories,
  recoverableGoogleCalendarService,
  CalendarResourceConfig.Live,
  DotyposServiceLive
);

const discountProviders = Layer.mergeAll(
  CalendarDiscountProvider.Live,
  CustomerDiscountProvider.Live,
  CodeDiscountProvider.Live
).pipe(Layer.provide(providerDependencies));

const processScope = Scope.makeUnsafe();
const processMemoMap = Layer.makeMemoMapUnsafe();

export const DiscountServiceLiveWithDependencies = Layer.fromBuild(() =>
  Layer.buildWithMemoMap(
    DiscountService.Live.pipe(Layer.provide(discountProviders)),
    processMemoMap,
    processScope
  )
);

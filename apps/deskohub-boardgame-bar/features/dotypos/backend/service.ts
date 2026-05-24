import { DotyposService as SharedDotyposService } from "@deskohub/dotypos/backend/service";
import { DotyposRuntimeConfig } from "@deskohub/dotypos/config";
import { ValidationError } from "@deskohub/dotypos/errors";
import type { Product } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import { getLocale, type Locale } from "@/features/i18n";
import type { TableReservationFormData } from "@/features/table-reservation/schemas/table-reservation";
import { DotyposConfigFromEnv } from "./dotypos-config.layer";
import { isCategoryDisplayable } from "../utils/category-utils";
import { createNoteData } from "../utils/note-metadata";

type BarTableReservationInput = TableReservationFormData & {
  readonly locale: Locale;
};

export class DotyposService extends Effect.Service<DotyposService>()(
  "DotyposService",
  {
    effect: Effect.gen(function* () {
      const sharedDotypos = yield* SharedDotyposService;
      const config = yield* DotyposRuntimeConfig;

      const buildNote = (input: BarTableReservationInput) =>
        [
          input.specialRequests,
          `Preference stolu: ${input.needsLargerTable ? "Velký" : input.needsPrivateSpace ? "Soukromý" : "bez preference"}`,
          createNoteData({
            ...input,
            source: "website",
            timestamp: new Date(),
          }),
        ].join("\n");

      const getMenuItems = Effect.fn("getMenuItems")(function* () {
        const categories = yield* sharedDotypos.getCategories();

        const productsByCategory = yield* Effect.all(
          categories
            .filter((category) => category.id)
            .filter(isCategoryDisplayable)
            .map((category) =>
              sharedDotypos
                .getProducts({
                  categoryId: category.id,
                  includeDeleted: false,
                })
                .pipe(Effect.orElseSucceed(() => []))
            ),
          { concurrency: "inherit" }
        );

        const productMap = new Map<string, Product>();
        for (const categoryProducts of productsByCategory) {
          for (const product of categoryProducts) {
            if (product.id && product.display && !product.deleted) {
              productMap.set(product.id, product);
            }
          }
        }

        return {
          products: Array.from(productMap.values()),
          categories,
        };
      });

      const createBarTableReservation = Effect.fn("createBarTableReservation")(
        function* (input: BarTableReservationInput) {
          const [firstName = "", ...lastNameParts] = input.name
            .trim()
            .split(/\s+/);
          const lastName = lastNameParts.join(" ") || undefined;

          const customer = yield* sharedDotypos.findOrCreateCustomer({
            firstName,
            lastName,
            email: input.email,
            phone: input.phone,
          });

          if (!customer.id) {
            return yield* Effect.fail(
              new ValidationError({
                message: "Failed to create or find customer",
              })
            );
          }

          const tableId = yield* sharedDotypos.getTables().pipe(
            Effect.map(
              (tables) =>
                tables.find(
                  (table) =>
                    table.display &&
                    table.enabled &&
                    table.id &&
                    config.reservationTableIds.includes(table.id)
                )?.id
            ),
            Effect.filterOrFail(
              (tableId): tableId is string => tableId != null,
              () =>
                new ValidationError({
                  message: "No Dotypos reservation table is available",
                })
            )
          );

          return yield* sharedDotypos.createReservation({
            customerId: customer.id,
            startDate: input.datetime,
            endDate: new Date(
              input.datetime.getTime() + input.duration * 60 * 60 * 1000
            ),
            seats: input.guestCount,
            tableId,
            status: "NEW",
            note: buildNote(input),
          });
        }
      );

      return {
        ...sharedDotypos,
        getMenuItems,
        createReservation: (input: TableReservationFormData) =>
          createBarTableReservation({
            ...input,
            locale: getLocale(),
          }),
      };
    }),
    dependencies: [
      Layer.provide(SharedDotyposService.Default, DotyposConfigFromEnv),
      DotyposRuntimeConfigLive,
    ],
  }
) {}

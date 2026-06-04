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

      const getMenuItems = Effect.fn("getMenuItems")(
        function* () {
          yield* Effect.logInfo("Dotypos menu item load started");

          const categories = yield* sharedDotypos.getCategories();
          yield* Effect.annotateLogsScoped({ categories });
          yield* Effect.logInfo("Dotypos menu categories loaded");

          const displayableCategories = categories
            .filter((category) => category.id)
            .filter(isCategoryDisplayable);
          yield* Effect.annotateLogsScoped({ displayableCategories });

          if (displayableCategories.length === 0) {
            yield* Effect.logWarning(
              "Dotypos menu has no displayable categories"
            );
          }

          const productsByCategory = yield* Effect.all(
            displayableCategories.map((category) =>
              sharedDotypos
                .getProducts({
                  categoryId: category.id,
                  includeDeleted: false,
                })
                .pipe(
                  Effect.tapError((cause) =>
                    Effect.logWarning("Dotypos category products load failed", {
                      category,
                      cause,
                    })
                  ),
                  Effect.orElseSucceed(() => [])
                )
            ),
            { concurrency: "inherit" }
          );
          yield* Effect.annotateLogsScoped({ productsByCategory });
          yield* Effect.logInfo("Dotypos menu products loaded");

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
        },
        (effect) => effect.pipe(Effect.scoped)
      );

      const createBarTableReservation = Effect.fn("createBarTableReservation")(
        function* (input: BarTableReservationInput) {
          yield* Effect.annotateLogsScoped({ input });
          yield* Effect.logInfo(
            "Dotypos bar table reservation creation started"
          );

          const [firstName = "", ...lastNameParts] = input.name
            .trim()
            .split(/\s+/);
          const lastName = lastNameParts.join(" ") || undefined;
          yield* Effect.annotateLogsScoped({ firstName, lastName });

          const customer = yield* sharedDotypos.findOrCreateCustomer({
            firstName,
            lastName,
            email: input.email,
            phone: input.phone,
          });
          yield* Effect.annotateLogsScoped({ customer });
          yield* Effect.logInfo("Dotypos reservation customer resolved");

          if (!customer.id) {
            yield* Effect.logWarning(
              "Dotypos reservation customer is missing id",
              { customer }
            );

            return yield* Effect.fail(
              new ValidationError({
                message: "Failed to create or find customer",
              })
            );
          }

          const tables = yield* sharedDotypos.getTables();
          yield* Effect.annotateLogsScoped({ tables });
          const tableId = tables.find(
            (table) =>
              table.display &&
              table.enabled &&
              table.id &&
              config.reservationTableIds.includes(table.id)
          )?.id;

          if (tableId == null) {
            yield* Effect.logWarning(
              "No Dotypos reservation table is available",
              {
                reservationTableIds: config.reservationTableIds,
                tables,
              }
            );

            return yield* Effect.fail(
              new ValidationError({
                message: "No Dotypos reservation table is available",
              })
            );
          }

          yield* Effect.annotateLogsScoped({ tableId });
          yield* Effect.logInfo("Dotypos reservation table selected");

          const reservationInput = {
            customerId: customer.id,
            startDate: input.datetime,
            endDate: new Date(
              input.datetime.getTime() + input.duration * 60 * 60 * 1000
            ),
            seats: input.guestCount,
            tableId,
            status: "NEW",
            note: buildNote(input),
          } as const;
          yield* Effect.annotateLogsScoped({ reservationInput });

          const reservation =
            yield* sharedDotypos.createReservation(reservationInput);
          yield* Effect.annotateLogsScoped({ reservation });
          yield* Effect.logDebug("Dotypos bar table reservation created");

          return reservation;
        },
        (effect) => effect.pipe(Effect.scoped)
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

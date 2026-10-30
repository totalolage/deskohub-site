import "@/shared/testing/workspace-test-env";
import "@/shared/polyfills/temporal";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  GoogleCalendarAPIError,
  type GoogleCalendarEvent,
  type IGoogleCalendarService,
} from "@deskohub/google-calendar";
import { GoogleCalendarServiceMock } from "@deskohub/google-calendar/backend/service.mock";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer, Schema } from "effect";
import * as googleCalendarConfigModule from "@/shared/backend/config/google-calendar.config";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";
import * as discountDefinitionRepositoryModule from "./discount-definition.repository";
import { DiscountDefinitionRepositoryMock } from "./discount-definition.repository.mock";
import { storedDiscountIdSchema } from "./persistence-contracts";

const discountId = Schema.decodeUnknownSync(storedDiscountIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82edb7"
);

const saleEvent: GoogleCalendarEvent = {
  id: "sale-event",
  summary: "Operator calendar title",
  description: discountId,
  start: { date: "2026-07-14" },
  end: { date: "2026-08-02" },
};

const listEvents = mock<IGoogleCalendarService["listEvents"]>(() =>
  Effect.succeed([saleEvent])
);
const loadById = mock<
  discountDefinitionRepositoryModule.IDiscountDefinitionRepository["loadById"]
>(({ discountId: id }) =>
  Effect.succeed({
    id,
    labels: { "en-US": "Database sale", "cs-CZ": "Databázová sleva" },
    adjustment: { kind: "percentage", basisPoints: 2000 },
    products: [{ kind: "cowork" }],
  })
);
const nextCache = recordNextCache();

mock.module("next/cache", () => nextCache.module);
mock.module("@/shared/backend/config/google-calendar.config", () => ({
  ...googleCalendarConfigModule,
  WorkspaceGoogleCalendarLayer: GoogleCalendarServiceMock({ listEvents }),
  CalendarResourceConfig: class extends googleCalendarConfigModule.CalendarResourceConfig {
    static override Default = Layer.succeed(
      googleCalendarConfigModule.CalendarResourceConfig,
      {
        salesCalendarId: Schema.decodeUnknownSync(
          googleCalendarConfigModule.salesCalendarIdSchema
        )("sales-calendar"),
        workspaceLimitationsCalendarId: Schema.decodeUnknownSync(
          googleCalendarConfigModule.workspaceLimitationsCalendarIdSchema
        )("workspace-limitations-calendar"),
      }
    );
  },
}));
mock.module("./discount-definition.repository", () => ({
  ...discountDefinitionRepositoryModule,
  DiscountDefinitionRepository: class extends discountDefinitionRepositoryModule.DiscountDefinitionRepository {
    static override Default = DiscountDefinitionRepositoryMock({ loadById });
  },
}));

const { calendarDiscountSourceTag, loadCalendarDiscountSource } = await import(
  "./calendar-discount-source.server"
);

beforeEach(() => {
  for (const fn of [listEvents, loadById]) {
    fn.mockClear();
  }
  nextCache.clear();
});

describe("loadCalendarDiscountSource", () => {
  test("shares a complete source under the advertised pricing lifetime", async () => {
    const source = await loadCalendarDiscountSource("2026-07-14");

    expect(source.complete).toBe(true);
    expect(source.sales).toHaveLength(1);
    expect(nextCache.calls).toEqual([
      { cacheLife: "advertisedPricingSources" },
      { cacheTag: [calendarDiscountSourceTag] },
    ]);
  });

  test("never shares a source missing a discount definition", async () => {
    loadById.mockImplementationOnce(() =>
      Effect.fail(
        new EffectDrizzleQueryError({
          query: "select discount definition",
          params: [],
          cause: new Error("database unavailable"),
        })
      )
    );

    const source = await loadCalendarDiscountSource("2026-07-14");

    expect(source).toEqual({ sales: [], complete: false });
    expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
  });

  test("marks a failed Calendar load uncacheable before rejecting", async () => {
    listEvents.mockImplementationOnce(() =>
      Effect.fail(
        new GoogleCalendarAPIError({
          operation: "events.list",
          statusCode: 503,
          message: "Unavailable",
          cause: new Error("provider unavailable"),
        })
      )
    );

    await expect(loadCalendarDiscountSource("2026-07-14")).rejects.toThrow();
    expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
  });
});

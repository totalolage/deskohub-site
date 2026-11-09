import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { GoogleCalendarService } from "@deskohub/google-calendar";
import { Effect, Layer } from "effect";
import type { WorkspaceProductTarget } from "@/features/discounts/product-target";
import { CalendarResourceConfig } from "@/shared/backend/config/calendar-resource.config";
import {
  makeRecordingWorkspaceDatabase,
  type RecordingWorkspaceDatabase,
} from "@/shared/testing/workspace-recording-database.test-utils";
import type { StoredDiscountId } from "../persistence-contracts";
import type { CreateDiscountAdminInput } from "./contracts";
import { DiscountAdministration } from "./discount-administration.service";

const discountId = "01980000-0000-7000-8000-000000000001" as StoredDiscountId;

const definition = (
  products: CreateDiscountAdminInput["products"]
): CreateDiscountAdminInput => ({
  labels: { "cs-CZ": "Stoly", "en-US": "Desks" },
  adjustment: { kind: "percentage", basisPoints: 1000 },
  products,
});

const runAdministration = <A, E>(
  recording: RecordingWorkspaceDatabase,
  operation: (
    administration: DiscountAdministration["Service"]
  ) => Effect.Effect<A, E>
) =>
  Effect.gen(function* () {
    return yield* operation(yield* DiscountAdministration);
  }).pipe(
    Effect.provide(
      DiscountAdministration.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            recording.layer,
            Layer.mock(GoogleCalendarService, {}),
            Layer.mock(DotyposService, {}),
            Layer.mock(CalendarResourceConfig, {
              salesCalendarId: "sales-calendar" as never,
            })
          )
        )
      )
    ),
    Effect.result,
    Effect.runPromise
  );

const writesTargets = (recording: RecordingWorkspaceDatabase) =>
  recording.statements.some(({ sql }) =>
    /^insert into "discount_targets"/i.test(sql)
  );

const reservedDesk = {
  kind: "cowork",
  tier: "reserved-desk",
} satisfies WorkspaceProductTarget;

describe("DiscountAdministration cowork tier targets", () => {
  test("creates a discount with a tier target", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([[[discountId]], []]);

    const result = await runAdministration(recording, (administration) =>
      administration.createDiscount(definition([reservedDesk]))
    );

    expect(result).toMatchObject({ _tag: "Success", success: discountId });
    expect(writesTargets(recording)).toBe(true);
  });

  test("adds a tier target to a stored discount", async () => {
    const recording = await makeRecordingWorkspaceDatabase();
    recording.setRows([[[discountId]], []]);

    const result = await runAdministration(recording, (administration) =>
      administration.updateDiscount({
        id: discountId,
        ...definition([reservedDesk, { kind: "cowork", tier: "open-space" }]),
      })
    );

    expect(result._tag).toBe("Success");
    expect(writesTargets(recording)).toBe(true);
  });
});

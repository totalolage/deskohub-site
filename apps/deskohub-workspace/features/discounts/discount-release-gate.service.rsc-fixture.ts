import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import { Deferred, Effect, Exit, Fiber, Layer } from "effect";
import type { IWorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import type { PostHogFeatureFlagDefinitions } from "@/features/feature-flags/generated/contract";
import { renderServerComponents } from "@/shared/testing/react-server-render.test-utils";
import {
  DiscountReleaseGateService,
  type DiscountReleaseGates,
} from "./discount-release-gate.service";

type FlagSnapshot = Effect.Success<
  ReturnType<IWorkspaceFeatureFlagService["evaluateFlags"]>
>;

let calendarSales = false;
let release: Deferred.Deferred<void>;

// PostHog answers once the test releases it, with the opposite
// `calendar_sales` value on every call.
const evaluateFlags = mock<IWorkspaceFeatureFlagService["evaluateFlags"]>(() =>
  Deferred.await(release).pipe(
    Effect.andThen(Effect.promise(() => Promise.resolve())),
    Effect.andThen(
      Effect.sync((): FlagSnapshot => {
        calendarSales = !calendarSales;
        const values: PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions> =
          {
            calendar_sales: calendarSales,
            customer_discounts: true,
            discount_codes: true,
          };
        return { getFlag: (key) => values[key] };
      })
    )
  )
);

const featureFlagLayer = WorkspaceFeatureFlagServiceMock({ evaluateFlags });

// One Workspace run with its own build of the gate layer, as each page,
// layout, and loader of a render starts.
const evaluateInOwnRun = (
  operation: "quote" | "affirm_displayed_discounts" | "apply_discount_code"
) =>
  DiscountReleaseGateService.pipe(
    Effect.flatMap((releaseGates) => releaseGates.evaluate({ operation })),
    Effect.provide(
      DiscountReleaseGateService.Default.pipe(Layer.provide(featureFlagLayer))
    )
  );

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

// Releases PostHog from outside every render, once every component rendered
// so far has started waiting.
const releaseAfterRendersStart = () =>
  nextTurn()
    .then(nextTurn)
    .then(() => Effect.runSync(Deferred.succeed(release, undefined)));

const calendarSalesOf = (
  rendered: readonly PromiseSettledResult<DiscountReleaseGates>[]
) =>
  rendered.map((result) =>
    result.status === "fulfilled" ? result.value.calendarSales : result.reason
  );

describe("DiscountReleaseGateService in a React server render", () => {
  beforeEach(() => {
    evaluateFlags.mockClear();
    release = Deferred.makeUnsafe<void>();
    calendarSales = false;
  });

  test("shares one decision with every run and layer of a render", async () => {
    const [rendered] = await Promise.all([
      renderServerComponents([
        () => Effect.runPromise(evaluateInOwnRun("quote")),
        () => Effect.runPromise(evaluateInOwnRun("affirm_displayed_discounts")),
        async () => {
          await Effect.runPromise(evaluateInOwnRun("quote"));
          await nextTurn();
          return Effect.runPromise(evaluateInOwnRun("apply_discount_code"));
        },
      ]),
      releaseAfterRendersStart(),
    ]);

    expect(calendarSalesOf(rendered)).toEqual([true, true, true]);
    expect(evaluateFlags).toHaveBeenCalledTimes(1);
  });

  test("decides separately for concurrent renders", async () => {
    const renderRequest = () =>
      renderServerComponents([
        () => Effect.runPromise(evaluateInOwnRun("quote")),
        () => Effect.runPromise(evaluateInOwnRun("apply_discount_code")),
      ]);

    const [first, second] = await Promise.all([
      renderRequest(),
      renderRequest(),
      releaseAfterRendersStart(),
    ]);

    const decisions = [calendarSalesOf(first), calendarSalesOf(second)];
    expect(decisions.map((request) => new Set(request).size)).toEqual([1, 1]);
    expect(new Set(decisions.flat())).toEqual(new Set([true, false]));
    expect(evaluateFlags).toHaveBeenCalledTimes(2);
  });

  test("keeps deciding for the render when a consumer is interrupted", async () => {
    const interrupted =
      Promise.withResolvers<Exit.Exit<DiscountReleaseGates>>();

    const [rendered] = await Promise.all([
      renderServerComponents([
        async () => {
          const consumer = Effect.runFork(evaluateInOwnRun("quote"));
          await nextTurn();
          interrupted.resolve(
            await Effect.runPromise(
              Fiber.interrupt(consumer).pipe(
                Effect.andThen(Fiber.await(consumer))
              )
            )
          );
          return Effect.runPromise(
            evaluateInOwnRun("affirm_displayed_discounts")
          );
        },
        async () => {
          await interrupted.promise;
          return Effect.runPromise(evaluateInOwnRun("apply_discount_code"));
        },
      ]),
      interrupted.promise.then(releaseAfterRendersStart),
    ]);

    expect(Exit.hasInterrupts(await interrupted.promise)).toBe(true);
    expect(calendarSalesOf(rendered)).toEqual([true, true]);
    expect(evaluateFlags).toHaveBeenCalledTimes(1);
  });

  test("decides per run outside a render, such as in a Server Action", async () => {
    Effect.runSync(Deferred.succeed(release, undefined));

    const first = await Effect.runPromise(evaluateInOwnRun("quote"));
    const second = await Effect.runPromise(evaluateInOwnRun("quote"));

    expect([first.calendarSales, second.calendarSales]).toEqual([true, false]);
    expect(evaluateFlags).toHaveBeenCalledTimes(2);
  });
});

process.stdout.write("DISCOUNT_RELEASE_GATE_REACT_SERVER_PROOF\n");

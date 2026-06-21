import { describe, expect, test } from "bun:test";
import { Context, Effect, Exit, Layer, Schema } from "effect";
import { createMiddleware, createSafeActionClient } from "next-safe-action";
import { useAction } from "next-safe-action/hooks";
import { z } from "zod";
import { EffectAction } from "./effect-action";

class TestService extends Context.Service<
  TestService,
  { readonly multiplier: number }
>()("@deskohub/next-effect/test/ActionService") {}

const localeMiddleware = createMiddleware<{ ctx: object }>().define<{
  locale: "en-US";
}>(async ({ next }) =>
  next({
    ctx: {
      locale: "en-US",
    },
  })
);

function makeActionClient() {
  return createSafeActionClient({
    handleServerError(error) {
      return error.message;
    },
    defaultValidationErrorsShape: "flattened",
  }).use(localeMiddleware);
}

describe("EffectAction", () => {
  test("uses a real next-safe-action client schema and utils", async () => {
    const seen: string[] = [];
    const action = EffectAction.fromClient(makeActionClient())
      .inputSchema(Schema.toStandardSchemaV1(Schema.NonEmptyString), {
        async handleValidationErrorsShape() {
          seen.push("input-utils");
          return { formErrors: ["Invalid input"], fieldErrors: {} };
        },
      })
      .action(({ parsedInput }) => Effect.succeed(parsedInput), {
        async onSuccess() {
          seen.push("action-utils");
        },
      });

    await expect(action("value")).resolves.toEqual({ data: "value" });
    await expect(action("")).resolves.toMatchObject({
      validationErrors: expect.any(Object),
    });
    expect(seen).toEqual(["action-utils", "input-utils"]);
  });

  test("runs Zod-decoded input with ctx and layers", async () => {
    const action = EffectAction.fromClient(makeActionClient(), {
      layer: Layer.succeed(TestService, { multiplier: 2 }),
    })
      .inputSchema(z.object({ seats: z.string().transform(Number) }))
      .action(({ parsedInput, clientInput, ctx }) =>
        Effect.gen(function* () {
          const service = yield* TestService;
          return {
            raw: clientInput.seats,
            seats: parsedInput.seats * service.multiplier,
            locale: ctx.locale,
          };
        })
      );

    await expect(action({ seats: "21" })).resolves.toEqual({
      data: { raw: "21", seats: 42, locale: "en-US" },
    });
  });

  test("runs Standard Schema decoded input", async () => {
    const action = EffectAction.fromClient(makeActionClient())
      .inputSchema(Schema.toStandardSchemaV1(Schema.NumberFromString))
      .action(({ parsedInput, clientInput }) =>
        Effect.succeed({ parsedInput, clientInput })
      );

    await expect(action("7")).resolves.toEqual({
      data: { parsedInput: 7, clientInput: "7" },
    });
  });

  test("maps typed failures and fallible layer setup failures", async () => {
    const mapped = new Error("public");
    const client = EffectAction.fromClient(makeActionClient(), {
      layer: Layer.effect(TestService, Effect.fail("setup")),
      mapError: () => mapped,
    });
    const action = client
      .inputSchema(Schema.toStandardSchemaV1(Schema.String))
      .action(() =>
        Effect.gen(function* () {
          return yield* TestService;
        })
      );

    await expect(action("anything")).resolves.toEqual({
      serverError: "public",
    });
  });

  test("does not add a timeout by default", async () => {
    const action = EffectAction.fromClient(makeActionClient())
      .inputSchema(Schema.toStandardSchemaV1(Schema.String))
      .action(({ parsedInput }) => Effect.succeed(parsedInput));

    await expect(action("fast enough")).resolves.toEqual({
      data: "fast enough",
    });
  });

  test("custom runner can wrap the final effect and use configured layers", async () => {
    let calls = 0;
    let wrapped = false;
    const action = EffectAction.fromClient(makeActionClient(), {
      layer: Layer.succeed(TestService, { multiplier: 4 }),
      run: <A>(effect: Effect.Effect<A, unknown, never>) => {
        calls += 1;

        return Effect.runPromise(
          Effect.annotateLogs(
            Effect.tap(effect, () =>
              Effect.sync(() => {
                wrapped = true;
              })
            ),
            { runner: "workspace" }
          )
        );
      },
    })
      .inputSchema(Schema.toStandardSchemaV1(Schema.NumberFromString))
      .action(({ parsedInput }) =>
        Effect.gen(function* () {
          const service = yield* TestService;
          return parsedInput * service.multiplier;
        })
      );

    await expect(action("5")).resolves.toEqual({ data: 20 });
    expect(calls).toBe(1);
    expect(wrapped).toBe(true);
  });

  test("custom runner receives fallible layer errors after mapError", async () => {
    const mapped = new Error("public setup");
    let runnerError: unknown;
    const action = EffectAction.fromClient(makeActionClient(), {
      layer: Layer.effect(TestService, Effect.fail("setup")),
      mapError: () => mapped,
      run: async <A>(effect: Effect.Effect<A, unknown, never>) => {
        const exit = await Effect.runPromiseExit(
          Effect.tapError(effect, (error) =>
            Effect.sync(() => {
              runnerError = error;
            })
          )
        );

        if (Exit.isSuccess(exit)) {
          return exit.value;
        }

        throw mapped;
      },
    })
      .inputSchema(Schema.toStandardSchemaV1(Schema.String))
      .action(() =>
        Effect.gen(function* () {
          return yield* TestService;
        })
      );

    await expect(action("anything")).resolves.toEqual({
      serverError: "public setup",
    });
    expect(runnerError).toBe(mapped);
  });
});

if (process.env.NEXT_EFFECT_ACTION_TYPECHECK === "1") {
  const action = EffectAction.fromClient(makeActionClient())
    .inputSchema(Schema.toStandardSchemaV1(Schema.NumberFromString))
    .action(({ parsedInput, clientInput, ctx }) => {
      const decoded: number = parsedInput;
      const raw: string = clientInput;
      const locale: "en-US" = ctx.locale;

      // @ts-expect-error parsedInput is decoded to number.
      const wrongDecoded: string = parsedInput;

      return Effect.succeed(
        decoded + raw.length + locale.length + wrongDecoded.length
      );
    });

  action("1");
  const hook = useAction(action);
  hook.execute("1");
  void action("1").then((result) => {
    if (result.data !== undefined) {
      const data: number = result.data;

      // @ts-expect-error action data is inferred from the Effect success type.
      const wrongData: string = result.data;

      return data + wrongData.length;
    }
  });

  // @ts-expect-error client input must be the schema input type.
  action(1);

  // @ts-expect-error useAction preserves the action input type.
  hook.execute(1);

  void hook.executeAsync("1").then((result) => {
    if (result.data !== undefined) {
      const data: number = result.data;

      // @ts-expect-error useAction preserves action data inference.
      const wrongData: string = result.data;

      return data + wrongData.length;
    }
  });

  const zodAction = EffectAction.fromClient(makeActionClient())
    .inputSchema(z.object({ seats: z.string().transform(Number) }))
    .action(({ parsedInput, clientInput }) => {
      const decoded: number = parsedInput.seats;
      const raw: string = clientInput.seats;

      // @ts-expect-error Zod parsed input is transformed to number.
      const wrongDecoded: string = parsedInput.seats;

      return Effect.succeed(decoded + raw.length + wrongDecoded.length);
    });

  zodAction({ seats: "1" });

  // @ts-expect-error Zod client input must be the pre-transform input type.
  zodAction({ seats: 1 });
}

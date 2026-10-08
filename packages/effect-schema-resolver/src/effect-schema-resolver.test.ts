/*
 * Cases adapted from the React Hook Form Effect resolver tests:
 * https://github.com/react-hook-form/resolvers/tree/5483a0335edcb61c9d4cc5b669d30314d366987e/effect-ts/src/__tests__
 *
 * MIT License
 *
 * Copyright (c) 2019-present Beier(Bill) Luo
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { describe, expect, test } from "bun:test";
import {
  Context,
  Effect,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";
import type {
  CriteriaMode,
  Field,
  FieldValues,
  Resolver,
  ResolverOptions,
} from "react-hook-form";
import { effectSchemaResolver } from "./index";

type Expect<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;

const resolverOptions = <Values extends FieldValues>(
  options: {
    readonly criteriaMode?: CriteriaMode;
    readonly fields?: Record<string, Field["_f"]>;
    readonly shouldUseNativeValidation?: boolean;
  } = {}
): ResolverOptions<Values> => ({
  fields: options.fields ?? {},
  criteriaMode: options.criteriaMode,
  shouldUseNativeValidation: options.shouldUseNativeValidation ?? false,
});

const passwordSchema = Schema.String.check(
  Schema.isMinLength(8, { message: "Must be at least 8 characters." }),
  Schema.isPattern(/[A-Z]/, { message: "At least 1 uppercase letter." })
);

const signupSchema = Schema.Struct({
  username: Schema.String.check(
    Schema.isNonEmpty({ message: "A username is required." })
  ),
  password: passwordSchema,
  age: Schema.FiniteFromString.check(
    Schema.isGreaterThan(17, { message: "Must be an adult." })
  ),
  tags: Schema.Array(
    Schema.Struct({
      name: Schema.String.check(
        Schema.isNonEmpty({ message: "A tag name is required." })
      ),
    })
  ),
});

const validSignup = {
  username: "joe",
  password: "Secret-Password",
  age: "30",
  tags: [{ name: "boardgames" }],
};

describe("effectSchemaResolver", () => {
  test("returns the decoded output when validation passes", async () => {
    const result = await effectSchemaResolver(signupSchema)(
      validSignup,
      undefined,
      resolverOptions()
    );

    expect(result).toEqual({
      errors: {},
      values: { ...validSignup, age: 30 },
    });
  });

  test("returns a copy of the form values in raw mode", async () => {
    const result = await effectSchemaResolver(signupSchema, undefined, {
      raw: true,
    })(validSignup, undefined, resolverOptions());

    expect(result).toEqual({ errors: {}, values: validSignup });
    expect(result.values).not.toBe(validSignup);
  });

  test("nests field, array, and root errors", async () => {
    const schema = Schema.Struct({
      username: Schema.String.check(
        Schema.isNonEmpty({ message: "A username is required." })
      ),
      tags: Schema.Array(
        Schema.Struct({
          name: Schema.String.check(
            Schema.isNonEmpty({ message: "A tag name is required." })
          ),
        })
      ),
      profile: Schema.Struct({ city: Schema.String }),
    }).check(
      Schema.makeFilter(() => false, { message: "The form is incomplete." })
    );

    const result = await effectSchemaResolver(schema)(
      {
        username: "",
        tags: [{ name: "ok" }, { name: "" }],
        profile: { city: "Praha" },
      },
      undefined,
      resolverOptions()
    );

    expect(result.values).toEqual({});
    expect(result.errors).toEqual({
      username: {
        message: "A username is required.",
        type: "Filter",
        ref: undefined,
      },
      tags: [
        undefined,
        {
          name: {
            message: "A tag name is required.",
            type: "Filter",
            ref: undefined,
          },
        },
      ],
    });

    const rootResult = await effectSchemaResolver(schema)(
      { username: "joe", tags: [], profile: { city: "Praha" } },
      undefined,
      resolverOptions()
    );

    expect(Object.keys(rootResult.errors)).toEqual(["root"]);
    expect(rootResult.errors.root?.message).toBe("The form is incomplete.");
    expect(rootResult.errors.root?.type).toBe("Filter");
  });

  test("routes a structural check to the field named by its path", async () => {
    const schema = Schema.Struct({
      paid: Schema.Boolean,
      paidOn: Schema.String,
      dueDate: Schema.String,
    }).check(
      Schema.makeFilter((value) =>
        (value.paid ? value.paidOn : value.dueDate) === ""
          ? {
              path: [value.paid ? "paidOn" : "dueDate"],
              issue: "Enter a date.",
            }
          : true
      )
    );

    const result = await effectSchemaResolver(schema)(
      { paid: true, paidOn: "", dueDate: "" },
      undefined,
      resolverOptions()
    );

    expect(result.errors).toEqual({
      paidOn: { message: "Enter a date.", type: "Filter", ref: undefined },
    });
  });

  test("renders the same messages as Effect's Standard Schema adapter", async () => {
    const values = {
      username: "",
      password: "short",
      age: "ten",
      tags: [{ name: "" }],
      extra: true,
    };
    const parseOptions = { onExcessProperty: "error" } as const;
    const standard = await Schema.toStandardSchemaV1(
      Schema.Struct({ ...signupSchema.fields }),
      { parseOptions }
    )["~standard"].validate(values);
    const result = await effectSchemaResolver(signupSchema, parseOptions)(
      values,
      undefined,
      resolverOptions({ criteriaMode: "all" })
    );

    const resolverMessages = [
      ...Object.values(
        (result.errors as Record<string, { types?: object }>).extra?.types ?? {}
      ).flat(),
      result.errors.username?.message,
      ...Object.values(result.errors.password?.types ?? {}).flat(),
      ...Object.values(result.errors.age?.types ?? {}).flat(),
      result.errors.tags?.[0]?.name?.message,
    ];

    expect(standard.issues?.map((issue) => issue.message)).toEqual(
      resolverMessages
    );
  });

  test("reports every issue by default and the first with errors: first", async () => {
    const invalid = { ...validSignup, username: "", age: "1" };

    const all = await effectSchemaResolver(signupSchema)(
      invalid,
      undefined,
      resolverOptions()
    );
    const first = await effectSchemaResolver(signupSchema, {
      errors: "first",
    })(invalid, undefined, resolverOptions());

    expect(Object.keys(all.errors)).toEqual(["username", "age"]);
    expect(Object.keys(first.errors)).toEqual(["username"]);
  });

  test("keeps only the first message per field unless criteriaMode is all", async () => {
    const schema = Schema.Struct({ password: passwordSchema });
    const values = { password: "short" };

    const firstError = await effectSchemaResolver(schema)(
      values,
      undefined,
      resolverOptions({ criteriaMode: "firstError" })
    );
    const all = await effectSchemaResolver(schema)(
      values,
      undefined,
      resolverOptions({ criteriaMode: "all" })
    );

    expect(firstError.errors).toEqual({
      password: {
        message: "Must be at least 8 characters.",
        type: "Filter",
        ref: undefined,
      },
    });
    expect(all.errors).toEqual({
      password: {
        message: "Must be at least 8 characters.",
        type: "Filter",
        types: {
          Filter: [
            "Must be at least 8 characters.",
            "At least 1 uppercase letter.",
          ],
        },
        ref: undefined,
      },
    });
  });

  test.each(["hasOwnProperty", "toString"])(
    "reports an error for a field named %s",
    async (name) => {
      const schema = Schema.Struct({
        [name]: Schema.String.check(Schema.isMinLength(1)),
      });

      const result = await effectSchemaResolver(schema)(
        { [name]: "" },
        undefined,
        resolverOptions()
      );

      expect(Object.hasOwn(result.errors, name)).toBe(true);
    }
  );

  test("decodes asynchronous schemas in the default async mode", async () => {
    const schema = Schema.Struct({
      code: Schema.String.pipe(
        Schema.decodeTo(Schema.String, {
          decode: SchemaGetter.transformOrFail((code: string) =>
            Effect.sleep("1 millis").pipe(
              Effect.andThen(
                code === "valid"
                  ? Effect.succeed(code.toUpperCase())
                  : Effect.fail(
                      new SchemaIssue.InvalidValue(Option.some(code), {
                        message: "Unknown code.",
                      })
                    )
              )
            )
          ),
          encode: SchemaGetter.String(),
        })
      ),
    });
    const resolver = effectSchemaResolver(schema);

    const pending = resolver({ code: "valid" }, undefined, resolverOptions());
    expect(pending).toBeInstanceOf(Promise);
    expect(await pending).toEqual({ errors: {}, values: { code: "VALID" } });

    const invalid = await resolver(
      { code: "nope" },
      undefined,
      resolverOptions()
    );
    expect(invalid.errors.code?.message).toBe("Unknown code.");

    expect(() =>
      effectSchemaResolver(schema, undefined, { mode: "sync" })(
        { code: "valid" },
        undefined,
        resolverOptions()
      )
    ).toThrow();
  });

  test("resolves synchronously in sync mode", () => {
    const resolver = effectSchemaResolver(signupSchema, undefined, {
      mode: "sync",
    });

    expect(resolver(validSignup, undefined, resolverOptions())).toEqual({
      errors: {},
      values: { ...validSignup, age: 30 },
    });
    expect(
      effectSchemaResolver(signupSchema, undefined, {
        mode: "sync",
        raw: true,
      })(validSignup, undefined, resolverOptions())
    ).toEqual({ errors: {}, values: validSignup });
  });

  test("decodes with explicitly supplied Effect services", async () => {
    class ReservedNames extends Context.Service<
      ReservedNames,
      { readonly has: (name: string) => boolean }
    >()("EffectSchemaResolverTest/ReservedNames") {}

    const schema = Schema.Struct({
      username: Schema.String.pipe(
        Schema.decodeTo(Schema.String, {
          decode: SchemaGetter.transformOrFail((username: string) =>
            ReservedNames.use((reserved) =>
              reserved.has(username)
                ? Effect.fail(
                    new SchemaIssue.InvalidValue(Option.some(username), {
                      message: "That name is taken.",
                    })
                  )
                : Effect.succeed(username)
            )
          ),
          encode: SchemaGetter.String(),
        })
      ),
    });
    const services = Context.make(ReservedNames, {
      has: (name) => name === "admin",
    });

    // @ts-expect-error Service-requiring schemas need explicit services.
    effectSchemaResolver(schema);
    // @ts-expect-error Service-requiring schemas need explicit services.
    effectSchemaResolver(schema, undefined, { mode: "sync" });

    const resolver = effectSchemaResolver(schema, undefined, { services });

    expect(
      await resolver({ username: "joe" }, undefined, resolverOptions())
    ).toEqual({ errors: {}, values: { username: "joe" } });
    expect(
      (await resolver({ username: "admin" }, undefined, resolverOptions()))
        .errors.username?.message
    ).toBe("That name is taken.");
  });

  test("reports and clears native validation messages", async () => {
    const usernameRef = {
      name: "username",
      validationMessage: "",
      setCustomValidity(message: string) {
        this.validationMessage = message;
      },
      reportValidity: () => true,
    };
    const options = resolverOptions<{ username: string }>({
      shouldUseNativeValidation: true,
      fields: {
        username: {
          name: "username",
          ref: usernameRef as unknown as HTMLInputElement,
        },
      },
    });
    const resolver = effectSchemaResolver(
      Schema.Struct({
        username: Schema.String.check(
          Schema.isNonEmpty({ message: "A username is required." })
        ),
      })
    );

    await resolver({ username: "" }, undefined, options);
    expect(usernameRef.validationMessage).toBe("A username is required.");

    await resolver({ username: "joe" }, undefined, options);
    expect(usernameRef.validationMessage).toBe("");
  });

  test("infers encoded form values and decoded output", () => {
    const resolver = effectSchemaResolver(
      Schema.Struct({ age: Schema.FiniteFromString })
    );
    const rawResolver = effectSchemaResolver(
      Schema.Struct({ age: Schema.FiniteFromString }),
      undefined,
      { raw: true }
    );

    type _Decoded = Expect<
      Equal<
        typeof resolver,
        Resolver<{ readonly age: string }, unknown, { readonly age: number }>
      >
    >;
    type _Raw = Expect<
      Equal<
        typeof rawResolver,
        Resolver<{ readonly age: string }, unknown, { readonly age: string }>
      >
    >;
  });
});

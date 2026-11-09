/*
 * Adapted for Effect v4 from the React Hook Form Effect resolver:
 * https://github.com/react-hook-form/resolvers/blob/5483a0335edcb61c9d4cc5b669d30314d366987e/effect-ts/src/effect-ts.ts
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

import { toNestErrors, validateFieldsNatively } from "@hookform/resolvers";
import {
  Context,
  Effect,
  type Schema,
  type SchemaAST,
  SchemaIssue,
  SchemaParser,
} from "effect";
import {
  appendErrors,
  type FieldError,
  type FieldValues,
  type Resolver,
  type ResolverOptions,
  type ResolverResult,
} from "react-hook-form";

type ResolverMode = {
  /**
   * `"sync"` resolves without a promise and throws when the schema decodes
   * asynchronously. Defaults to `"async"`.
   */
  readonly mode?: "async" | "sync" | undefined;
};

/**
 * A schema whose decoding requires Effect services must receive them
 * explicitly; React Hook Form's resolver context is not an Effect environment.
 */
type ResolverServices<Services> = [Services] extends [never]
  ? { readonly services?: Context.Context<never> | undefined }
  : { readonly services: Context.Context<Services> };

type ResolverArguments<Services, Raw extends boolean> = [Services] extends [
  never,
]
  ? Raw extends true
    ? [
        parseOptions: SchemaAST.ParseOptions | undefined,
        resolverOptions: ResolverMode &
          ResolverServices<never> & { readonly raw: true },
      ]
    : [
        parseOptions?: SchemaAST.ParseOptions,
        resolverOptions?: ResolverMode &
          ResolverServices<never> & { readonly raw?: false | undefined },
      ]
  : [
      parseOptions: SchemaAST.ParseOptions | undefined,
      resolverOptions: ResolverMode &
        ResolverServices<Services> &
        (Raw extends true
          ? { readonly raw: true }
          : { readonly raw?: false | undefined }),
    ];

type FieldIssue = {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
  readonly type: string;
};

const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

// Messages come from Effect's Standard Schema formatter so annotations render
// exactly as they do through `Schema.toStandardSchemaV1`; this walk only keeps
// each leaf's issue tag for React Hook Form's error `type`.
const toFieldIssues = (
  issue: SchemaIssue.Issue,
  path: ReadonlyArray<PropertyKey>
): ReadonlyArray<FieldIssue> => {
  switch (issue._tag) {
    case "Pointer":
      return toFieldIssues(issue.issue, [...path, ...issue.path]);
    case "Encoding":
      return toFieldIssues(issue.issue, path);
    case "Composite":
      return issue.issues.flatMap((child) => toFieldIssues(child, path));
    case "AnyOf":
      if (issue.issues.length > 0) {
        return issue.issues.flatMap((child) => toFieldIssues(child, path));
      }
      break;
  }

  return formatIssue(issue).issues.map((formatted) => ({
    path: [
      ...path,
      ...(formatted.path ?? []).map((segment) =>
        typeof segment === "object" ? segment.key : segment
      ),
    ],
    message: formatted.message,
    type: issue._tag,
  }));
};

const toFieldErrors = (
  issue: SchemaIssue.Issue,
  validateAllFieldCriteria: boolean
): Record<string, FieldError> => {
  // A null-prototype accumulator keeps fields named after inherited members,
  // such as `toString`, from being mistaken for existing errors.
  const errors: Record<string, FieldError> = Object.create(null);

  for (const { path, message, type } of toFieldIssues(issue, [])) {
    const name = path.length === 0 ? "root" : path.map(String).join(".");
    errors[name] ??= { message, type };

    if (validateAllFieldCriteria) {
      const previous = errors[name].types?.[type];
      errors[name] = appendErrors(
        name,
        validateAllFieldCriteria,
        errors,
        type,
        previous === undefined
          ? message
          : [
              ...(Array.isArray(previous) ? previous : [String(previous)]),
              message,
            ]
      ) as FieldError;
    }
  }

  return errors;
};

export function effectSchemaResolver<
  Input extends FieldValues,
  TContext,
  Output,
  Services = never,
>(
  schema: Schema.Codec<Output, Input, Services, unknown>,
  ...options: ResolverArguments<Services, false>
): Resolver<Input, TContext, Output>;

export function effectSchemaResolver<
  Input extends FieldValues,
  TContext,
  Output,
  Services = never,
>(
  schema: Schema.Codec<Output, Input, Services, unknown>,
  ...options: ResolverArguments<Services, true>
): Resolver<Input, TContext, Input>;

/**
 * Creates a React Hook Form resolver that decodes form values with an Effect
 * schema. Form values use the schema's encoded type and submitted values use
 * its decoded type unless `raw` is set.
 *
 * @example
 * const schema = Schema.Struct({ name: Schema.NonEmptyString });
 *
 * useForm({ resolver: effectSchemaResolver(schema) });
 */
export function effectSchemaResolver<
  Input extends FieldValues,
  TContext,
  Output,
  Services,
>(
  schema: Schema.Codec<Output, Input, Services, unknown>,
  parseOptions?: SchemaAST.ParseOptions,
  resolverOptions: ResolverMode & {
    readonly raw?: boolean | undefined;
    readonly services?: Context.Context<Services> | undefined;
  } = {}
): Resolver<Input, TContext, Output | Input> {
  const decode = SchemaParser.decodeUnknownEffect(schema, {
    errors: "all",
    ...parseOptions,
  });
  // The overloads require `services` whenever decoding needs any.
  const services =
    resolverOptions.services ?? (Context.empty() as Context.Context<Services>);

  const resolve = (
    values: Input,
    options: ResolverOptions<Input>
  ): Effect.Effect<ResolverResult<Input, Output | Input>, never, Services> =>
    decode(values).pipe(
      Effect.matchEffect({
        onFailure: (issue) =>
          Effect.sync(() => ({
            values: {},
            errors: toNestErrors(
              toFieldErrors(
                issue,
                !options.shouldUseNativeValidation &&
                  options.criteriaMode === "all"
              ),
              options
            ),
          })),
        onSuccess: (output) =>
          Effect.sync(() => {
            if (options.shouldUseNativeValidation) {
              validateFieldsNatively({}, options);
            }

            return {
              values: resolverOptions.raw ? { ...values } : output,
              errors: {},
            };
          }),
      })
    );

  return resolverOptions.mode === "sync"
    ? (values, _context, options) =>
        Effect.runSyncWith(services)(resolve(values, options))
    : (values, _context, options) =>
        Effect.runPromiseWith(services)(resolve(values, options));
}

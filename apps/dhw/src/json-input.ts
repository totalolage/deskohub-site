import { Effect, FileSystem, Schema } from "effect";
import { InvalidMutationInputError } from "./command-runtime";

/**
 * Parses operator-supplied JSON and decodes it with the strict contract
 * options, so an unknown key fails instead of being dropped. `subject` names
 * the value in the error, such as "audience filter".
 */
export const decodeJsonInput = <S extends Schema.Top>(
  schema: S,
  subject: string,
  contents: string
): Effect.Effect<S["Type"], InvalidMutationInputError, S["DecodingServices"]> =>
  Effect.try({
    try: () => JSON.parse(contents) as unknown,
    catch: () =>
      new InvalidMutationInputError({
        message: `The ${subject} is not valid JSON.`,
      }),
  }).pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(schema, {
        errors: "all",
        onExcessProperty: "error",
      })
    ),
    Effect.mapError((error) =>
      error instanceof InvalidMutationInputError
        ? error
        : new InvalidMutationInputError({
            message: `The ${subject} is invalid:\n${error.message}`,
          })
    )
  );

/** Reads a JSON file and decodes it as {@link decodeJsonInput} does. */
export const readJsonInputFile = <S extends Schema.Top>(
  schema: S,
  subject: string,
  path: string
) =>
  FileSystem.FileSystem.pipe(
    Effect.flatMap((fileSystem) => fileSystem.readFileString(path)),
    Effect.mapError(
      () =>
        new InvalidMutationInputError({
          message: `The ${subject} file ${path} could not be read.`,
        })
    ),
    Effect.flatMap((contents) => decodeJsonInput(schema, subject, contents))
  );

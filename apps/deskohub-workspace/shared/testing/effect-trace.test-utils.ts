import {
  Effect,
  type Exit,
  Logger,
  Predicate,
  References,
  Tracer,
} from "effect";

/**
 * One run's observable sequence: span starts, log entries and recorded mock
 * calls, in the order they happened. Pinning tests compare it whole, so a
 * refactor that reorders a provider call, renames a span, drops a log field
 * or moves a scoped annotation fails the test.
 */
export interface EffectTrace {
  readonly entries: string[];
  /**
   * Wraps each method so a call records `call <service>.<method>(<args>)`
   * when the returned Effect runs, then delegates to the method.
   */
  readonly recordCalls: <Methods extends object>(
    service: string,
    methods: Methods
  ) => Methods;
}

/** Anything an Effect log entry or a mocked call can carry. */
type TraceValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | object;

/** Primitives render as themselves; anything else as its constructor name. */
const describeValue = (value: TraceValue): string =>
  Predicate.isObjectKeyword(value) || Predicate.isFunction(value)
    ? `<${value.constructor?.name ?? "Object"}>`
    : String(value);

/** A record renders as `key=value` pairs; any other value by itself. */
const describeFields = (fields: TraceValue): string =>
  Predicate.isObjectKeyword(fields) && !Array.isArray(fields)
    ? Object.entries(fields)
        .map(([key, value]) => `${key}=${describeValue(value)}`)
        .join(", ")
    : describeValue(fields);

const describeLogMessage = (message: ReadonlyArray<TraceValue>): string => {
  const [text, ...fields] = message;
  return [String(text), ...fields.map((field) => `(${describeFields(field)})`)]
    .filter((part) => part !== "")
    .join(" ");
};

const describeSpan = (span: Tracer.AnySpan | undefined) =>
  span?._tag === "Span" ? span.name : "-";

/** Starts an empty trace whose `recordCalls` wrappers append to it. */
export const startEffectTrace = (): EffectTrace => {
  const entries: string[] = [];
  return {
    entries,
    recordCalls: (service, methods) =>
      Object.fromEntries(
        Object.entries(
          methods as Record<
            string,
            (...args: ReadonlyArray<TraceValue>) => Effect.Effect<TraceValue>
          >
        ).map(([name, method]) => [
          name,
          (...args: ReadonlyArray<TraceValue>) =>
            Effect.suspend(() => {
              entries.push(
                `call ${service}.${name}(${args.map(describeFields).join("; ")})`
              );
              return method(...args);
            }),
        ])
      ) as never,
  };
};

/**
 * Runs an effect with every log level enabled, recording into `trace` each
 * span start (`span <name>`) and each log entry as
 * `<level> <message> (<fields>) {<annotation keys>} in <current span>`.
 * Field and annotation values that aren't primitives render as their
 * constructor name, so times and errors don't make the trace unstable.
 */
export const recordEffectTrace = <A, E, R>(
  trace: EffectTrace,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<Exit.Exit<A, E>, never, R> => {
  const nativeTracer = Tracer.Tracer.defaultValue();
  const tracer = Tracer.make({
    span: (options) => {
      trace.entries.push(`span ${options.name}`);
      return nativeTracer.span(options);
    },
  });
  const logger = Logger.make(({ logLevel, message, fiber }) => {
    const annotations = Object.keys(
      fiber.getRef(References.CurrentLogAnnotations)
    )
      .sort()
      .join(",");
    // Effect hands a logger every argument of the log call as one array.
    const parts = (
      Array.isArray(message) ? message : [message]
    ) as ReadonlyArray<TraceValue>;
    trace.entries.push(
      `${logLevel} ${describeLogMessage(parts)} {${annotations}} in ${describeSpan(fiber.currentSpan)}`
    );
  });

  return effect.pipe(
    Effect.exit,
    Effect.withTracer(tracer),
    Effect.provideService(References.MinimumLogLevel, "All"),
    Effect.provide(Logger.layer([logger]))
  );
};

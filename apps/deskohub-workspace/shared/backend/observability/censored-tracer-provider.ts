import {
  type Attributes,
  type Context,
  type Link,
  type Span,
  type SpanAttributeValue,
  type SpanOptions,
  SpanStatusCode,
  type TimeInput,
  type Tracer,
  type TracerOptions,
  type TracerProvider,
} from "@opentelemetry/api";
import {
  CENSORED_LOG_VALUE,
  censorLogValue,
  isSensitiveLogKey,
} from "../logging/censorship";

const censoredExceptionAttributes = {
  "exception.type": "Error",
} as const;

const censorSpanAttribute = (
  key: string,
  value: SpanAttributeValue
): SpanAttributeValue =>
  isSensitiveLogKey(key)
    ? CENSORED_LOG_VALUE
    : (censorLogValue(value) as SpanAttributeValue);

const censorSpanAttributes = (attributes: Attributes): Attributes =>
  Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      value === undefined ? value : censorSpanAttribute(key, value),
    ])
  );

const censorSpanLink = (link: Link): Link => ({
  ...link,
  ...(link.attributes
    ? { attributes: censorSpanAttributes(link.attributes) }
    : {}),
});

const censorSpanOptions = (options: SpanOptions | undefined) =>
  options
    ? {
        ...options,
        ...(options.attributes
          ? { attributes: censorSpanAttributes(options.attributes) }
          : {}),
        ...(options.links ? { links: options.links.map(censorSpanLink) } : {}),
      }
    : undefined;

const createCensoredSpan = (span: Span): Span => {
  let censoredSpan: Span;

  censoredSpan = new Proxy(span, {
    get(target, property, receiver) {
      switch (property) {
        case "setAttribute":
          return (key: string, value: SpanAttributeValue) => {
            target.setAttribute(key, censorSpanAttribute(key, value));
            return censoredSpan;
          };
        case "setAttributes":
          return (attributes: Attributes) => {
            target.setAttributes(censorSpanAttributes(attributes));
            return censoredSpan;
          };
        case "addEvent":
          return (
            name: string,
            attributesOrStartTime?: Attributes | TimeInput,
            startTime?: TimeInput
          ) => {
            if (
              attributesOrStartTime !== undefined &&
              typeof attributesOrStartTime === "object" &&
              !(attributesOrStartTime instanceof Date) &&
              !Array.isArray(attributesOrStartTime)
            ) {
              target.addEvent(
                name,
                censorSpanAttributes(attributesOrStartTime),
                startTime
              );
            } else {
              target.addEvent(name, attributesOrStartTime);
            }
            return censoredSpan;
          };
        case "addLink":
          return (link: Link) => {
            target.addLink(censorSpanLink(link));
            return censoredSpan;
          };
        case "addLinks":
          return (links: Link[]) => {
            target.addLinks(links.map(censorSpanLink));
            return censoredSpan;
          };
        case "setStatus":
          return (status: Parameters<Span["setStatus"]>[0]) => {
            target.setStatus(
              status.code === SpanStatusCode.ERROR
                ? { code: SpanStatusCode.ERROR }
                : status
            );
            return censoredSpan;
          };
        case "recordException":
          return (_exception: unknown, time?: TimeInput) => {
            target.addEvent("exception", censoredExceptionAttributes, time);
          };
        case "updateName":
          return (name: string) => {
            target.updateName(name);
            return censoredSpan;
          };
        default: {
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }
    },
  });

  return censoredSpan;
};

const createCensoredTracer = (tracer: Tracer): Tracer => {
  const startActiveSpan = (
    name: string,
    ...args: readonly unknown[]
  ): unknown => {
    const callback = args.at(-1);
    if (typeof callback !== "function") {
      throw new TypeError("OpenTelemetry startActiveSpan requires a callback");
    }

    const wrappedCallback = (span: Span) => callback(createCensoredSpan(span));
    if (args.length === 1) {
      return tracer.startActiveSpan(name, wrappedCallback);
    }
    if (args.length === 2) {
      return tracer.startActiveSpan(
        name,
        censorSpanOptions(args[0] as SpanOptions) as SpanOptions,
        wrappedCallback
      );
    }

    return tracer.startActiveSpan(
      name,
      censorSpanOptions(args[0] as SpanOptions) as SpanOptions,
      args[1] as Context,
      wrappedCallback
    );
  };

  return new Proxy(tracer, {
    get(target, property, receiver) {
      if (property === "startSpan") {
        return (name: string, options?: SpanOptions, context?: Context): Span =>
          createCensoredSpan(
            target.startSpan(name, censorSpanOptions(options), context)
          );
      }
      if (property === "startActiveSpan") return startActiveSpan;

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
};

export const createCensoredTracerProvider = (
  provider: TracerProvider
): TracerProvider => ({
  getTracer(name: string, version?: string, options?: TracerOptions): Tracer {
    return createCensoredTracer(provider.getTracer(name, version, options));
  },
});

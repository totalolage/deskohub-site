import * as OtelResource from "@effect/opentelemetry/Resource";
import * as OtelTracer from "@effect/opentelemetry/Tracer";
import { type TracerProvider, trace } from "@opentelemetry/api";
import * as Layer from "effect/Layer";

type TracingLiveOptions = {
  readonly attributes?: Record<string, boolean | number | string>;
  readonly provider?: TracerProvider;
  readonly serviceName: string;
  readonly serviceVersion?: string;
  readonly transformProvider?: (provider: TracerProvider) => TracerProvider;
};

export const createTracingLive = ({
  attributes,
  provider,
  serviceName,
  serviceVersion,
  transformProvider,
}: TracingLiveOptions) => {
  const providerLive = provider
    ? Layer.succeed(
        OtelTracer.OtelTracerProvider,
        transformProvider ? transformProvider(provider) : provider
      )
    : transformProvider
      ? Layer.sync(OtelTracer.OtelTracerProvider, () =>
          transformProvider(trace.getTracerProvider())
        )
      : OtelTracer.layerGlobalProvider;
  const resourceLive = OtelResource.layer({
    attributes,
    serviceName,
    ...(serviceVersion ? { serviceVersion } : {}),
  });

  return OtelTracer.layer.pipe(
    Layer.provide(Layer.merge(providerLive, resourceLive))
  );
};

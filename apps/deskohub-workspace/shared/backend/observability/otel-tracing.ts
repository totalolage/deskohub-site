import * as OtelResource from "@effect/opentelemetry/Resource";
import * as OtelTracer from "@effect/opentelemetry/Tracer";
import type { TracerProvider } from "@opentelemetry/api";
import * as Layer from "effect/Layer";

type TracingLiveOptions = {
  readonly attributes?: Record<string, boolean | number | string>;
  readonly provider?: TracerProvider;
  readonly serviceName: string;
  readonly serviceVersion?: string;
};

export const createTracingLive = ({
  attributes,
  provider,
  serviceName,
  serviceVersion,
}: TracingLiveOptions) => {
  const providerLive = provider
    ? Layer.succeed(OtelTracer.OtelTracerProvider, provider)
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

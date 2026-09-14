interface AuthCallbackReactServerManifestModule {
  readonly async?: boolean;
  readonly chunks: readonly string[];
  readonly id: string;
  readonly name?: string;
}

interface AuthCallbackReactServerManifest {
  readonly [moduleId: string]: AuthCallbackReactServerManifestModule;
}

declare module "next/dist/compiled/react-server-dom-webpack/server.edge" {
  export function registerClientReference(
    proxyImplementation: (...args: never[]) => unknown,
    id: string,
    exportName: string
  ): unknown;

  export function renderToReadableStream(
    model: React.ReactNode,
    webpackMap: AuthCallbackReactServerManifest
  ): ReadableStream<Uint8Array>;
}

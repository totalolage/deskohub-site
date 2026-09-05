interface ReactServerManifestModule {
  readonly async?: boolean;
  readonly chunks: readonly string[];
  readonly id: string;
  readonly name?: string;
}

interface ReactServerManifest {
  readonly [moduleId: string]: ReactServerManifestModule;
}

declare module "next/dist/compiled/react-server-dom-webpack/server.edge" {
  export function renderToReadableStream(
    model: React.ReactNode,
    webpackMap: ReactServerManifest
  ): ReadableStream<Uint8Array>;
}

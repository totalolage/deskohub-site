/// <reference path="./react-server-render.d.ts" />

import { renderToReadableStream } from "next/dist/compiled/react-server-dom-turbopack/server.node";
import { createElement, Fragment } from "react";

/**
 * Renders one server request whose page is a sibling async server component
 * per loader, with the Flight renderer Next uses for App Router pages on
 * Node, so React `cache` and other request-scoped APIs behave as deployed.
 * Resolves with each loader's settled result once the whole response has
 * streamed.
 *
 * Only a `--conditions=react-server` process can load it; run the fixture
 * that imports it with `runReactServerFixture`.
 */
export const renderServerComponents = async <A>(
  loaders: readonly (() => Promise<A>)[]
): Promise<PromiseSettledResult<A>[]> => {
  const components = loaders.map((load) => {
    const loaded = Promise.withResolvers<A>();
    const Loader = async () => {
      loaded.resolve(load());
      await Promise.allSettled([loaded.promise]);
      return null;
    };
    return { Loader, loaded: loaded.promise };
  });
  const response = renderToReadableStream(
    createElement(
      Fragment,
      null,
      components.map(({ Loader }, index) =>
        createElement(Loader, { key: index })
      )
    ),
    {}
  );
  await new Response(response).text();
  return Promise.allSettled(components.map(({ loaded }) => loaded));
};

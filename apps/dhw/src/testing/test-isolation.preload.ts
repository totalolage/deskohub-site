/**
 * Preloaded into the dhw test process and into every dhw subprocess a test
 * starts. The operating-system credential store holds real Workspace
 * credentials, so tests replace it before anything can read it, and requests
 * to anything but a local test server go to a proxy that isn't there.
 */
const refuseSecretAccess = () =>
  Promise.reject(
    new Error("dhw tests cannot use the operating-system credential store.")
  );

Object.defineProperty(Bun, "secrets", {
  value: {
    get: refuseSecretAccess,
    set: refuseSecretAccess,
    delete: refuseSecretAccess,
  },
});

Object.assign(
  process.env,
  testNetworkEnvironment(
    localProxy(process.env.DHW_TEST_EGRESS_PROXY) ?? "http://127.0.0.1:9"
  )
);

/** A subprocess keeps the egress trap its test started, if it is local. */
function localProxy(proxy: string | undefined) {
  return proxy !== undefined &&
    URL.canParse(proxy) &&
    new URL(proxy).origin === `http://127.0.0.1:${new URL(proxy).port}`
    ? proxy
    : undefined;
}

/**
 * Bun reads both spellings and prefers a non-empty lowercase `no_proxy`, so
 * every spelling is set.
 */
export function testNetworkEnvironment(proxy: string) {
  return {
    DHW_TEST_EGRESS_PROXY: proxy,
    HTTP_PROXY: proxy,
    http_proxy: proxy,
    HTTPS_PROXY: proxy,
    https_proxy: proxy,
    ALL_PROXY: proxy,
    all_proxy: proxy,
    NO_PROXY: "localhost,127.0.0.1",
    no_proxy: "localhost,127.0.0.1",
  };
}

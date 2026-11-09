/**
 * Child-process preload for production-release CLI tests. It answers the
 * Vercel project alias listing with every alias in `PRODUCTION_ALIASES`
 * already serving the `--url` deployment, so rollback verification settles on
 * its first poll without reaching the network. Any other request fails.
 */
const vercelAliasesUrl = "https://api.vercel.com/v4/aliases";

const urlIndex = process.argv.indexOf("--url");
const restoredUrl = urlIndex === -1 ? undefined : process.argv[urlIndex + 1];
const aliases = process.env.PRODUCTION_ALIASES?.split(",") ?? [];
if (!restoredUrl || aliases.length === 0) {
  throw new Error(
    "The Vercel API fixture needs a --url argument and PRODUCTION_ALIASES"
  );
}
const restoredHost = new URL(restoredUrl).host;

const fixtureFetch = async (input: RequestInfo | URL): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (
    `${url.origin}${url.pathname}` !== vercelAliasesUrl ||
    url.searchParams.get("projectId") !== process.env.VERCEL_PROJECT_ID
  ) {
    throw new Error(`Unexpected request in the Vercel API fixture: ${url}`);
  }
  return Response.json({
    aliases: aliases.map((alias) => ({
      alias,
      deployment: { url: restoredHost },
    })),
    pagination: { next: null },
  });
};

globalThis.fetch = Object.assign(fixtureFetch, {
  preconnect: globalThis.fetch.preconnect,
});

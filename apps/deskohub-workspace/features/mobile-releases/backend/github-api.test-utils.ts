const repositoryPath = "/repos/totalolage/deskohub-site";

/** A request the fake GitHub API received. */
interface GitHubApiRequest {
  readonly path: string;
  readonly headers: Headers;
}

/**
 * A `fetch` that serves the deskohub-site repository's GitHub REST API from
 * `routes`, keyed by the path below the repository, and records each
 * request. Any other path answers 404, as GitHub does for a missing release.
 */
export const fakeGitHubApi = (
  routes: Record<string, () => Response | Promise<Response>>
) => {
  const requests: GitHubApiRequest[] = [];
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      const url = new URL(request.url);
      requests.push({ path: url.pathname, headers: request.headers });
      const route =
        url.origin === "https://api.github.com" &&
        url.pathname.startsWith(`${repositoryPath}/`)
          ? routes[url.pathname.slice(repositoryPath.length)]
          : undefined;
      return route
        ? await route()
        : Response.json({ message: "Not Found" }, { status: 404 });
    },
    { preconnect: globalThis.fetch.preconnect }
  );

  return { fetch, requests };
};

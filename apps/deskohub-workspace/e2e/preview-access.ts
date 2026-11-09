import type { BrowserContext } from "@playwright/test";
import { isWorkspaceDeploymentOrigin } from "./config";
import { workspaceE2EError, workspaceE2ETimeoutError } from "./errors";
import { workspaceE2ETimeouts } from "./timeouts";

type PreviewAccessCookie = Parameters<BrowserContext["addCookies"]>[0][number];

/**
 * Lets a browser context through Vercel protection on a Workspace preview
 * deployment. Only an immutable Workspace deployment origin receives the
 * automation bypass secret; any other target, such as a local dev server, is
 * left as is.
 *
 * The secret is exchanged for Vercel's bypass cookie with a request outside
 * Playwright: Playwright records request headers in its traces and echoes
 * them in its error messages. Failures are `WorkspaceE2EError`s that report
 * only the HTTP status, never the request or its cause; a request that runs
 * out of `timeoutMs` is a timeout. Aborting `signal` stops the request.
 */
export const primePreviewAccess = async (
  context: Pick<BrowserContext, "addCookies">,
  baseUrl: string | undefined,
  bypassSecret: string | undefined,
  options: {
    readonly fetch?: typeof fetch;
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  } = {}
): Promise<void> => {
  if (!(bypassSecret && baseUrl)) return;
  const { origin } = new URL(baseUrl);
  if (!isWorkspaceDeploymentOrigin(origin)) return;

  const timeout = AbortSignal.timeout(
    options.timeoutMs ?? workspaceE2ETimeouts.browserAction
  );
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(new URL("/favicon.svg", origin), {
      headers: {
        "x-vercel-protection-bypass": bypassSecret,
        "x-vercel-set-bypass-cookie": "true",
      },
      redirect: "manual",
      signal: options.signal
        ? AbortSignal.any([timeout, options.signal])
        : timeout,
    });
  } catch {
    throw timeout.aborted
      ? workspaceE2ETimeoutError(
          "The Vercel protection bypass request timed out",
          { operation: previewAccessOperation }
        )
      : workspaceE2EError("The Vercel protection bypass request failed", {
          operation: previewAccessOperation,
        });
  }
  await response.body?.cancel();
  // Vercel sets the cookie on a redirect back to the requested path.
  if (!(response.ok || response.status === 307)) {
    throw workspaceE2EError(
      `The Vercel protection bypass probe failed with ${response.status}`,
      { operation: previewAccessOperation }
    );
  }

  const cookies = response.headers
    .getSetCookie()
    .flatMap((header) => toPreviewAccessCookie(header, origin));
  if (cookies.length > 0) await context.addCookies(cookies);
};

/**
 * Primes preview access for a Playwright test, with the bypass secret from
 * the process environment.
 */
export const enablePreviewAccess = (
  context: Pick<BrowserContext, "addCookies">,
  baseURL: string | undefined
) =>
  primePreviewAccess(
    context,
    baseURL,
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  );

const previewAccessOperation = "prime preview access";

const toPreviewAccessCookie = (
  header: string,
  origin: string
): PreviewAccessCookie[] => {
  const [pair = "", ...attributes] = header.split(";");
  const separator = pair.indexOf("=");
  if (separator <= 0) return [];
  const cookie: PreviewAccessCookie = {
    name: pair.slice(0, separator).trim(),
    url: origin,
    value: pair.slice(separator + 1).trim(),
  };
  for (const attribute of attributes) {
    const [key = "", value = ""] = attribute
      .split("=", 2)
      .map((part) => part.trim());
    switch (key.toLowerCase()) {
      case "httponly":
        cookie.httpOnly = true;
        break;
      case "max-age":
        cookie.expires = Math.floor(Date.now() / 1000) + Number(value);
        break;
      case "samesite":
        cookie.sameSite = sameSiteValues[value.toLowerCase()];
        break;
    }
  }
  return [cookie];
};

const sameSiteValues: Record<string, PreviewAccessCookie["sameSite"]> = {
  lax: "Lax",
  none: "None",
  strict: "Strict",
};

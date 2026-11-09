import { Option } from "effect";
import { type AuthCallback, parseAuthCallbackParams } from "./auth-callback";
import {
  readNativeHandoffRequest,
  withoutCallbackCredentials,
  withoutNativeRequestParams,
} from "./native-handoff-request";
import { saveNativeHandoffRequest } from "./web-native-request-store";

let capturedCallback: AuthCallback = { kind: "invalid" };

const searchValues = (search: URLSearchParams) => {
  const values: Record<string, ReadonlyArray<string>> = {};
  for (const name of new Set(search.keys())) values[name] = search.getAll(name);
  return values;
};

/**
 * Takes sign-in secrets out of the address bar before the router, BotID or
 * any other script reads it. A callback's token, code and state are kept in
 * memory for the callback page; a native sign-in request moves to
 * `localStorage`. Runs once, from the root layout's module.
 */
export const prepareAuthLocation = (): void => {
  const { location, history } = globalThis;
  if (location === undefined || history === undefined) return;
  const search = new URLSearchParams(location.search);
  if (location.pathname.endsWith("/auth/callback")) {
    capturedCallback = parseAuthCallbackParams(searchValues(search));
    history.replaceState(
      history.state,
      "",
      withoutCallbackCredentials(location.href)
    );
    return;
  }
  if (location.pathname.endsWith("/sign-in") && search.has("native")) {
    Option.map(readNativeHandoffRequest(search, location.origin), (request) =>
      saveNativeHandoffRequest(request, Date.now())
    );
    history.replaceState(
      history.state,
      "",
      withoutNativeRequestParams(location.href)
    );
  }
};

/** The callback this page load arrived with. */
export const capturedAuthCallback = (): AuthCallback => capturedCallback;

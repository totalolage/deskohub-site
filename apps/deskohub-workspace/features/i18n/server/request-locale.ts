import { AsyncLocalStorage } from "node:async_hooks";
import {
  type Locale,
  overwriteServerAsyncLocalStorage,
} from "../paraglide/runtime.js";

type ParaglideRequestStore = {
  locale?: Locale;
  messageCalls?: Set<string>;
  origin?: string;
};

const workspaceRequestLocaleStorage =
  new AsyncLocalStorage<ParaglideRequestStore>();

overwriteServerAsyncLocalStorage(workspaceRequestLocaleStorage);

export async function runWithRequestLocale<T>(
  locale: Locale,
  resolve: () => T | Promise<T>
) {
  return await new Promise<T>((resolvePromise, rejectPromise) => {
    workspaceRequestLocaleStorage.run({ locale }, () => {
      Promise.resolve(resolve()).then(resolvePromise, rejectPromise);
    });
  });
}

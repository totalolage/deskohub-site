import { AsyncLocalStorage } from "node:async_hooks";
import { notFound } from "next/navigation";
import { locale as rootLocale } from "next/root-params";
import {
  isLocale,
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

export async function getRequestLocale() {
  const locale = await rootLocale();
  if (!isLocale(locale)) notFound();

  return locale;
}

export async function runWithRequestLocale<T>(
  resolve: (locale: Locale) => T | Promise<T>
) {
  const locale = await getRequestLocale();

  return await new Promise<T>((resolvePromise, rejectPromise) => {
    workspaceRequestLocaleStorage.run({ locale }, () => {
      Promise.resolve(resolve(locale)).then(resolvePromise, rejectPromise);
    });
  });
}

import { AsyncLocalStorage } from "async_hooks";
import {
  overwriteServerAsyncLocalStorage,
  ParaglideAsyncLocalStorage,
} from "../paraglide/runtime";

// Create and set up async local storage for Paraglide
const localeAsyncLocalStorage = new AsyncLocalStorage<
  NonNullable<ReturnType<ParaglideAsyncLocalStorage["getStore"]>>
>();

// Set the async local storage in Paraglide runtime
overwriteServerAsyncLocalStorage(localeAsyncLocalStorage);

export { localeAsyncLocalStorage };


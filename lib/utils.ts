import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type F<T> = (error: Error) => T;
export function tryOrElse<T>(
  tryFn: () => T,
  fallback: T extends (...args: unknown[]) => unknown ? F<T> : T | F<T>
): T {
  try {
    return tryFn();
  } catch (error) {
    if (typeof fallback === "function") return fallback(error);
    return fallback as T;
  }
}

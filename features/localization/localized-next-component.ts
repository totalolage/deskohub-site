import { Next } from "@mcrovero/effect-nextjs";
import type { Effect } from "effect";
import type { ReactNode } from "react";
import {
  LocaleMiddleware,
  LocaleMiddlewareLive,
} from "@/features/localization/effect-locale";

export const LocalizedNextComponent = Next.make(
  "Localized",
  LocaleMiddlewareLive
).middleware(LocaleMiddleware);

export type LocalizedNextComponent = () => Effect.Effect<
  ReactNode,
  never,
  LocaleMiddleware
>;

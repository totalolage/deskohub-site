// lib/runtime.ts
import { Next } from "@mcrovero/effect-nextjs";
import { Layer } from "effect";

const AppLive = Layer.empty; // Your stateless layers
export const BasePage = Next.make("BasePage", AppLive);

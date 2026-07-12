"use client";

import { RegistryContext } from "@effect/atom-react";
import { useContext, useEffect } from "react";
import { runCensoredFounderNameAnimation } from "./censored-founder-name-animation";

export function useCensoredFounderNameAnimation(enabled: boolean) {
  const registry = useContext(RegistryContext);

  useEffect(
    () => (enabled ? runCensoredFounderNameAnimation(registry) : undefined),
    [enabled, registry]
  );
}

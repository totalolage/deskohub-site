"use client";

import { useAtomValue } from "@effect/atom-react";
import { useReducedMotion } from "motion/react";
import {
  animatedCensoredFounderNameAtom,
  reducedMotionCensoredFounderNameAtom,
} from "./censored-founder-name-animation";

export function useCensoredFounderName(): string {
  const shouldReduceMotion = useReducedMotion();

  return useAtomValue(
    shouldReduceMotion
      ? reducedMotionCensoredFounderNameAtom
      : animatedCensoredFounderNameAtom
  );
}

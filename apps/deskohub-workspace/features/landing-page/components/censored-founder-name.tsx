"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

const censoredLabel = "********";
const scrambleCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*";
const scrambleLength = 8;
const scrambleDelayMs = 200;
const scrambleDelayJitterMs = 50;

const createScrambledCharacter = () =>
  scrambleCharacters[Math.floor(Math.random() * scrambleCharacters.length)];

const nextScrambleDelay = () =>
  scrambleDelayMs +
  Math.round(
    Math.random() * (scrambleDelayJitterMs * 2) - scrambleDelayJitterMs
  );

export function CensoredFounderName() {
  const shouldReduceMotion = useReducedMotion();
  const [scrambledLabel, setScrambledLabel] = useState(censoredLabel);

  useEffect(() => {
    if (shouldReduceMotion) {
      return;
    }

    const timeouts = new Set<number>();
    const updateCharacter = (index: number) => {
      setScrambledLabel(
        (currentLabel) =>
          `${currentLabel.slice(0, index)}${createScrambledCharacter()}${currentLabel.slice(index + 1)}`
      );
    };
    const scheduleCharacterUpdate = (index: number) => {
      const timeout = window.setTimeout(() => {
        timeouts.delete(timeout);
        updateCharacter(index);
        scheduleCharacterUpdate(index);
      }, nextScrambleDelay());

      timeouts.add(timeout);
    };

    for (let index = 0; index < scrambleLength; index += 1) {
      scheduleCharacterUpdate(index);
    }

    return () => {
      for (const timeout of timeouts) {
        window.clearTimeout(timeout);
      }
    };
  }, [shouldReduceMotion]);

  return (
    <span
      aria-hidden="true"
      className="font-mono text-lg font-medium tracking-wide text-white drop-shadow-[0_2px_4px_rgba(0,2,79,0.9)]"
    >
      {shouldReduceMotion ? censoredLabel : scrambledLabel}
    </span>
  );
}

"use client";

import { useAtom } from "@effect/atom-react";
import { Effect, Fiber, Random, Schedule } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useReducedMotion } from "motion/react";
import { useEffect } from "react";

const censoredLabel = "********";
const scrambleCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*";
const scrambledLabelAtom = Atom.make(censoredLabel);
const scramblingSchedule = Schedule.spaced(200).pipe(Schedule.jittered);

export function CensoredFounderName() {
  const shouldReduceMotion = useReducedMotion();
  const [scrambledLabel, setScrambledLabel] = useAtom(scrambledLabelAtom);

  useEffect(() => {
    if (shouldReduceMotion) {
      return;
    }

    const fiber = Effect.runFork(
      Effect.forEach(
        Array.from({ length: censoredLabel.length }, (_, index) => index),
        (index) =>
          Effect.gen(function* () {
            const initialDelay = yield* Random.nextIntBetween(160, 240);

            yield* Effect.sleep(initialDelay);
            yield* Effect.repeat(
              Effect.gen(function* () {
                const characterIndex = yield* Random.nextIntBetween(
                  0,
                  scrambleCharacters.length - 1
                );

                setScrambledLabel(
                  (label) =>
                    `${label.slice(0, index)}${scrambleCharacters[characterIndex]}${label.slice(index + 1)}`
                );
              }),
              scramblingSchedule
            );
          }),
        { concurrency: "unbounded", discard: true }
      )
    );

    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [setScrambledLabel, shouldReduceMotion]);

  return (
    <span
      aria-hidden="true"
      className="font-mono text-lg font-medium tracking-wide text-white drop-shadow-[0_2px_4px_rgba(0,2,79,0.9)]"
    >
      {shouldReduceMotion ? censoredLabel : scrambledLabel}
    </span>
  );
}

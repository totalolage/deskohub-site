import { Effect, Random, Schedule } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

export const censoredFounderNameLabel = "********";

const scrambleCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*";
const scramblingSchedule = Schedule.spaced(200).pipe(Schedule.jittered);

export const scrambledFounderNameAtom = Atom.make(censoredFounderNameLabel);

const scrambleCharacter = (index: number) =>
  Effect.gen(function* () {
    const characterIndex = yield* Random.nextIntBetween(
      0,
      scrambleCharacters.length - 1
    );

    yield* Atom.update(
      scrambledFounderNameAtom,
      (label) =>
        `${label.slice(0, index)}${scrambleCharacters[characterIndex]}${label.slice(index + 1)}`
    );
  });

const scrambleCharacterContinuously = (index: number) =>
  Effect.gen(function* () {
    const initialDelay = yield* Random.nextIntBetween(160, 240);

    yield* Effect.sleep(initialDelay);
    yield* Effect.repeat(scrambleCharacter(index), scramblingSchedule);
  });

const scrambleFounderName = Effect.forEach(
  Array.from({ length: censoredFounderNameLabel.length }, (_, index) => index),
  scrambleCharacterContinuously,
  { concurrency: "unbounded", discard: true }
);

export const runCensoredFounderNameAnimation = (
  registry: AtomRegistry.AtomRegistry
) =>
  Effect.runCallback(
    Effect.provideService(
      scrambleFounderName,
      AtomRegistry.AtomRegistry,
      registry
    )
  );

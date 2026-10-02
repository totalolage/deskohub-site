import { Effect, Random, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";

const censoredFounderNameLabel = "********";
const scrambleCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*";
const scramblingSchedule = Schedule.spaced(200).pipe(Schedule.jittered);

const scrambleCharacter = (index: number) =>
  Random.nextIntBetween(0, scrambleCharacters.length - 1).pipe(
    Effect.map(
      (characterIndex) => [index, scrambleCharacters[characterIndex]!] as const
    )
  );

const characterUpdates = (index: number) =>
  Stream.unwrap(
    Random.nextIntBetween(160, 240).pipe(
      Effect.map((initialDelay) =>
        Stream.concat(
          Stream.fromEffectDrain(Effect.sleep(initialDelay)),
          Stream.fromEffectSchedule(
            scrambleCharacter(index),
            scramblingSchedule
          )
        )
      )
    )
  );

const animatedCharacterUpdates = Array.from(
  { length: censoredFounderNameLabel.length },
  (_, index) => characterUpdates(index)
).reduce(
  (updates, characterUpdate) => Stream.merge(updates, characterUpdate),
  Stream.empty
);

const animatedCensoredFounderNameResultAtom = Atom.make(
  animatedCharacterUpdates.pipe(
    Stream.scan(
      censoredFounderNameLabel,
      (label, [index, character]) =>
        `${label.slice(0, index)}${character}${label.slice(index + 1)}`
    )
  ),
  { initialValue: censoredFounderNameLabel }
);

export const animatedCensoredFounderNameAtom = Atom.withServerValue(
  Atom.map(animatedCensoredFounderNameResultAtom, (result) =>
    AsyncResult.getOrElse(result, () => censoredFounderNameLabel)
  ),
  () => censoredFounderNameLabel
);

export const reducedMotionCensoredFounderNameAtom = Atom.make(
  censoredFounderNameLabel
);

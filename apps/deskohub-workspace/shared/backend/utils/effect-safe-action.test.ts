import { Effect, Layer, Schema } from "effect";
import { createEffectSafeAction } from "./effect-safe-action";

const schema = Schema.standardSchemaV1(
  Schema.Struct({
    name: Schema.String,
    seats: Schema.NumberFromString,
  })
);

createEffectSafeAction(
  schema,
  (input) => {
    const name: string = input.name;
    const seats: number = input.seats;

    // @ts-expect-error seats is decoded to number, not left as string input.
    const rawSeats: string = input.seats;

    return Effect.succeed({ name, rawSeats, seats });
  },
  Layer.empty
);

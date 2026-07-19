import { Data } from "effect";

export class ReservationQuoteError extends Data.Error<{
  readonly message: string;
}> {}

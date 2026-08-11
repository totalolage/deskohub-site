import type { EmailDeliveryId } from "./email.types";

type IsAssignable<From, To> = [From] extends [To] ? true : false;
type AssertFalse<Value extends false> = Value;

export type RawStringIsNotEmailDeliveryId = AssertFalse<
  IsAssignable<string, EmailDeliveryId>
>;

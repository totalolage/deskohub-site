import { Effect, Schema } from "effect";
import { AutomationPageCursorInvalid } from "./errors";

/**
 * The opaque page cursor of an automation listing: the keyset position after
 * a page's last row, as base64url JSON. Clients pass it back unchanged, so a
 * cursor that fails `position` is rejected, never reinterpreted.
 */
export const automationPageCursor = <
  Position extends Schema.Codec<unknown, unknown>,
>(
  position: Position
) => {
  const cursor = Schema.StringFromBase64Url.pipe(
    Schema.decodeTo(Schema.fromJsonString(position))
  );
  return {
    encode: Schema.encodeSync(cursor),
    decode: (value: string) =>
      Schema.decodeUnknownEffect(cursor)(value).pipe(
        Effect.mapError((cause) => new AutomationPageCursorInvalid({ cause }))
      ),
  };
};

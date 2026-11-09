import { expect, test } from "bun:test";
import { addDatabaseUrlRedactions, addRedaction, redact } from "./redaction";

test("redacts database connection identity fragments", () => {
  const connectionUrl =
    "postgresql://permit-user:permit-password@private-coordination.example.test/private-database";
  addDatabaseUrlRedactions(connectionUrl);

  const output = redact(
    `${connectionUrl} private-coordination.example.test private-database permit-user permit-password`
  );

  expect(output).not.toContain("private-coordination.example.test");
  expect(output).not.toContain("private-database");
  expect(output).not.toContain("permit-user");
  expect(output).not.toContain("permit-password");
});

test("redacts forced short values only as complete ASCII tokens", () => {
  const cvv = "741";
  const orderId = "550e8400-e29b-41d4-a741-446655440000";
  addRedaction(cvv, true);

  expect(
    redact(
      `${orderId} {"cvv":"${cvv}"} --cvv ${cvv} https://payments.example.test/verify?cvv=${cvv}&orderId=${orderId}`
    )
  ).toBe(
    `${orderId} {"cvv":"[redacted]"} --cvv [redacted] https://payments.example.test/verify?cvv=[redacted]&orderId=${orderId}`
  );
});

test("escapes punctuation in forced short values and encoded variants", () => {
  addRedaction("a.b", true);
  addRedaction("a+b", true);

  expect(redact("dot=a.b near=aXb plus=a+b encoded=a%2Bb nearPlus=ab")).toBe(
    "dot=[redacted] near=aXb plus=[redacted] encoded=[redacted] nearPlus=ab"
  );
});

import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { makeMagicLinkEmailDelivery } from "./send-magic-link-email";

const request = {
  email: "ada@example.test",
  url: "https://workspace.example/api/auth/magic-link/verify?token=secret-token",
  locale: "en-US" as const,
};

const runDelivery = (
  sender: Parameters<typeof makeMagicLinkEmailDelivery>[0],
  render: Parameters<typeof makeMagicLinkEmailDelivery>[1]
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const delivery = makeMagicLinkEmailDelivery(sender, render);
      return yield* delivery.deliver(request);
    })
  );

describe("Magic-link email delivery", () => {
  test("reports acceptance with a fixed censored code", async () => {
    const code = await runDelivery(
      () => Promise.resolve({ id: "email-1", error: null }),
      () =>
        Effect.succeed({ subject: "Sign in", html: "<p/>", text: "Sign in" })
    );

    expect(code).toBe("account.magic-link.delivery-accepted");
  });

  test("reports provider rejection with the same fixed code shape", async () => {
    const code = await runDelivery(
      () => Promise.resolve({ id: null, error: { message: "quota exceeded" } }),
      () =>
        Effect.succeed({ subject: "Sign in", html: "<p/>", text: "Sign in" })
    );

    expect(code).toBe("account.magic-link.delivery-rejected");
  });

  test("reports transport failures without throwing", async () => {
    const code = await runDelivery(
      () => Promise.reject(new Error("dns failure")),
      () =>
        Effect.succeed({ subject: "Sign in", html: "<p/>", text: "Sign in" })
    );

    expect(code).toBe("account.magic-link.delivery-failed");
  });

  test("reports renderer failures without leaking the message", async () => {
    const code = await runDelivery(
      () => Promise.resolve({ id: "email-1", error: null }),
      () => Effect.fail(new Error("render exploded with secret-token"))
    );

    expect(code).toBe("account.magic-link.delivery-failed");
  });

  test("stays unconfigured without a sender and never attempts delivery", async () => {
    let rendered = false;
    const code = await runDelivery(null, () => {
      rendered = true;
      return Effect.succeed({
        subject: "Sign in",
        html: "<p/>",
        text: "Sign in",
      });
    });

    expect(code).toBe("account.magic-link.delivery-unconfigured");
    expect(rendered).toBe(false);
  });

  test("source never places the recipient, bearer URL, or token in a log call", async () => {
    const code = await runDelivery(
      () => Promise.resolve({ id: "email-1", error: null }),
      () =>
        Effect.succeed({ subject: "Sign in", html: "<p/>", text: "Sign in" })
    );
    expect(code).toBe("account.magic-link.delivery-accepted");

    const source = await Bun.file(
      new URL("./send-magic-link-email.ts", import.meta.url).pathname
    ).text();
    expect(source).not.toMatch(
      /log(Info|Warning|Error)\([^)]*(request\.(email|url)|token)/i
    );
  });
});

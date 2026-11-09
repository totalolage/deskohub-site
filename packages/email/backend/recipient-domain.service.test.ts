import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  DnsLookupError,
  EmailRecipientDomainService,
  MailDomainDns,
  type MailDomainRecordType,
} from "./recipient-domain.service";

/** Addresses on the domain each case resolves; the domain is the subject. */
const recipientAt = (domain: string, localPart = "ada") =>
  `${localPart}@${domain}`;

type Answer = readonly string[] | { readonly code?: string } | "hang";

const checkDomain = (
  address: string,
  records: Partial<Record<MailDomainRecordType, Answer>>
) => {
  const lookups: string[] = [];
  const dns = Layer.succeed(MailDomainDns, {
    resolve: (domain, type) => {
      lookups.push(`${type} ${domain}`);
      const answer = records[type] ?? { code: "ENODATA" };
      if (answer === "hang") return Effect.never;
      return Array.isArray(answer)
        ? Effect.succeed(answer)
        : Effect.fail(new DnsLookupError(answer as { code?: string }));
    },
  });

  return EmailRecipientDomainService.use((service) =>
    service.check(address)
  ).pipe(
    Effect.provide(
      EmailRecipientDomainService.Default.pipe(Layer.provide(dns))
    ),
    Effect.map((status) => ({ status, lookups }))
  );
};

const check = (
  address: string,
  records: Partial<Record<MailDomainRecordType, Answer>>
) => Effect.runPromise(checkDomain(address, records));

describe("EmailRecipientDomainService", () => {
  test("accepts test recipients without a DNS lookup", async () => {
    const { status, lookups } = await check(testEmailAddress("ada"), {
      MX: { code: "ENOTFOUND" },
    });

    expect(status).toBe("accepts_mail");
    expect(lookups).toEqual([]);
  });

  test("accepts a domain with a mail exchange", async () => {
    const { status, lookups } = await check(
      recipientAt("mail.example.test", "ada"),
      {
        MX: ["mx.example.test"],
      }
    );

    expect(status).toBe("accepts_mail");
    expect(lookups).toEqual(["MX mail.example.test"]);
  });

  test("rejects a domain that does not exist", async () => {
    const { status, lookups } = await check(
      recipientAt("gmai.example.test", "ada"),
      {
        MX: { code: "ENOTFOUND" },
      }
    );

    expect(status).toBe("rejects_mail");
    expect(lookups).toEqual(["MX gmai.example.test"]);
  });

  test("rejects a domain that publishes only a null MX", async () => {
    expect(
      (await check(recipientAt("example.test", "ada"), { MX: [""] })).status
    ).toBe("rejects_mail");
    expect(
      (await check(recipientAt("example.test", "ada"), { MX: ["."] })).status
    ).toBe("rejects_mail");
  });

  test("falls back to the domain address when it publishes no MX", async () => {
    expect(
      (await check(recipientAt("example.test", "ada"), { A: ["192.0.2.1"] }))
        .status
    ).toBe("accepts_mail");
    expect(
      (
        await check(recipientAt("example.test", "ada"), {
          AAAA: ["2001:db8::1"],
        })
      ).status
    ).toBe("accepts_mail");
  });

  test("rejects a domain with neither MX nor address records", async () => {
    expect(
      (
        await check(recipientAt("example.test", "ada"), {
          A: { code: "ENOTFOUND" },
        })
      ).status
    ).toBe("rejects_mail");
  });

  test("fails open when the resolver cannot answer", async () => {
    expect(
      (
        await check(recipientAt("example.test", "ada"), {
          MX: { code: "ETIMEOUT" },
        })
      ).status
    ).toBe("unknown");
    expect(
      (
        await check(recipientAt("example.test", "ada"), {
          MX: { code: "ESERVFAIL" },
        })
      ).status
    ).toBe("unknown");
    expect(
      (
        await check(recipientAt("example.test", "ada"), {
          A: { code: "ECONNREFUSED" },
        })
      ).status
    ).toBe("unknown");
  });

  test("fails open when the lookup does not finish in time", async () => {
    const result = await Effect.gen(function* () {
      const fiber = yield* checkDomain(recipientAt("example.test", "ada"), {
        MX: "hang",
      }).pipe(Effect.forkChild);
      yield* TestClock.adjust("4 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);

    expect(result.status).toBe("unknown");
  });

  test("looks up the ASCII form of a normalized domain", async () => {
    const { lookups } = await check(recipientAt("Háček.Example.Test."), {
      MX: ["mx.example.test"],
    });

    expect(lookups).toEqual(["MX xn--hek-ela4t.example.test"]);
  });
});

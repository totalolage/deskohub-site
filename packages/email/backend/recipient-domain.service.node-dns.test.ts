import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Fiber } from "effect";

type ResolverOptions = { readonly timeout: number; readonly tries: number };

const resolverInstances: FakeResolver[] = [];
let answers: {
  readonly resolveMx: () => Promise<{ exchange: string; priority: number }[]>;
  readonly resolve4: () => Promise<string[]>;
  readonly resolve6: () => Promise<string[]>;
};

class FakeResolver {
  readonly lookups: string[] = [];
  cancelled = 0;

  constructor(readonly options: ResolverOptions) {
    resolverInstances.push(this);
  }

  cancel() {
    this.cancelled += 1;
  }

  resolveMx(domain: string) {
    this.lookups.push(`MX ${domain}`);
    return answers.resolveMx();
  }

  resolve4(domain: string) {
    this.lookups.push(`A ${domain}`);
    return answers.resolve4();
  }

  resolve6(domain: string) {
    this.lookups.push(`AAAA ${domain}`);
    return answers.resolve6();
  }
}

const nodeDns = await import("node:dns/promises");
mock.module("node:dns/promises", () => ({
  ...nodeDns,
  Resolver: FakeResolver,
}));

const { MailDomainDns } = await import("./recipient-domain.service");
type MailDomainRecordType =
  import("./recipient-domain.service").MailDomainRecordType;

const unexpectedLookup = () => Promise.reject(new Error("unexpected lookup"));

beforeEach(() => {
  resolverInstances.length = 0;
  answers = {
    resolveMx: unexpectedLookup,
    resolve4: unexpectedLookup,
    resolve6: unexpectedLookup,
  };
});

const resolveWithNodeDns = (domain: string, type: MailDomainRecordType) =>
  MailDomainDns.use((dns) => dns.resolve(domain, type)).pipe(
    Effect.provide(MailDomainDns.Live)
  );

describe("MailDomainDns.Live", () => {
  test("resolves MX records to their exchange host names with a fresh bounded resolver", async () => {
    answers = {
      ...answers,
      resolveMx: async () => [
        { exchange: "mx1.example.test", priority: 10 },
        { exchange: "", priority: 0 },
      ],
    };

    const records = await Effect.runPromise(
      resolveWithNodeDns("example.test", "MX")
    );

    expect(records).toEqual(["mx1.example.test", ""]);
    expect(resolverInstances).toHaveLength(1);
    expect(resolverInstances[0]?.options).toEqual({ timeout: 1500, tries: 2 });
    expect(resolverInstances[0]?.lookups).toEqual(["MX example.test"]);
  });

  test("resolves A and AAAA records through the matching address lookup", async () => {
    answers = {
      ...answers,
      resolve4: async () => ["192.0.2.1"],
      resolve6: async () => ["2001:db8::1"],
    };

    const ipv4 = await Effect.runPromise(
      resolveWithNodeDns("example.test", "A")
    );
    const ipv6 = await Effect.runPromise(
      resolveWithNodeDns("example.test", "AAAA")
    );

    expect(ipv4).toEqual(["192.0.2.1"]);
    expect(ipv6).toEqual(["2001:db8::1"]);
    expect(resolverInstances.map((resolver) => resolver.lookups)).toEqual([
      ["A example.test"],
      ["AAAA example.test"],
    ]);
  });

  test("fails with the resolver's error code, or none when the failure has no code", async () => {
    answers = {
      ...answers,
      resolveMx: () =>
        Promise.reject(
          Object.assign(new Error("queryMx"), { code: "ENOTFOUND" })
        ),
      resolve4: () => Promise.reject(new Error("socket closed")),
    };

    const nxdomain = await Effect.runPromise(
      Effect.flip(resolveWithNodeDns("missing.test", "MX"))
    );
    const uncoded = await Effect.runPromise(
      Effect.flip(resolveWithNodeDns("missing.test", "A"))
    );

    expect(nxdomain._tag).toBe("DnsLookupError");
    expect(nxdomain.code).toBe("ENOTFOUND");
    expect(uncoded._tag).toBe("DnsLookupError");
    expect(uncoded.code).toBeUndefined();
  });

  test("cancels the in-flight resolver when the lookup is interrupted", async () => {
    answers = { ...answers, resolve6: () => new Promise(() => {}) };

    await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          resolveWithNodeDns("slow.test", "AAAA")
        );
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(fiber);
      })
    );

    expect(resolverInstances).toHaveLength(1);
    expect(resolverInstances[0]?.cancelled).toBe(1);
  });
});

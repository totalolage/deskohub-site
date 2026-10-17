import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationCampaignAudience,
  AdministrationCampaignDetail,
  AdministrationCampaignRecipientPreview,
  AdministrationCampaignSendStatusResult,
  CliAccessToken,
  CliInputInvalid,
  CliSessionId,
} from "@deskohub/workspace-admin-api";
import { BunServices } from "@effect/platform-bun";
import { Console, Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { Command } from "effect/unstable/cli";
import { WorkspaceAdminApiClient } from "../api/workspace-admin-api-client.service";
import { AuthenticationService } from "../authentication/authentication.service";
import { dhwCommand } from "../command";
import { DhwConfig } from "../config/dhw-config.service";

const recipientEmail = testEmailAddress("campaign-recipient");
const testRecipientEmail = testEmailAddress("campaign-test");
const adminEmail = testEmailAddress("campaign-admin");

const accessToken = Schema.decodeUnknownSync(CliAccessToken)("a".repeat(43));
const session = {
  id: Schema.decodeUnknownSync(CliSessionId)(
    "01980000-0000-7000-8000-000000000000"
  ),
  approvedBy: null,
  approvedByEmail: null,
  clientName: "test client",
  cliVersion: "1.3.0",
  buildTarget: "development" as const,
  createdAt: "2026-08-10T10:00:00.000Z",
  lastUsedAt: "2026-08-10T10:00:00.000Z",
  expiresAt: null,
};
const timestamp = "2026-10-14T10:00:00.000Z";

const activeAudience = Schema.decodeUnknownSync(AdministrationCampaignAudience)(
  {
    id: "audience-1",
    title: "Czech customers",
    filter: {
      attribute: "locale",
      _tag: "Condition",
      operator: "anyOf",
      value: ["cs-CZ"],
    },
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
);
const archivedAudience = Schema.decodeUnknownSync(
  AdministrationCampaignAudience
)({
  id: "audience-2",
  title: "Old list",
  filter: {
    attribute: "hasAccount",
    _tag: "Condition",
    operator: "is",
    value: true,
  },
  archivedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
});
const campaign = Schema.decodeUnknownSync(AdministrationCampaignDetail)({
  id: "campaign-1",
  title: "Autumn news",
  purpose: "operational",
  templateKey: "workspace",
  status: "draft",
  audienceId: "audience-1",
  locales: ["cs-CZ", "en-US"],
  createdAt: timestamp,
  updatedAt: timestamp,
  content: {
    "cs-CZ": {
      subject: "Podzimní novinky",
      preheader: "Co je nového",
      bodyMarkdown: "# Ahoj\n\n[[button: Rezervovat](https://example.com)]\n",
      operationalReason: "Máte u nás rezervaci.",
    },
    "en-US": {
      subject: "Autumn news",
      preheader: "",
      bodyMarkdown: "# Hello\n",
    },
  },
});
const recipientPreview = Schema.decodeUnknownSync(
  AdministrationCampaignRecipientPreview
)({
  recipients: [{ customerId: "101", locale: "cs-CZ", email: recipientEmail }],
  exclusions: [{ customerId: "102", reason: "missing-email" }],
  duplicates: [
    {
      email: recipientEmail,
      recipientCustomerId: "101",
      duplicateCustomerIds: ["103"],
    },
  ],
});
const sendStatus = Schema.decodeUnknownSync(
  AdministrationCampaignSendStatusResult
)({
  send: {
    sendId: "send-1",
    createdAt: timestamp,
    completedAt: null,
    audienceId: "audience-1",
    audienceFilter: {
      attribute: "locale",
      _tag: "Condition",
      operator: "anyOf",
      value: ["cs-CZ"],
    },
    counts: {
      pending: 1,
      sent: 0,
      delivered: 2,
      bounced: 0,
      complained: 0,
      failed: 1,
      unconfirmed: 3,
      skipped: 1,
    },
    recipients: [
      {
        customerId: "101",
        locale: "cs-CZ",
        status: "delivered",
        skipReason: null,
        statusUpdatedAt: timestamp,
      },
      {
        customerId: "102",
        locale: "en-US",
        status: "unconfirmed",
        skipReason: null,
        statusUpdatedAt: timestamp,
      },
      {
        customerId: "103",
        locale: "cs-CZ",
        status: "skipped",
        skipReason: "consent-withdrawn",
        statusUpdatedAt: timestamp,
      },
    ],
  },
});

/** Each creation sends a fresh request ID the client retries under. */
const anyRequestId = expect.stringMatching(
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/
);

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

const makeTemporaryDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "dhw-campaigns-"));
  temporaryDirectories.push(directory);
  return directory;
};

type CampaignApi = Pick<
  WorkspaceAdminApiClient["Service"],
  | "listCampaignAudiences"
  | "getCampaignAudience"
  | "createCampaignAudience"
  | "updateCampaignAudience"
  | "archiveCampaignAudience"
  | "unarchiveCampaignAudience"
  | "deleteCampaignAudience"
  | "listCampaignTemplates"
  | "previewCampaignTemplate"
  | "listCampaigns"
  | "getCampaign"
  | "createCampaign"
  | "updateCampaign"
  | "duplicateCampaign"
  | "deleteCampaign"
  | "previewCampaignRecipients"
  | "testSendCampaign"
  | "sendCampaign"
  | "retryCampaign"
  | "getCampaignSendStatus"
>;

const makeCampaignLayer = (overrides: Partial<CampaignApi> = {}) => {
  const calls: Array<readonly [string, ...ReadonlyArray<unknown>]> = [];
  const output: string[] = [];
  const record =
    <Args extends ReadonlyArray<unknown>, A>(
      name: string,
      result: (...args: Args) => A
    ) =>
    (_accessToken: unknown, ...args: Args) =>
      Effect.sync(() => {
        calls.push([name, ...args]);
        return result(...args);
      });
  const fake: CampaignApi = {
    listCampaignAudiences: record("listCampaignAudiences", () => [
      activeAudience,
      archivedAudience,
    ]),
    getCampaignAudience: record("getCampaignAudience", () => activeAudience),
    createCampaignAudience: record(
      "createCampaignAudience",
      (_requestId, input) => ({ ...activeAudience, ...input })
    ),
    updateCampaignAudience: record(
      "updateCampaignAudience",
      (_audienceId, input) => ({ ...activeAudience, ...input })
    ),
    archiveCampaignAudience: record("archiveCampaignAudience", () => ({
      ...activeAudience,
      archivedAt: timestamp,
    })),
    unarchiveCampaignAudience: record(
      "unarchiveCampaignAudience",
      () => archivedAudience
    ),
    deleteCampaignAudience: record("deleteCampaignAudience", (audienceId) => ({
      id: audienceId,
    })),
    listCampaignTemplates: record("listCampaignTemplates", () => [
      {
        key: "workspace" as const,
        name: "Workspace",
        description: "Deskohub Workspace layout",
      },
    ]),
    previewCampaignTemplate: record("previewCampaignTemplate", () => ({
      subject: "Autumn news",
      html: "<p>Hello</p>",
      text: "Hello",
    })),
    listCampaigns: record("listCampaigns", () => [campaign]),
    getCampaign: record("getCampaign", () => campaign),
    createCampaign: record("createCampaign", () => campaign),
    updateCampaign: record("updateCampaign", () => campaign),
    duplicateCampaign: record("duplicateCampaign", () => campaign),
    deleteCampaign: record("deleteCampaign", (campaignId) => ({
      id: campaignId,
    })),
    previewCampaignRecipients: record(
      "previewCampaignRecipients",
      () => recipientPreview
    ),
    testSendCampaign: record("testSendCampaign", (_campaignId, input) => ({
      recipients: [adminEmail, ...input.recipients],
      locales: ["cs-CZ" as const, "en-US" as const],
      codeExpiresAt: timestamp,
    })),
    sendCampaign: record("sendCampaign", () => ({
      sendId: sendStatus.send!.sendId,
      recipientCount: 3,
    })),
    retryCampaign: record("retryCampaign", () => ({
      sendId: sendStatus.send!.sendId,
      retriedCount: 1,
    })),
    getCampaignSendStatus: record("getCampaignSendStatus", () => sendStatus),
    ...overrides,
  };
  const api = Layer.succeed(WorkspaceAdminApiClient, {
    ...({} as WorkspaceAdminApiClient["Service"]),
    ...fake,
  });
  const authentication = Layer.succeed(AuthenticationService, {
    current: Effect.succeed(
      Option.some({ accessToken: Redacted.make(accessToken), session })
    ),
    save: () => Effect.void,
    clear: Effect.succeed(true),
  });
  const config = Layer.succeed(DhwConfig, {
    baseUrl: new URL("https://workspace.example.test"),
    requestHeaders: {},
    isCi: true,
    stateDirectory: "/tmp/dhw-campaigns-command-test",
    updateChecksDisabled: true,
  });
  const console = Layer.succeed(Console.Console, {
    ...globalThis.console,
    log: (...args: ReadonlyArray<unknown>) => {
      output.push(args.join(" "));
    },
  } satisfies Console.Console);

  return {
    calls,
    output,
    layer: Layer.mergeAll(api, authentication, console).pipe(
      Layer.provideMerge(config),
      Layer.provideMerge(BunServices.layer)
    ),
  };
};

type CampaignLayer = ReturnType<typeof makeCampaignLayer>["layer"];

const run = (args: ReadonlyArray<string>, layer: CampaignLayer) =>
  Command.runWith(dhwCommand, { version: "1.3.0" })(args).pipe(
    Effect.provide(layer)
  );

const runFailure = (args: ReadonlyArray<string>, layer: CampaignLayer) =>
  run(args, layer).pipe(Effect.flip, Effect.runPromise);

describe("dhw campaigns create and update", () => {
  test("builds per-locale content from Markdown files and trims text", async () => {
    const directory = await makeTemporaryDirectory();
    const csPath = join(directory, "cs.md");
    const enPath = join(directory, "en.md");
    await writeFile(csPath, "# Ahoj\n");
    await writeFile(enPath, "# Hello\n");
    const { calls, layer, output } = makeCampaignLayer();

    await run(
      [
        "--json",
        "campaigns",
        "create",
        "--title",
        "  Autumn news  ",
        "--purpose",
        "operational",
        "--audience",
        "audience-1",
        "--subject",
        "cs=Podzimní novinky",
        "--subject",
        "en-US=Autumn news",
        "--preheader",
        "cs=Co je nového",
        "--body",
        `cs=${csPath}`,
        "--body",
        `en=${enPath}`,
        "--operational-reason",
        "en= You booked with us. ",
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(calls).toEqual([
      [
        "createCampaign",
        anyRequestId,
        {
          title: "Autumn news",
          purpose: "operational",
          templateKey: "workspace",
          audienceId: "audience-1",
          content: {
            "cs-CZ": {
              subject: "Podzimní novinky",
              preheader: "Co je nového",
              bodyMarkdown: "# Ahoj\n",
            },
            "en-US": {
              subject: "Autumn news",
              preheader: "",
              bodyMarkdown: "# Hello\n",
              operationalReason: "You booked with us.",
            },
          },
        },
      ],
    ]);
    expect(JSON.parse(output.at(-1)!)).toMatchObject({ id: "campaign-1" });
  });

  test.each([
    [["--subject", "de=Hallo", "--body", "de=./de.md"], "unknown locale"],
    [
      ["--subject", "Hello", "--body", "en=./en.md"],
      "expects <locale>=<value>",
    ],
    [
      [
        "--subject",
        "cs=Ahoj",
        "--subject",
        "cs-CZ=Ahoj",
        "--body",
        "cs=./cs.md",
      ],
      "--subject sets cs-CZ more than once",
    ],
    [
      ["--subject", "cs=Ahoj", "--subject", "en=Hello", "--body", "cs=./cs.md"],
      "en-US needs both --subject and --body",
    ],
    [
      ["--subject", "cs=Ahoj", "--body", "cs=./missing-body.md"],
      "body file ./missing-body.md could not be read",
    ],
    [
      ["--title", "   ", "--subject", "cs=Ahoj", "--body", "cs=./cs.md"],
      "--title must not be blank",
    ],
  ])(
    "rejects invalid content flags %p before making a request",
    async (flags, message) => {
      const { calls, layer } = makeCampaignLayer();

      const error = await runFailure(
        [
          "--json",
          "campaigns",
          "create",
          "--purpose",
          "marketing",
          ...(flags.includes("--title") ? [] : ["--title", "News"]),
          ...flags,
        ],
        layer
      );

      expect(error).toMatchObject({
        _tag: "InvalidMutationInputError",
        message: expect.stringContaining(message),
      });
      expect(calls).toHaveLength(0);
    }
  );

  test("builds a patch that removes and clears locales", async () => {
    const directory = await makeTemporaryDirectory();
    const enPath = join(directory, "en.md");
    await writeFile(enPath, "# New body\n");
    const { calls, layer } = makeCampaignLayer();

    await run(
      [
        "--json",
        "campaigns",
        "update",
        "campaign-1",
        "--title",
        "Renamed",
        "--clear-audience",
        "--subject",
        "en=New subject",
        "--body",
        `en=${enPath}`,
        "--clear-operational-reason",
        "en",
        "--remove-locale",
        "cs",
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(calls).toEqual([
      [
        "updateCampaign",
        "campaign-1",
        {
          title: "Renamed",
          audienceId: null,
          content: {
            "en-US": {
              subject: "New subject",
              bodyMarkdown: "# New body\n",
              operationalReason: null,
            },
            "cs-CZ": null,
          },
        },
      ],
    ]);
  });

  test.each([
    [[], "Nothing to update"],
    [
      ["--remove-locale", "cs", "--subject", "cs=Ahoj"],
      "can't be removed and changed",
    ],
    [
      ["--remove-locale", "cs", "--remove-locale", "cs-CZ"],
      "--remove-locale names cs-CZ more than once",
    ],
    [
      ["--operational-reason", "en=Why", "--clear-operational-reason", "en"],
      "can't both set and clear",
    ],
    [["--audience", "audience-1", "--clear-audience"], "not both"],
  ])("rejects update flags %p", async (flags, message) => {
    const { calls, layer } = makeCampaignLayer();

    const error = await runFailure(
      ["--json", "campaigns", "update", "campaign-1", ...flags],
      layer
    );

    expect(error).toMatchObject({
      _tag: "InvalidMutationInputError",
      message: expect.stringContaining(message),
    });
    expect(calls).toHaveLength(0);
  });

  test("surfaces the server's input error message", async () => {
    const directory = await makeTemporaryDirectory();
    const csPath = join(directory, "cs.md");
    await writeFile(csPath, "[[button: ](https://example.com)]");
    const { layer } = makeCampaignLayer({
      createCampaign: () =>
        Effect.fail(
          new CliInputInvalid({ message: "Line 1: a button needs a label." })
        ),
    });

    const error = await runFailure(
      [
        "--json",
        "campaigns",
        "create",
        "--title",
        "News",
        "--purpose",
        "marketing",
        "--subject",
        "cs=Ahoj",
        "--body",
        `cs=${csPath}`,
      ],
      layer
    );

    expect(error).toBeInstanceOf(CliInputInvalid);
    expect(error).toMatchObject({ message: "Line 1: a button needs a label." });
  });
});

describe("dhw campaigns duplicate", () => {
  test("sends a fresh request ID for each duplication", async () => {
    const { calls, layer, output } = makeCampaignLayer();

    await run(["campaigns", "duplicate", "campaign-1"], layer).pipe(
      Effect.runPromise
    );
    await run(["campaigns", "duplicate", "campaign-1"], layer).pipe(
      Effect.runPromise
    );

    expect(calls).toEqual([
      ["duplicateCampaign", anyRequestId, "campaign-1"],
      ["duplicateCampaign", anyRequestId, "campaign-1"],
    ]);
    expect(calls[0]?.[1]).not.toBe(calls[1]?.[1]);
    expect(output[0]).toBe("Created draft campaign Autumn news (campaign-1).");
  });
});

describe("dhw campaigns inspection", () => {
  test("lists campaigns as rows and as JSON", async () => {
    const human = makeCampaignLayer();
    await run(["campaigns", "list"], human.layer).pipe(Effect.runPromise);
    expect(human.output).toEqual([
      "Campaigns: 1",
      [
        "campaign-1",
        "Autumn news",
        "operational",
        "draft",
        "cs-CZ,en-US",
        "audience-1",
        timestamp,
      ].join("\t"),
    ]);

    const json = makeCampaignLayer();
    await run(["--json", "campaigns", "list"], json.layer).pipe(
      Effect.runPromise
    );
    expect(JSON.parse(json.output.join(""))).toEqual([campaign]);
  });

  test("shows per-locale texts with the Markdown body", async () => {
    const { layer, output } = makeCampaignLayer();

    await run(["campaigns", "show", "campaign-1"], layer).pipe(
      Effect.runPromise
    );

    const text = output.join("\n");
    expect(text).toContain("Status\tdraft");
    expect(text).toContain("[cs-CZ]\nSubject\tPodzimní novinky");
    expect(text).toContain("Operational reason\tMáte u nás rezervaci.");
    expect(text).toContain("[[button: Rezervovat](https://example.com)]");
    expect(text).toContain(
      "[en-US]\nSubject\tAutumn news\nPreheader\t\n\n# Hello"
    );
  });

  test("exports bodies to Markdown files", async () => {
    const directory = join(await makeTemporaryDirectory(), "export");
    const { layer, output } = makeCampaignLayer();

    await run(
      ["--json", "campaigns", "show", "campaign-1", "--export-dir", directory],
      layer
    ).pipe(Effect.runPromise);

    const csPath = join(directory, "cs.md");
    const enPath = join(directory, "en.md");
    expect(await readFile(csPath, "utf8")).toBe(
      campaign.content["cs-CZ"]!.bodyMarkdown
    );
    expect(await readFile(enPath, "utf8")).toBe("# Hello\n");
    expect(JSON.parse(output.join(""))).toMatchObject({
      id: "campaign-1",
      exportedFiles: { "cs-CZ": csPath, "en-US": enPath },
    });
  });

  test("previews recipients, exclusions, and shared emails", async () => {
    const human = makeCampaignLayer();
    await run(["campaigns", "recipients", "campaign-1"], human.layer).pipe(
      Effect.runPromise
    );
    expect(human.output.join("\n")).toBe(
      [
        "Recipients: 1",
        `101\tcs-CZ\t${recipientEmail}`,
        "Exclusions: 1",
        "102\tmissing-email",
        "Shared emails: 1",
        `${recipientEmail}\tmails 101\tskips 103`,
      ].join("\n")
    );

    const json = makeCampaignLayer();
    await run(
      ["--json", "campaigns", "recipients", "campaign-1"],
      json.layer
    ).pipe(Effect.runPromise);
    expect(JSON.parse(json.output.join(""))).toEqual(recipientPreview);
  });

  test("shows send counts and recipient statuses", async () => {
    const { layer, output } = makeCampaignLayer();

    await run(["campaigns", "status", "campaign-1"], layer).pipe(
      Effect.runPromise
    );

    const text = output.join("\n");
    expect(text).toContain("Send send-1\tstarted");
    expect(text).toContain("in progress");
    expect(text).toContain("delivered\t2\n");
    expect(text).toContain("failed\t1\n");
    expect(text).toContain("unconfirmed\t3\n");
    expect(text).toContain("skipped\t1\n");
    expect(text).toContain(`101\tcs-CZ\tdelivered\t${timestamp}`);
    expect(text).toContain(`102\ten-US\tunconfirmed\t${timestamp}`);
    expect(text).toContain(
      `103\tcs-CZ\tskipped (consent-withdrawn)\t${timestamp}`
    );
  });

  test("reports an unsent campaign", async () => {
    const human = makeCampaignLayer({
      getCampaignSendStatus: () => Effect.succeed({ send: null }),
    });
    await run(["campaigns", "status", "campaign-1"], human.layer).pipe(
      Effect.runPromise
    );
    expect(human.output).toEqual([
      "Campaign campaign-1 has not been sent yet.",
    ]);

    const json = makeCampaignLayer({
      getCampaignSendStatus: () => Effect.succeed({ send: null }),
    });
    await run(["--json", "campaigns", "status", "campaign-1"], json.layer).pipe(
      Effect.runPromise
    );
    expect(json.output).toEqual(['{"send":null}']);
  });
});

describe("dhw campaigns sending", () => {
  test("test-sends to trimmed extra recipients and explains the next step", async () => {
    const { calls, layer, output } = makeCampaignLayer();

    await run(
      [
        "campaigns",
        "test-send",
        "campaign-1",
        "--to",
        ` ${testRecipientEmail} `,
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(calls).toEqual([
      ["testSendCampaign", "campaign-1", { recipients: [testRecipientEmail] }],
    ]);
    expect(output.join("\n")).toBe(
      [
        `Sent test emails in cs-CZ, en-US to ${adminEmail}, ${testRecipientEmail}.`,
        `Their confirmation code expires at ${timestamp}.`,
        "Send the campaign with: dhw campaigns send campaign-1 --code <code>",
      ].join("\n")
    );
  });

  test("prints the test-send result as JSON", async () => {
    const { layer, output } = makeCampaignLayer();

    await run(["--json", "campaigns", "test-send", "campaign-1"], layer).pipe(
      Effect.runPromise
    );

    expect(JSON.parse(output.join(""))).toEqual({
      recipients: [adminEmail],
      locales: ["cs-CZ", "en-US"],
      codeExpiresAt: timestamp,
    });
  });

  test("requires --code to send", async () => {
    const { calls, layer } = makeCampaignLayer();

    const exit = await run(
      ["--json", "campaigns", "send", "campaign-1", "--yes"],
      layer
    ).pipe(Effect.exit, Effect.runPromise);

    expect(Exit.isFailure(exit)).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("rejects a blank confirmation code", async () => {
    const { calls, layer } = makeCampaignLayer();

    const error = await runFailure(
      ["--json", "campaigns", "send", "campaign-1", "--code", "  ", "--yes"],
      layer
    );

    expect(error).toMatchObject({ message: "--code must not be blank." });
    expect(calls).toHaveLength(0);
  });

  test("requires --yes to send under --json", async () => {
    const { calls, layer } = makeCampaignLayer();

    const error = await runFailure(
      ["--json", "campaigns", "send", "campaign-1", "--code", "ABC123"],
      layer
    );

    expect(error).toMatchObject({ _tag: "ConfirmationRequiredError" });
    expect(calls.map(([name]) => name)).not.toContain("sendCampaign");
  });

  test("sends with the trimmed confirmation code", async () => {
    const { calls, layer, output } = makeCampaignLayer();

    await run(
      ["campaigns", "send", "campaign-1", "--code", " ABC123 ", "--yes"],
      layer
    ).pipe(Effect.runPromise);

    expect(calls).toEqual([
      ["sendCampaign", "campaign-1", { confirmationCode: "ABC123" }],
    ]);
    expect(output).toEqual([
      [
        "Sending campaign campaign-1 to 3 recipients (send send-1).",
        "Follow progress with: dhw campaigns status campaign-1",
      ].join("\n"),
    ]);
  });

  test("requires --yes to delete or retry under --json", async () => {
    for (const args of [
      ["campaigns", "delete", "campaign-1"],
      ["campaigns", "retry", "campaign-1"],
      ["campaigns", "audiences", "delete", "audience-1"],
    ]) {
      const { calls, layer } = makeCampaignLayer();
      const error = await runFailure(["--json", ...args], layer);
      expect(error).toMatchObject({ _tag: "ConfirmationRequiredError" });
      expect(calls).toHaveLength(0);
    }
  });

  test("retries unconfirmed recipients only when asked", async () => {
    const { calls, layer } = makeCampaignLayer();

    await run(
      ["campaigns", "retry", "campaign-1", "--include-unconfirmed", "--yes"],
      layer
    ).pipe(Effect.runPromise);

    expect(calls).toEqual([
      ["retryCampaign", "campaign-1", { includeUnconfirmed: true }],
    ]);
  });

  test("deletes and retries with --yes", async () => {
    const { calls, layer, output } = makeCampaignLayer();

    await run(["campaigns", "delete", "campaign-1", "--yes"], layer).pipe(
      Effect.runPromise
    );
    await run(["campaigns", "retry", "campaign-1", "--yes"], layer).pipe(
      Effect.runPromise
    );

    expect(calls).toEqual([
      ["deleteCampaign", "campaign-1"],
      ["retryCampaign", "campaign-1", { includeUnconfirmed: false }],
    ]);
    expect(output).toEqual([
      "Deleted campaign campaign-1.",
      "Retrying 1 recipients (send send-1).",
    ]);
  });
});

describe("dhw campaigns audiences", () => {
  test("hides archived audiences unless asked", async () => {
    const active = makeCampaignLayer();
    await run(["campaigns", "audiences", "list"], active.layer).pipe(
      Effect.runPromise
    );
    expect(active.output).toEqual([
      "Campaign audiences: 1",
      ["audience-1", "Czech customers", "Active", timestamp].join("\t"),
    ]);

    const all = makeCampaignLayer();
    await run(
      ["--json", "campaigns", "audiences", "list", "--archived"],
      all.layer
    ).pipe(Effect.runPromise);
    expect(JSON.parse(all.output.join(""))).toEqual([
      activeAudience,
      archivedAudience,
    ]);
  });

  test("shows the filter as formatted JSON", async () => {
    const { layer, output } = makeCampaignLayer();

    await run(["campaigns", "audiences", "show", "audience-1"], layer).pipe(
      Effect.runPromise
    );

    expect(output.join("\n")).toContain(
      `Filter\n${JSON.stringify(activeAudience.filter, null, 2)}`
    );
  });

  test("creates an audience from a filter file", async () => {
    const directory = await makeTemporaryDirectory();
    const filterPath = join(directory, "filter.json");
    const filter = {
      _tag: "Group",
      operator: "and",
      filters: [
        {
          attribute: "locale",
          _tag: "Condition",
          operator: "anyOf",
          value: ["cs-CZ"],
        },
        {
          attribute: "reservationCount",
          _tag: "Condition",
          params: { dateBasis: "visit", period: { _tag: "AnyTime" } },
          operator: "gt",
          value: 0,
        },
      ],
    };
    await writeFile(filterPath, JSON.stringify(filter));
    const { calls, layer, output } = makeCampaignLayer();

    await run(
      [
        "campaigns",
        "audiences",
        "create",
        "--title",
        " Czech visitors ",
        "--filter-file",
        filterPath,
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(calls).toEqual([
      [
        "createCampaignAudience",
        anyRequestId,
        { title: "Czech visitors", filter },
      ],
    ]);
    expect(output).toEqual(["Created audience Czech visitors (audience-1)."]);
  });

  test("unarchives an audience", async () => {
    const human = makeCampaignLayer();
    await run(
      ["campaigns", "audiences", "unarchive", "audience-2"],
      human.layer
    ).pipe(Effect.runPromise);
    expect(human.calls).toEqual([["unarchiveCampaignAudience", "audience-2"]]);
    expect(human.output).toEqual([
      "Unarchived audience Old list (audience-2).",
    ]);

    const json = makeCampaignLayer();
    await run(
      ["--json", "campaigns", "audiences", "unarchive", "audience-2"],
      json.layer
    ).pipe(Effect.runPromise);
    expect(JSON.parse(json.output.join(""))).toEqual(archivedAudience);
  });

  test("updates only the given audience fields", async () => {
    const { calls, layer } = makeCampaignLayer();

    await run(
      [
        "--json",
        "campaigns",
        "audiences",
        "update",
        "audience-1",
        "--filter",
        '{"attribute":"hasAccount","_tag":"Condition","operator":"is","value":false}',
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(calls).toEqual([
      [
        "updateCampaignAudience",
        "audience-1",
        {
          filter: {
            attribute: "hasAccount",
            _tag: "Condition",
            operator: "is",
            value: false,
          },
        },
      ],
    ]);
  });

  test.each([
    [["--filter", "{not json"], "not valid JSON"],
    [
      [
        "--filter",
        '{"attribute":"locale","_tag":"Condition","operator":"anyOf","value":["de-DE"]}',
      ],
      'Expected "cs-CZ" | "en-US", got "de-DE"\n  at ["value"][0]',
    ],
    [
      [
        "--filter",
        '{"attribute":"hasAccount","_tag":"Condition","operator":"is","value":true,"extra":1}',
      ],
      'at ["extra"]',
    ],
    [["--filter-file", "./missing-filter.json"], "could not be read"],
    [
      ["--filter", "{}", "--filter-file", "./filter.json"],
      "either --filter or --filter-file",
    ],
    [[], "Pass the audience filter"],
  ])("rejects audience filter input %p", async (flags, message) => {
    const { calls, layer } = makeCampaignLayer();

    const error = await runFailure(
      ["--json", "campaigns", "audiences", "create", "--title", "X", ...flags],
      layer
    );

    expect(error).toMatchObject({
      _tag: "InvalidMutationInputError",
      message: expect.stringContaining(message),
    });
    expect(calls).toHaveLength(0);
  });

  test("rejects an audience update without changes", async () => {
    const { calls, layer } = makeCampaignLayer();

    const error = await runFailure(
      ["--json", "campaigns", "audiences", "update", "audience-1"],
      layer
    );

    expect(error).toMatchObject({
      message: expect.stringContaining("Nothing to update"),
    });
    expect(calls).toHaveLength(0);
  });
});

describe("dhw campaigns templates", () => {
  test("writes a rendered campaign preview to a file", async () => {
    const directory = await makeTemporaryDirectory();
    const outputPath = join(directory, "preview.html");
    const { calls, layer, output } = makeCampaignLayer();

    await run(
      [
        "--json",
        "campaigns",
        "templates",
        "preview",
        "workspace",
        "--locale",
        "cs",
        "--campaign",
        "campaign-1",
        "--output",
        outputPath,
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(calls).toEqual([
      [
        "previewCampaignTemplate",
        "workspace",
        { _tag: "Campaign", campaignId: "campaign-1", locale: "cs-CZ" },
      ],
    ]);
    expect(await readFile(outputPath, "utf8")).toBe("<p>Hello</p>");
    expect(JSON.parse(output.join(""))).toEqual({
      subject: "Autumn news",
      output: outputPath,
    });
  });

  test("renders unsaved texts as plain text on stdout", async () => {
    const directory = await makeTemporaryDirectory();
    const bodyPath = join(directory, "en.md");
    await writeFile(bodyPath, "# Hello\n");
    const { calls, layer, output } = makeCampaignLayer();

    await run(
      [
        "campaigns",
        "templates",
        "preview",
        "workspace",
        "--locale",
        "en",
        "--purpose",
        "marketing",
        "--subject",
        "Autumn news",
        "--body",
        bodyPath,
        "--text",
      ],
      layer
    ).pipe(Effect.runPromise);

    expect(calls).toEqual([
      [
        "previewCampaignTemplate",
        "workspace",
        {
          _tag: "Content",
          purpose: "marketing",
          locale: "en-US",
          content: {
            subject: "Autumn news",
            preheader: "",
            bodyMarkdown: "# Hello\n",
          },
        },
      ],
    ]);
    expect(output).toEqual(["Hello"]);
  });

  test.each([
    [
      ["--campaign", "campaign-1", "--subject", "Hi"],
      "--campaign renders saved texts",
    ],
    [["--purpose", "marketing", "--subject", "Hi"], "Pass --campaign, or pass"],
  ])("rejects preview flags %p", async (flags, message) => {
    const { calls, layer } = makeCampaignLayer();

    const error = await runFailure(
      [
        "--json",
        "campaigns",
        "templates",
        "preview",
        "workspace",
        "--locale",
        "cs",
        ...flags,
      ],
      layer
    );

    expect(error).toMatchObject({
      message: expect.stringContaining(message),
    });
    expect(calls).toHaveLength(0);
  });

  test("lists templates", async () => {
    const { layer, output } = makeCampaignLayer();

    await run(["campaigns", "templates", "list"], layer).pipe(
      Effect.runPromise
    );

    expect(output).toEqual([
      "Campaign templates: 1",
      "workspace\tWorkspace\tDeskohub Workspace layout",
    ]);
  });
});

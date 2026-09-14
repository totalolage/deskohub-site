import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import * as ts from "typescript";

const routingPort = 3195;
const syntheticOrderId = "synthetic-routing-reservation";
const repositoryRoot = resolve(import.meta.dir, "../../..");
const artifactRoot = join(repositoryRoot, ".artifacts/routing-interception");
const screenshotDirectory = join(artifactRoot, "screenshots");
const productionStatusPagePath = resolve(
  import.meta.dir,
  "../features/checkout/components/checkout-status-page.tsx"
);

type FixtureMode = "global" | "account";

const fixtureFiles = (mode: FixtureMode): Readonly<Record<string, string>> => {
  const globalModalFiles = {
    "app/[locale]/@modal/(.)reservation/status/[orderId]/page.tsx":
      modalStatusPage,
    "app/[locale]/@modal/(.)reservation/access/[orderId]/page.tsx":
      modalAccessPage,
    "app/[locale]/@modal/[...not-found]/page.tsx": nullModalPage,
    "app/[locale]/@modal/default.tsx": nullModalPage,
    "app/[locale]/@modal/page.tsx": nullModalPage,
  };
  const accountModalFiles = {
    "app/[locale]/(full-header)/account/@modal/(..)reservation/status/[orderId]/page.tsx":
      modalStatusPage,
    "app/[locale]/(full-header)/account/@modal/(..)reservation/access/[orderId]/page.tsx":
      modalAccessPage,
    "app/[locale]/(full-header)/account/@modal/[...not-found]/page.tsx":
      nullModalPage,
    "app/[locale]/(full-header)/account/@modal/default.tsx": nullModalPage,
    "app/[locale]/(full-header)/account/@modal/page.tsx": nullModalPage,
  };

  return {
    "app/[locale]/(full-header)/account/page.tsx": accountPage,
    "app/[locale]/(full-header)/layout.tsx": fullHeaderLayout,
    "app/[locale]/(minimal-header)/checkout/pay/page.tsx": checkoutPayPage,
    "app/[locale]/(minimal-header)/layout.tsx": minimalHeaderLayout,
    "app/[locale]/(minimal-header)/reservation/access/[orderId]/page.tsx":
      canonicalAccessPage,
    "app/[locale]/(minimal-header)/reservation/status/[orderId]/page.tsx":
      canonicalStatusPage,
    "app/[locale]/layout.tsx": localeLayout(mode),
    "app/layout.tsx": rootLayout,
    instrumentation: "export function register() {}",
    "next.config.mjs": nextConfig,
    "package.json": packageJson,
    ...(mode === "global" ? globalModalFiles : accountModalFiles),
    ...(mode === "account"
      ? {
          "app/[locale]/(full-header)/account/layout.tsx": accountLayout,
        }
      : {}),
  };
};

const packageJson = JSON.stringify(
  {
    private: true,
    scripts: { dev: "next dev" },
    type: "module",
  },
  null,
  2
);

const nextConfig = "const nextConfig = {}; export default nextConfig;";

type CapturedLink = {
  readonly href: string;
  readonly prefetch: boolean | null | undefined;
};

type StatusAccessBinding = {
  readonly navigation: "client" | "document";
  readonly prefetch: CapturedLink["prefetch"];
};

const readJsxAttribute = (
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  name: string
) => {
  const openingElement = ts.isJsxElement(element)
    ? element.openingElement
    : element;
  return openingElement.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.text === name
  );
};

const readStringJsxAttribute = (
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  name: string
) => {
  const initializer = readJsxAttribute(element, name)?.initializer;
  return initializer && ts.isStringLiteral(initializer)
    ? initializer.text
    : undefined;
};

const readBooleanJsxAttribute = (
  element: ts.JsxElement | ts.JsxSelfClosingElement,
  name: string
) => {
  const attribute = readJsxAttribute(element, name);
  if (!attribute) return undefined;
  if (!attribute.initializer) return true;
  if (!ts.isJsxExpression(attribute.initializer)) {
    throw new Error(`Expected a JSX expression for ${name}`);
  }
  if (!attribute.initializer.expression) {
    throw new Error(`Expected a JSX value for ${name}`);
  }
  if (attribute.initializer.expression.kind === ts.SyntaxKind.FalseKeyword) {
    return false;
  }
  if (attribute.initializer.expression.kind === ts.SyntaxKind.TrueKeyword) {
    return true;
  }
  throw new Error(`Expected a static boolean JSX value for ${name}`);
};

const readStatusAccessBindings = (
  sourceName: string,
  source: string
): readonly StatusAccessBinding[] => {
  const sourceFile = ts.createSourceFile(
    sourceName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const bindings: StatusAccessBinding[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (readStringJsxAttribute(node, "id") === "checkout-status-access") {
        const tagName = (ts.isJsxElement(node) ? node.openingElement : node)
          .tagName;
        const tagText = ts.isIdentifier(tagName)
          ? tagName.text
          : tagName.getText(sourceFile);
        const prefetch = readBooleanJsxAttribute(node, "prefetch");

        if (tagText === "Link") {
          bindings.push({ navigation: "client", prefetch });
        } else if (tagText === "a") {
          bindings.push({ navigation: "document", prefetch });
        } else {
          throw new Error(
            `Unexpected status access element in ${sourceName}: ${tagText}`
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return bindings;
};

const rootLayout = `
import type { ReactNode } from "react";

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
`;

const localeLayout = (mode: FixtureMode) => `
import type { ReactNode } from "react";

type LocaleLayoutProps = {
  readonly children: ReactNode;
  ${mode === "global" ? "readonly modal: ReactNode;" : ""}
};

export default function LocaleLayout({
  children,
  ${mode === "global" ? "modal," : ""}
}: LocaleLayoutProps) {
  return <>{children}${mode === "global" ? "{modal}" : ""}</>;
}
`;

const fullHeaderLayout = `
import type { ReactNode } from "react";

export default function FullHeaderLayout({ children }: { readonly children: ReactNode }) {
  return <div data-chrome="full">{children}</div>;
}
`;

const minimalHeaderLayout = `
import type { ReactNode } from "react";

export default function MinimalHeaderLayout({ children }: { readonly children: ReactNode }) {
  return <div data-chrome="minimal">{children}</div>;
}
`;

const accountLayout = `
import type { ReactNode } from "react";

export default function AccountLayout({
  children,
  modal,
}: {
  readonly children: ReactNode;
  readonly modal: ReactNode;
}) {
  return <>{children}{modal}</>;
}
`;

const accountPage = `
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const statusHref = "/en-US/reservation/status/${syntheticOrderId}";
const accessHref = "/en-US/reservation/access/${syntheticOrderId}";

export default function AccountPage() {
  const [hydrated, setHydrated] = useState(false);
  const [draft, setDraft] = useState("account-draft");
  useEffect(() => setHydrated(true), []);

  return (
    <main
      data-account-background="true"
      data-hydrated={hydrated ? "true" : "false"}
      data-testid="account-page"
    >
      <h1>Account</h1>
      <label>
        Account draft
        <input
          aria-label="Account draft"
          data-testid="account-draft"
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
      </label>
      <Link href={statusHref} id="account-status-link" prefetch={false}>
        Reservation details
      </Link>
      <Link href={accessHref} id="account-access-link" prefetch={false}>
        Access instructions
      </Link>
      <Link href="/en-US/checkout/pay" prefetch={false}>Leave account</Link>
    </main>
  );
}
`;

const checkoutPayPage = `
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const statusHref = "/en-US/reservation/status/${syntheticOrderId}";

export default function CheckoutPayPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <main data-hydrated={hydrated ? "true" : "false"} data-testid="checkout-page">
      <h1>Checkout payment</h1>
      <button type="button" onClick={() => router.push(statusHref)}>
        Complete checkout
      </button>
    </main>
  );
}
`;

const canonicalStatusPage = `
type StatusPageProps = {
  readonly params: Promise<{ readonly orderId: string }>;
};

export default async function CanonicalStatusPage({ params }: StatusPageProps) {
  const { orderId } = await params;
  return (
    <main data-testid="canonical-status-page">
      <h1>Reservation status</h1>
      <p>{orderId}</p>
      <a
        href="/en-US/reservation/access/${syntheticOrderId}"
        id="checkout-status-access"
      >
        Access instructions
      </a>
      <a id="status-cta" href="/en-US/checkout/pay">Book again</a>
    </main>
  );
}
`;

const modalStatusPage = `
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

const accessHref = "/en-US/reservation/access/${syntheticOrderId}";

export default function ModalStatusPage() {
  const router = useRouter();
  return (
    <div data-testid="reservation-status-modal" role="dialog">
      <h1>Reservation status</h1>
      <p>Reservation details</p>
      <Link href={accessHref} id="checkout-status-access" prefetch={false}>
        Access instructions
      </Link>
      <button type="button" onClick={() => router.back()}>Close</button>
    </div>
  );
}
`;

const canonicalAccessPage = `
import Link from "next/link";

type AccessPageProps = {
  readonly params: Promise<{ readonly orderId: string }>;
};

export default async function CanonicalAccessPage({ params }: AccessPageProps) {
  const { orderId } = await params;
  return (
    <main data-reservation-access="" data-testid="canonical-access-page">
      <h1>Reservation access</h1>
      <p>{orderId}</p>
      <output aria-label="Masked access code" data-reservation-access-code="">
        [masked]
      </output>
      <Link
        href="/en-US/reservation/status/${syntheticOrderId}"
        id="access-status-link"
        prefetch={false}
      >
        Reservation details
      </Link>
    </main>
  );
}
`;

const modalAccessPage = `
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

const statusHref = "/en-US/reservation/status/${syntheticOrderId}";

export default function ModalAccessPage() {
  const router = useRouter();
  return (
    <div
      data-reservation-access=""
      data-testid="reservation-access-modal"
      role="dialog"
    >
      <h1>Reservation access</h1>
      <p>Access instructions</p>
      <output aria-label="Masked access code" data-reservation-access-code="">
        [masked]
      </output>
      <Link href={statusHref} id="access-status-link" prefetch={false}>
        Reservation details
      </Link>
      <button type="button" onClick={() => router.back()}>Close</button>
    </div>
  );
}
`;

test("binds fixture status access navigation to the production Link contract", async () => {
  // Mirrors checkout-status-page.test.tsx: mocked Next Links are captured with
  // their prefetch value, while native anchors bypass that capture.
  const productionBindings = readStatusAccessBindings(
    productionStatusPagePath,
    await readFile(productionStatusPagePath, "utf8")
  );
  expect(productionBindings).toHaveLength(2);
  expect(
    productionBindings.filter(({ navigation }) => navigation === "client")
  ).toEqual([{ navigation: "client", prefetch: false }]);
  expect(
    productionBindings.filter(({ navigation }) => navigation === "document")
  ).toEqual([{ navigation: "document", prefetch: undefined }]);

  expect(
    readStatusAccessBindings(
      "canonical-status-fixture.tsx",
      canonicalStatusPage
    )
  ).toEqual([{ navigation: "document", prefetch: undefined }]);
  expect(
    readStatusAccessBindings("modal-status-fixture.tsx", modalStatusPage)
  ).toEqual([{ navigation: "client", prefetch: false }]);
});

const nullModalPage =
  "export default function ModalFallback() { return null; }";

const writeFixture = async (root: string, mode: FixtureMode) => {
  for (const [relativePath, contents] of Object.entries(fixtureFiles(mode))) {
    const filePath = join(root, relativePath);
    await mkdir(resolve(filePath, ".."), { recursive: true });
    await writeFile(filePath, contents);
  }
};

const waitForServer = async (url: string, exited: { value: boolean }) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (exited.value) throw new Error("routing fixture server exited early");
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // The Next development server is still compiling or binding its port.
    }
    await Bun.sleep(100);
  }
  throw new Error("routing fixture server did not become ready");
};

const waitForServerToStop = async (url: string) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await Bun.sleep(100);
  }
  throw new Error("routing fixture server did not release its port");
};

const runFixture = async (
  mode: FixtureMode,
  browser: Awaited<ReturnType<typeof chromium.launch>>
) => {
  const fixtureRoot = await mkdtemp(join(artifactRoot, `${mode}-fixture-`));
  const serverUrl = `http://localhost:${routingPort}`;
  const accountUrl = `${serverUrl}/en-US/account`;
  const checkoutUrl = `${serverUrl}/en-US/checkout/pay`;
  const statusUrl = `${serverUrl}/en-US/reservation/status/${syntheticOrderId}`;
  const accessUrl = `${serverUrl}/en-US/reservation/access/${syntheticOrderId}`;
  const exited = { value: false };
  const nextCli = resolve(
    import.meta.dir,
    "../node_modules/next/dist/bin/next"
  );

  await writeFixture(fixtureRoot, mode);
  await symlink(
    resolve(import.meta.dir, "../node_modules"),
    join(fixtureRoot, "node_modules"),
    "dir"
  );
  const server = Bun.spawn(
    [
      process.execPath,
      nextCli,
      "dev",
      "--webpack",
      "--port",
      String(routingPort),
    ],
    {
      cwd: fixtureRoot,
      env: {
        HOME: process.env.HOME ?? repositoryRoot,
        NEXT_TELEMETRY_DISABLED: "1",
        PATH: process.env.PATH ?? "",
      },
      stderr: "ignore",
      stdout: "ignore",
    }
  );
  void server.exited.then(() => {
    exited.value = true;
  });

  try {
    await waitForServer(`${serverUrl}/en-US/account`, exited);
    const page = await browser.newPage();
    try {
      const draftValue = "draft-kept";
      const expectAccountBackground = async () => {
        expect(await page.getByTestId("account-page").count()).toBe(1);
        expect(
          await page.locator('[data-account-background="true"]').count()
        ).toBe(1);
        expect(
          await page
            .getByRole("textbox", { name: "Account draft" })
            .inputValue()
        ).toBe(draftValue);
        expect(await page.locator('[data-chrome="full"]').count()).toBe(1);
      };
      const expectAccountDialog = async (testId: string) => {
        expect(await page.getByRole("dialog").count()).toBe(1);
        expect(await page.getByTestId(testId).count()).toBe(1);
        expect(await page.locator("[data-reservation-access]").count()).toBe(
          testId === "reservation-access-modal" ? 1 : 0
        );
        await expectAccountBackground();
      };
      const expectCanonicalStatus = async () => {
        expect(await page.getByRole("dialog").count()).toBe(0);
        expect(await page.getByTestId("canonical-status-page").count()).toBe(1);
        expect(await page.locator('[data-chrome="minimal"]').count()).toBe(1);
        expect(await page.locator("#status-cta").count()).toBe(1);
      };
      const expectCanonicalAccess = async () => {
        expect(await page.getByRole("dialog").count()).toBe(0);
        expect(await page.getByTestId("canonical-access-page").count()).toBe(1);
        expect(await page.locator('[data-chrome="minimal"]').count()).toBe(1);
        expect(await page.locator("[data-reservation-access]").count()).toBe(1);
        expect(
          await page.locator("[data-reservation-access-code]").count()
        ).toBe(1);
      };

      await page.goto(accountUrl, { waitUntil: "load" });
      await page.getByRole("heading", { name: "Account" }).waitFor();
      await page
        .locator('[data-testid="account-page"][data-hydrated="true"]')
        .waitFor();
      await page
        .getByRole("textbox", { name: "Account draft" })
        .fill(draftValue);

      await Promise.all([
        page.waitForURL(statusUrl),
        page.getByRole("link", { name: "Reservation details" }).click(),
      ]);
      await expectAccountDialog("reservation-status-modal");
      expect(await page.locator("#status-cta").count()).toBe(0);
      await page.screenshot({
        animations: "disabled",
        path: join(screenshotDirectory, `${mode}-account-status-modal.png`),
      });

      await Promise.all([
        page.waitForURL(accessUrl),
        page
          .getByRole("dialog")
          .getByRole("link", { name: "Access instructions" })
          .click(),
      ]);
      await expectAccountDialog("reservation-access-modal");
      expect(await page.locator("[data-reservation-access-code]").count()).toBe(
        1
      );
      await page.screenshot({
        animations: "disabled",
        path: join(screenshotDirectory, `${mode}-account-access-modal.png`),
      });

      await Promise.all([
        page.waitForURL(statusUrl),
        page
          .getByRole("dialog")
          .getByRole("link", { name: "Reservation details" })
          .click(),
      ]);
      await expectAccountDialog("reservation-status-modal");

      await Promise.all([page.waitForURL(accessUrl), page.goBack()]);
      await expectAccountDialog("reservation-access-modal");
      await Promise.all([page.waitForURL(statusUrl), page.goForward()]);
      await expectAccountDialog("reservation-status-modal");

      await Promise.all([
        page.waitForURL(accessUrl),
        page.getByRole("dialog").getByRole("button", { name: "Close" }).click(),
      ]);
      await expectAccountDialog("reservation-access-modal");
      await Promise.all([
        page.waitForURL(statusUrl),
        page.getByRole("dialog").getByRole("button", { name: "Close" }).click(),
      ]);
      await expectAccountDialog("reservation-status-modal");

      await Promise.all([
        page.waitForURL(accountUrl),
        page.getByRole("dialog").getByRole("button", { name: "Close" }).click(),
      ]);
      expect(await page.getByRole("dialog").count()).toBe(0);
      await expectAccountBackground();

      await page.getByRole("link", { name: "Reservation details" }).click();
      await page.waitForURL(statusUrl);
      await expectAccountDialog("reservation-status-modal");
      await page.goBack();
      await page.waitForURL(accountUrl);
      expect(await page.getByRole("dialog").count()).toBe(0);
      await expectAccountBackground();
      await page.goForward();
      await page.waitForURL(statusUrl);
      await expectAccountDialog("reservation-status-modal");

      await page.goto(statusUrl, { waitUntil: "load" });
      await expectCanonicalStatus();
      await page.reload({ waitUntil: "load" });
      await expectCanonicalStatus();
      await page.screenshot({
        animations: "disabled",
        path: join(screenshotDirectory, `${mode}-status-details.png`),
      });

      await page.goto(accessUrl, { waitUntil: "load" });
      await expectCanonicalAccess();
      await page.screenshot({
        animations: "disabled",
        path: join(screenshotDirectory, `${mode}-access-details.png`),
      });
      await page.reload({ waitUntil: "load" });
      await expectCanonicalAccess();
      await Promise.all([
        page.waitForURL(statusUrl),
        page.getByRole("link", { name: "Reservation details" }).click(),
      ]);
      if (mode === "global") {
        expect(await page.getByRole("dialog").count()).toBe(1);
        expect(await page.locator("#status-cta").count()).toBe(0);
      } else {
        await expectCanonicalStatus();
      }

      await page.goto(checkoutUrl, { waitUntil: "load" });
      await page.getByRole("heading", { name: "Checkout payment" }).waitFor();
      await page
        .locator('[data-testid="checkout-page"][data-hydrated="true"]')
        .waitFor();
      await Promise.all([
        page.waitForURL(statusUrl),
        page.getByRole("button", { name: "Complete checkout" }).click(),
      ]);

      if (mode === "global") {
        expect(await page.getByRole("dialog").count()).toBe(1);
        expect(await page.locator("#status-cta").count()).toBe(0);
      } else {
        await expectCanonicalStatus();
      }

      await page.reload({ waitUntil: "load" });
      await expectCanonicalStatus();

      await page.goto(accountUrl, { waitUntil: "load" });
      await page
        .locator('[data-testid="account-page"][data-hydrated="true"]')
        .waitFor();
      await page
        .getByRole("textbox", { name: "Account draft" })
        .fill(draftValue);
      await Promise.all([
        page.waitForURL(accessUrl),
        page.getByRole("link", { name: "Access instructions" }).click(),
      ]);
      await expectAccountDialog("reservation-access-modal");
      await Promise.all([
        page.waitForURL(statusUrl),
        page
          .getByRole("dialog")
          .getByRole("link", { name: "Reservation details" })
          .click(),
      ]);
      await expectAccountDialog("reservation-status-modal");
      await Promise.all([
        page.waitForURL(accessUrl),
        page.getByRole("dialog").getByRole("button", { name: "Close" }).click(),
      ]);
      await expectAccountDialog("reservation-access-modal");
      await Promise.all([
        page.waitForURL(accountUrl),
        page.getByRole("dialog").getByRole("button", { name: "Close" }).click(),
      ]);
      expect(await page.getByRole("dialog").count()).toBe(0);
      await expectAccountBackground();

      await page.waitForURL(accountUrl);
      await page.getByRole("link", { name: "Leave account" }).click();
      await page.waitForURL(checkoutUrl);
      expect(await page.getByRole("dialog").count()).toBe(0);
    } finally {
      await page.close();
    }
  } finally {
    server.kill();
    await server.exited;
    await waitForServerToStop(`${serverUrl}/en-US/account`);
    await rm(fixtureRoot, { force: true, recursive: true });
  }
};

test("isolates global and account-scoped interception behavior in actual Next routing", {
  timeout: 120_000,
}, async () => {
  await rm(artifactRoot, { force: true, recursive: true });
  await mkdir(screenshotDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    // The global variant mirrors a608fbda2: checkout-origin soft navigation is
    // incorrectly intercepted and loses the canonical page actions.
    await runFixture("global", browser);
    // The account variant is the production ownership: only account-origin
    // navigation receives the modal presentation.
    await runFixture("account", browser);
  } finally {
    await browser.close();
  }
});

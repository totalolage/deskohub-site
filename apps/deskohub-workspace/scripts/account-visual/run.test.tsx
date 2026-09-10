import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { chromium, type Page } from "@playwright/test";
import { renderToStaticMarkup } from "react-dom/server";
import { getAccountScreenCopy } from "../../features/account/components/account-screen-copy";
import { ProfileScreen } from "../../features/account/components/profile/profile-screen";
import type { JsonObject } from "./create-account-visual-verification";
import {
  assertCurrentPngMatchesHistoricalHash,
  compactCheckAttestation,
  compactComparisonMetadata,
  compareCurrentPngWithHistoricalHash,
  parseVerificationArgs,
  validateArchivalArchiveStructure,
  verifyPinnedArchiveBytes,
} from "./create-account-visual-verification";
import type { RgbaImage } from "./metrics";
import {
  markUnavailableActions,
  unavailableActionDescription,
} from "./renderer-availability";
import {
  desktopCssHeightForReference,
  HELP_TEXT,
  makeComparisonMetadata,
  parseCliArgs,
  parseRendererPort,
  readInitialDomProbe,
  readSelectedEmailProbe,
} from "./run";

const chromiumAvailable = await access(
  chromium.executablePath(),
  constants.X_OK
)
  .then(() => true)
  .catch(() => false);

const outputRoot = "/tmp/opencode/pr239-account-redesign/visual";
const expectedRendererPort = parseRendererPort(
  process.env.WORKSPACE_ACCOUNT_VISUAL_PORT
);
const referencePrefix = "e318512b-b78b-4780-8d86-7dcd43cc3d1f-";
const profileReference = "fab0fa57-710e-4a5c-9807-a8ada402931b.png";
const referenceSuffixes = {
  profile: profileReference,
  billing: "66145089-33ba-4150-92ac-242a4e6f2973.png",
  legal: "0eaa9de2-637f-413f-bdca-98e9dd02650b.png",
  danger: "392b223d-725e-4718-8ea6-6850792317e8.png",
  reservations: "49ca0eec-85be-41bb-a8c6-7cfac690311f.png",
} as const;
const menuReference = "a519a69f-b101-48ec-ba71-e9d4f1218110.png";
const sharp = createRequire(
  join(import.meta.dir, "../../../..", "packages/osm/package.json")
)("sharp");
const syntheticReferenceImage = {
  width: 2560,
  height: 1600,
  data: new Uint8Array(2560 * 1600 * 4).fill(255),
} satisfies RgbaImage;
const syntheticReferencePng = await sharp(
  Buffer.from(syntheticReferenceImage.data),
  {
    raw: {
      width: syntheticReferenceImage.width,
      height: syntheticReferenceImage.height,
      channels: 4,
    },
  }
)
  .png()
  .toBuffer();
const expectedOwnedSourcePaths = [
  "apps/deskohub-workspace/scripts/account-visual/browser-entry.tsx",
  "apps/deskohub-workspace/scripts/account-visual/create-account-visual-verification.ts",
  "apps/deskohub-workspace/scripts/account-visual/default-adapter.tsx",
  "apps/deskohub-workspace/scripts/account-visual/metrics.test.ts",
  "apps/deskohub-workspace/scripts/account-visual/metrics.ts",
  "apps/deskohub-workspace/scripts/account-visual/populated-adapter.tsx",
  "apps/deskohub-workspace/scripts/account-visual/renderer-availability.ts",
  "apps/deskohub-workspace/scripts/account-visual/renderer.css",
  "apps/deskohub-workspace/scripts/account-visual/run.test.tsx",
  "apps/deskohub-workspace/scripts/account-visual/run.ts",
  "apps/deskohub-workspace/scripts/account-visual/stubs/account-actions.ts",
  "apps/deskohub-workspace/scripts/account-visual/stubs/auth-client.ts",
  "apps/deskohub-workspace/scripts/account-visual/stubs/next-link.tsx",
  "apps/deskohub-workspace/scripts/account-visual/stubs/next-navigation.ts",
  "apps/deskohub-workspace/scripts/account-visual/stubs/server-only-fail-closed.ts",
  "apps/deskohub-workspace/scripts/account-visual/types.ts",
] as const;

const archivalScreenNames = [
  "profile",
  "billing",
  "legal",
  "danger",
  "reservations",
] as const;

const makeArchivalArchive = (): JsonObject => {
  const profileFormPath =
    "apps/deskohub-workspace/features/account/components/profile-form.tsx";
  const originalProfileSha256 =
    "5fd010ee3fb3897b7bd7b20f81644869d6884fbabe23b6b1b4e8b5747ab4586c";
  const runs = [
    {
      key: "default",
      firstOutput: "after-corrected-v2-3",
      repeatOutput: "after-corrected-v2-4",
      label: "after-corrected-v2",
      manifestSha256:
        "5821844a69055b5518e6ef578a81cda431b7c7d71fa17be10f08c7a110b3346b",
      manifestBytes: 225_232,
    },
    {
      key: "populated",
      firstOutput: "populated-corrected-v2-5",
      repeatOutput: "populated-corrected-v2-6",
      label: "populated-corrected-v2",
      manifestSha256:
        "cd052147ad3a76edea2865a5cbcdc6fcb5681957a8b92fff328768eb38d1b915",
      manifestBytes: 270_594,
    },
    {
      key: "czech",
      firstOutput: "cs-corrected-v2-3",
      repeatOutput: "cs-corrected-v2-4",
      label: "cs-corrected-v2",
      manifestSha256:
        "89ada2c87f730629d97a47f4f5ff1d157240f00430228f99078bdeed88e35018",
      manifestBytes: 225_232,
    },
  ] as const;
  const archivedPngSha256 = "a".repeat(64);
  const makeCapture = (
    output: string,
    label: string,
    manifestSha256: string,
    manifestBytes: number
  ) => ({
    label,
    outputDirectory: `/tmp/opencode/pr239-account-redesign/visual/${output}`,
    status: "passed",
    sourceManifest: {
      path: "source-manifest.json",
      sha256: manifestSha256,
      bytes: manifestBytes,
    },
  });

  return {
    schemaVersion: 4,
    sourceVerification: {
      productionHashChecks: {
        [profileFormPath]: {
          expectedSha256: originalProfileSha256,
          actualSha256: originalProfileSha256,
          bytes: 26_651,
          match: true,
        },
      },
    },
    runs: {
      correctedV2: Object.fromEntries(
        runs.map(
          ({
            key,
            firstOutput,
            repeatOutput,
            label,
            manifestSha256,
            manifestBytes,
          }) => {
            const first = makeCapture(
              firstOutput,
              label,
              manifestSha256,
              manifestBytes
            );
            const repeat = makeCapture(
              repeatOutput,
              label,
              manifestSha256,
              manifestBytes
            );
            const sourceManifest = {
              path: "source-manifest.json",
              sha256: manifestSha256,
              bytes: manifestBytes,
            };
            return [
              key,
              {
                fullCapturePair: { first, repeat },
                sourceManifests: {
                  first: sourceManifest,
                  repeat: sourceManifest,
                  pairEqual: true,
                },
                desktop: Object.fromEntries(
                  archivalScreenNames.map((screen) => [
                    screen,
                    {
                      first: { hashes: { main: archivedPngSha256 } },
                      repeat: { hashes: { main: archivedPngSha256 } },
                    },
                  ])
                ),
              },
            ];
          }
        )
      ),
    },
  } as JsonObject;
};

const replaceJsonValue = (
  value: JsonObject,
  path: readonly string[],
  replacement: string
): JsonObject => {
  const copy = structuredClone(value) as JsonObject;
  let current = copy;
  for (const segment of path.slice(0, -1)) {
    current = current[segment] as JsonObject;
  }
  current[path[path.length - 1]!] = replacement;
  return copy as JsonObject;
};

const writeRegressionReference = async (referencesDir: string) => {
  await mkdir(referencesDir, { recursive: true });
  for (const suffix of Object.values(referenceSuffixes)) {
    await writeFile(
      join(referencesDir, `${referencePrefix}${suffix}`),
      syntheticReferencePng
    );
  }
  await writeFile(
    join(referencesDir, `${referencePrefix}${menuReference}`),
    syntheticReferencePng
  );
};

const runRendererCli = async (argumentsList: readonly string[]) => {
  const result = spawnSync(
    process.execPath,
    ["run", join(import.meta.dir, "run.ts"), ...argumentsList],
    {
      cwd: join(import.meta.dir, "../../../.."),
      env: process.env,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      shell: false,
      timeout: 60_000,
    }
  );

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const diagnostics = [stderr, stdout].filter(Boolean).join("\n");
  if (result.error) {
    throw new Error(
      `Account visual CLI failed to spawn or timed out: ${result.error.message}${diagnostics ? `\n${diagnostics}` : ""}`,
      { cause: result.error }
    );
  }
  if (result.status !== 0 || result.signal !== null) {
    const termination =
      result.signal === null ? result.status : `signal ${result.signal}`;
    throw new Error(
      `Account visual CLI exited with ${termination}: ${diagnostics}`
    );
  }
  const summary = JSON.parse(stdout) as { readonly outputDirectory: string };
  return Bun.file(join(summary.outputDirectory, "report.json")).json();
};

test("renderer CLI failures propagate through the subprocess seam", async () => {
  await expect(
    runRendererCli(["--unknown-account-visual-argument"])
  ).rejects.toThrow(
    /Account visual CLI exited with 1:[\s\S]*Unknown argument: --unknown-account-visual-argument/
  );
});

const withControlledPage = async <T,>(
  {
    html,
    locale,
    width,
  }: {
    readonly html: string;
    readonly locale: "en-US" | "cs-CZ";
    readonly width: number;
  },
  check: (page: Page) => Promise<T>
): Promise<T> => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale,
    viewport: { width, height: 360 },
  });
  const page = await context.newPage();
  try {
    const rendererCss = await readFile(
      join(import.meta.dir, "renderer.css"),
      "utf8"
    );
    await page.setContent(`<style>${rendererCss}</style>${html}`);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    return await check(page);
  } finally {
    await context.close();
    await browser.close();
  }
};

const productionProfileEmail = "ada@example.test";
const productionProfileEmailFieldSelector =
  "[data-slot='profile-screen'] fieldset[aria-labelledby$='-email-label'] > div";
const productionProfileEmailStatusSelector = `${productionProfileEmailFieldSelector} > button`;
const productionProfileEmailProbeCss = `
  html, body {
    width: 100%;
    margin: 0;
    padding: 0;
  }

  [data-slot="profile-screen"] {
    box-sizing: border-box;
    width: 100%;
    padding: 16px;
  }

  [data-slot="profile-screen"] fieldset[aria-labelledby$="-email-label"] {
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
  }

  [data-slot="profile-screen"] fieldset[aria-labelledby$="-email-label"] > div {
    position: relative;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 40px;
    padding: 4px 8px;
    overflow: visible;
  }

  ${productionProfileEmailFieldSelector} > span {
    min-width: 0;
    flex: 1 1 auto;
    overflow-wrap: anywhere;
  }

  ${productionProfileEmailStatusSelector} {
    box-sizing: border-box;
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    padding: 0;
  }
`;

const productionProfileEmailHtml = (locale: "en-US" | "cs-CZ"): string =>
  `<style>${productionProfileEmailProbeCss}</style>${renderToStaticMarkup(
    <ProfileScreen
      copy={getAccountScreenCopy(locale).profile}
      email={productionProfileEmail}
      firstName="Ada"
      lastName="Lovelace"
      locale={locale}
    >
      {null}
    </ProfileScreen>
  )}`;

const readProductionProfileEmailProbeRect = async (
  page: Page,
  selector: string
) =>
  page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      right: rect.right,
      bottom: rect.bottom,
    };
  });

const controlledHeaderFixture = (
  heading: string,
  {
    narrow = false,
    overflowing = false,
    srOnlyLabel = false,
    headingFontSize = 24,
    headingWidth,
  }: {
    readonly narrow?: boolean;
    readonly overflowing?: boolean;
    readonly srOnlyLabel?: boolean;
    readonly headingFontSize?: number;
    readonly headingWidth?: number;
  } = {}
) => {
  let headingLayout = "flex:1 1 auto; min-width:0;";
  if (narrow) {
    headingLayout = "flex:0 0 32px; width:32px; overflow-wrap:anywhere;";
  } else if (overflowing) {
    headingLayout =
      "flex:0 0 160px; width:160px; min-width:160px; overflow:hidden; white-space:nowrap;";
  } else if (headingWidth !== undefined) {
    headingLayout = `flex:0 0 ${headingWidth}px; width:${headingWidth}px; min-width:${headingWidth}px;`;
  }
  return `
  <main style="width:100%; margin:0; padding:0;">
    <header style="display:flex; align-items:center; gap:16px; width:100%; padding:16px; box-sizing:border-box;">
      <h1 style="${headingLayout} margin:0; font:700 ${headingFontSize}px/28px Arial, sans-serif;">${heading}</h1>
      <button id="account-sign-out" type="button" aria-label="Sign out" style="flex:0 0 auto;">Sign out</button>
    </header>
    ${
      srOnlyLabel
        ? '<span class="sr-only" style="position:absolute; top:0; left:0; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0, 0, 0, 0); white-space:nowrap; border:0;">Screen reader only label</span>'
        : ""
    }
  </main>
`;
};

const controlledEmailFixture = ({
  overflowingStatus = false,
  statusText = "Verified",
  missingStatus = false,
  includeSectionNavigation = false,
  longPage = false,
}: {
  readonly overflowingStatus?: boolean;
  readonly statusText?: string;
  readonly missingStatus?: boolean;
  readonly includeSectionNavigation?: boolean;
  readonly longPage?: boolean;
} = {}) => `
  ${
    includeSectionNavigation
      ? `<div data-account-mobile-navigation>
    <button type="button" data-account-section="reservations" aria-current="page">Reservations</button>
    <button type="button" data-account-section="profile">Profile</button>
  </div>`
      : ""
  }
  <main style="position:relative; width:100%; min-height:500px; margin:0; padding:0;">
    <header style="display:flex; width:100%; padding:16px; box-sizing:border-box;">
      <h1 style="flex:1 1 auto; min-width:160px; margin:0; font:700 24px/28px Arial, sans-serif;">Account</h1>
    </header>
    ${longPage ? '<span data-fixture-long-text style="position:absolute; top:325px; left:0; white-space:nowrap; font-size:8px; line-height:19px;">Long page content</span>' : ""}
    ${longPage ? '<div style="height:230px;"></div>' : ""}
    ${
      includeSectionNavigation
        ? '<section data-fixture-screen="reservations" style="padding:16px;">Current reservations</section>'
        : ""
    }
    <section data-slot="profile-screen" style="padding:16px;${
      includeSectionNavigation ? "display:none;" : ""
    }">
      <div data-fixture-field="login-email">
        <div>Verified login email</div>
        <div data-fixture-value style="position:relative; display:flex; gap:8px; width:100%; overflow:hidden; font-size:8px; line-height:19px;">
          <span>ada@example.test</span>
          ${
            missingStatus
              ? ""
              : `<span data-fixture-status style="${
                  overflowingStatus
                    ? "position:absolute; left:300px; top:0; white-space:nowrap; font-size:8px;"
                    : "white-space:nowrap; font-size:8px;"
                }">${statusText}</span>`
          }
        </div>
      </div>
    </section>
  </main>
  ${
    includeSectionNavigation
      ? `<script>
    const sectionButtons = Array.from(document.querySelectorAll("[data-account-mobile-navigation] button[data-account-section]"));
    const reservations = document.querySelector("[data-fixture-screen='reservations']");
    const profile = document.querySelector("[data-slot='profile-screen']");
    sectionButtons.forEach((button) => button.addEventListener("click", () => {
      sectionButtons.forEach((candidate) => {
        if (candidate === button) candidate.setAttribute("aria-current", "page");
        else candidate.removeAttribute("aria-current");
      });
      const isProfile = button.dataset.accountSection === "profile";
      reservations.style.display = isProfile ? "none" : "block";
      profile.style.display = isProfile ? "block" : "none";
    }));
  </script>`
      : ""
  }
`;

const writeRegressionAdapter = async (directory: string) => {
  const path = join(directory, "overflow-adapter.tsx");
  const reactEntry = join(
    import.meta.dir,
    "../../node_modules/react/cjs/react.production.js"
  );
  await writeFile(
    path,
    `import { createElement } from ${JSON.stringify(reactEntry)};

export const accountVisualAdapterMetadata = {
  owner: "temporary overflow adapter",
  fixture: "temporary linked source and legal destination",
};

export default function OverflowAdapter({ screen }: { screen: string }) {
  const overflowing = screen === "profile";
  return createElement(
    "main",
    { style: { width: overflowing ? "2200px" : "100%" } },
    createElement("a", { href: "?screen=legal" }, "Legal destination")
  );
}
`,
    "utf8"
  );
  return path;
};

const writeMissingLegalAdapter = async (directory: string) => {
  const path = join(directory, "missing-legal-adapter.tsx");
  const reactEntry = join(
    import.meta.dir,
    "../../node_modules/react/cjs/react.production.js"
  );
  await writeFile(
    path,
    `import { createElement, useState } from ${JSON.stringify(reactEntry)};

const sections = [
  ["profile", "Profile & Identity"],
  ["billing", "Billing & Invoices"],
  ["legal", "Legal & Privacy"],
  ["danger", "Danger zone"],
  ["reservations", "Reservations"],
];

export const accountVisualAdapterMetadata = {
  owner: "temporary missing legal adapter",
  fixture: "temporary production-shaped shell without legal target",
};

export default function MissingLegalAdapter() {
  const [active, setActive] = useState("profile");
  const target =
    active === "profile"
      ? createElement("div", { "data-slot": "profile-screen" }, "Profile")
      : active === "billing"
        ? createElement("div", { id: "account-profile-billing-kind" }, "Billing")
        : active === "danger"
          ? createElement("button", { id: "delete-account-trigger", type: "button" }, "Delete")
          : active === "reservations"
            ? createElement("h2", { id: "account-reservations-current-title" }, "Reservations")
            : createElement("div", null, "Legal target missing");
  return createElement(
    "main",
    null,
    createElement(
      "nav",
      { "aria-label": "Account navigation" },
      sections.map(([key, label]) =>
        createElement(
          "button",
           {
             "aria-current": active === key ? "page" : undefined,
             key,
             onClick: () => setActive(key),
             type: "button",
           },
          label
        )
      )
    ),
    createElement(
      "div",
      { "data-account-mobile-navigation": "" },
      sections.map(([key, label]) =>
        createElement(
          "button",
          {
            "aria-current": active === key ? "page" : undefined,
            "data-account-section": key,
            key,
            onClick: () => setActive(key),
            type: "button",
          },
          label
        )
      )
    ),
    target
  );
}
`,
    "utf8"
  );
  return path;
};

const writeRoundtripOverflowAdapter = async (directory: string) => {
  const path = join(directory, "roundtrip-overflow-adapter.tsx");
  const reactEntry = join(
    import.meta.dir,
    "../../node_modules/react/cjs/react.production.js"
  );
  await writeFile(
    path,
    `import { createElement, useState } from ${JSON.stringify(reactEntry)};

const sections = [
  ["profile", "Profile & Identity"],
  ["billing", "Billing & Invoices"],
  ["legal", "Legal & Privacy"],
  ["danger", "Danger zone"],
  ["reservations", "Reservations"],
];

export const accountVisualAdapterMetadata = {
  owner: "temporary roundtrip overflow adapter",
  fixture: "temporary production-shaped shell with initial overflow",
};

export default function RoundtripOverflowAdapter() {
  const [active, setActive] = useState("profile");
  const [visitedAlternate, setVisitedAlternate] = useState(false);
  const [firstName, setFirstName] = useState("Ada");
  const [companyName, setCompanyName] = useState("");
  const changeSection = (nextSection) => {
    if (nextSection !== "profile") setVisitedAlternate(true);
    setActive(nextSection);
  };
  const target =
    active === "profile"
       ? createElement(
           "div",
           { "data-slot": "profile-screen" },
           createElement(
             "form",
             { id: "account-profile-form" },
             createElement(
               "label",
               { htmlFor: "account-profile-first-name" },
               "First name"
             ),
             createElement("input", {
               id: "account-profile-first-name",
               onChange: (event) => setFirstName(event.currentTarget.value),
               required: true,
               value: firstName,
             })
           )
        )
      : active === "billing"
        ? createElement(
            "div",
            null,
            createElement(
              "select",
              { id: "account-profile-billing-kind", value: "business", onChange: () => {} },
              createElement("option", { value: "business" }, "Business")
            ),
            createElement("input", {
              id: "account-profile-billing-company-name",
              onChange: (event) => setCompanyName(event.currentTarget.value),
              value: companyName,
            })
          )
        : active === "legal"
          ? createElement("a", { href: "/en-US/privacy-policy" }, "Privacy")
          : active === "danger"
            ? createElement("button", { id: "delete-account-trigger", type: "button" }, "Delete")
            : createElement("h2", { id: "account-reservations-current-title" }, "Reservations");
  return createElement(
    "main",
    { style: { overflowX: "hidden", width: "100%" } },
    createElement(
      "nav",
      { "aria-label": "Account navigation" },
      sections.map(([key, label]) =>
        createElement(
          "button",
           {
             "aria-current": active === key ? "page" : undefined,
             key,
             onClick: () => changeSection(key),
             type: "button",
           },
          label
        )
      )
    ),
    createElement(
      "div",
      { "data-account-mobile-navigation": "" },
      sections.map(([key, label]) =>
        createElement(
          "button",
          {
            "aria-current": active === key ? "page" : undefined,
            "data-account-section": key,
            key,
            onClick: () => changeSection(key),
            type: "button",
          },
          label
        )
      )
    ),
    target,
    createElement("div", {
      style: {
        height: "1px",
        width: active === "profile" && !visitedAlternate ? "2200px" : "100%",
      },
    })
  );
}
`,
    "utf8"
  );
  return path;
};

type NavigationOverflow = "auto" | "scroll" | "hidden" | "clip";

const writeNavigationOverflowAdapter = async (
  directory: string,
  overflowX: NavigationOverflow,
  activeClipped = false
) => {
  const path = join(
    directory,
    `navigation-overflow-${overflowX}${activeClipped ? "-active-clipped" : ""}-adapter.tsx`
  );
  const reactEntry = join(
    import.meta.dir,
    "../../node_modules/react/cjs/react.production.js"
  );
  await writeFile(
    path,
    `import { createElement, useState } from ${JSON.stringify(reactEntry)};

const sections = [
  ["profile", "Profile & Identity"],
  ["billing", "Billing & Invoices"],
  ["legal", "Legal & Privacy"],
  ["danger", "Danger zone"],
  ["reservations", "Reservations"],
];

export const accountVisualAdapterMetadata = {
  owner: "temporary mobile navigation overflow adapter",
  fixture: ${JSON.stringify(`${overflowX} marked navigation${activeClipped ? " with clipped active section" : ""}`)},
};

export default function NavigationOverflowAdapter() {
  const [active, setActive] = useState("profile");
  const [firstName, setFirstName] = useState("Ada");
  const [companyName, setCompanyName] = useState("");
  const target =
    active === "profile"
      ? createElement(
          "div",
          { "data-slot": "profile-screen" },
          createElement(
            "form",
            { id: "account-profile-form" },
            createElement(
              "label",
              { htmlFor: "account-profile-first-name" },
              "First name"
            ),
            createElement("input", {
              id: "account-profile-first-name",
              onChange: (event) => setFirstName(event.currentTarget.value),
              required: true,
              value: firstName,
            })
          )
        )
      : active === "billing"
        ? createElement(
            "div",
            null,
            createElement(
              "select",
              {
                id: "account-profile-billing-kind",
                onChange: () => {},
                value: "business",
              },
              createElement("option", { value: "business" }, "Business")
            ),
            createElement("input", {
              id: "account-profile-billing-company-name",
              onChange: (event) => setCompanyName(event.currentTarget.value),
              value: companyName,
            })
          )
        : active === "legal"
          ? createElement("a", { href: "/en-US/privacy-policy" }, "Privacy")
          : active === "danger"
            ? createElement(
                "button",
                { id: "delete-account-trigger", type: "button" },
                "Delete"
              )
            : createElement(
                "h2",
                { id: "account-reservations-current-title" },
                "Reservations"
              );

  return createElement(
    "main",
    { style: { minHeight: "500px", width: "100%" } },
    createElement(
      "nav",
      { "aria-label": "Account navigation" },
      sections.map(([key, label]) =>
        createElement(
          "button",
          {
            "aria-current": active === key ? "page" : undefined,
            key,
            onClick: () => setActive(key),
            type: "button",
          },
          label
        )
      )
    ),
    createElement(
      "div",
      {
        "data-account-mobile-navigation": "",
        id: "navigation-overflow-nav",
        style: {
          display: "flex",
          gap: "8px",
          overflowX: ${JSON.stringify(overflowX)},
          width: "320px",
        },
      },
      sections.map(([key, label]) =>
        createElement(
          "button",
          {
            "aria-current": active === key ? "page" : undefined,
            "data-account-section": key,
            key,
            onClick: () => setActive(key),
            style: {
              flexShrink: 0,
              whiteSpace: "nowrap",
              ${activeClipped ? 'transform: key === "profile" ? "translateX(-16px)" : undefined,' : ""}
            },
            type: "button",
          },
          label
        )
      )
    ),
    target
  );
}
`,
    "utf8"
  );
  return path;
};

const writeViewportWidthOverflowAdapter = async (directory: string) => {
  const path = join(directory, "viewport-width-overflow-adapter.tsx");
  const reactEntry = join(
    import.meta.dir,
    "../../node_modules/react/cjs/react.production.js"
  );
  await writeFile(
    path,
    `import { createElement } from ${JSON.stringify(reactEntry)};

export const accountVisualAdapterMetadata = {
  owner: "temporary viewport overflow adapter",
  fixture: "viewport-width block with nowrap text",
};

export default function ViewportWidthOverflowAdapter() {
  return createElement(
    "main",
    { style: { width: "100%" } },
    createElement(
      "div",
      { style: { overflowX: "visible", whiteSpace: "nowrap", width: "100%" } },
      "This intentionally long unbroken line exceeds the viewport while its block box remains viewport-sized."
    ),
    createElement("a", { href: "?screen=legal" }, "Legal destination")
  );
}
`,
    "utf8"
  );
  return path;
};

const writeComputedStyleAdapter = async (directory: string) => {
  const path = join(directory, "computed-style-adapter.tsx");
  const reactEntry = join(
    import.meta.dir,
    "../../node_modules/react/cjs/react.production.js"
  );
  await writeFile(
    path,
    `import { createElement, useState } from ${JSON.stringify(reactEntry)};

const sections = [
  ["profile", "Profile & Identity"],
  ["billing", "Billing & Invoices"],
  ["legal", "Legal & Privacy"],
  ["danger", "Danger zone"],
  ["reservations", "Reservations"],
];

export const accountVisualAdapterMetadata = {
  owner: "temporary computed-style adapter",
  fixture: "styled shell with a two-row past reservations table",
};

const headingStyle = {
  fontFamily: "Arial",
  fontSize: "32px",
  fontWeight: "700",
  lineHeight: "40px",
};

export default function ComputedStyleAdapter() {
  const [active, setActive] = useState("reservations");
  const [firstName, setFirstName] = useState("Ada");
  const [companyName, setCompanyName] = useState("");
  const target =
    active === "profile"
      ? createElement(
          "div",
          { "data-slot": "profile-screen" },
          createElement(
            "form",
            { id: "account-profile-form" },
            createElement("input", {
              id: "account-profile-first-name",
              onChange: (event) => setFirstName(event.currentTarget.value),
              required: true,
              value: firstName,
            })
          )
        )
      : active === "billing"
        ? createElement(
            "div",
            null,
            createElement(
              "select",
              {
                id: "account-profile-billing-kind",
                onChange: () => {},
                value: "business",
              },
              createElement("option", { value: "business" }, "Business")
            ),
            createElement("input", {
              id: "account-profile-billing-company-name",
              onChange: (event) => setCompanyName(event.currentTarget.value),
              value: companyName,
            })
          )
        : active === "legal"
          ? createElement("a", { href: "/en-US/privacy-policy" }, "Privacy")
          : active === "danger"
            ? createElement("button", { id: "delete-account-trigger", type: "button" }, "Delete")
            : createElement(
                "div",
                { "data-slot": "reservations-screen" },
                createElement("h2", { id: "account-reservations-current-title", style: headingStyle }, "Current reservations"),
                createElement(
                  "section",
                  null,
                  createElement("h2", { style: headingStyle }, "Past reservations (2)"),
                  createElement(
                    "table",
                    null,
                    createElement("caption", null, "Past reservations (2)"),
                    createElement(
                      "thead",
                      null,
                      createElement(
                        "tr",
                        null,
                        createElement("th", null, "Date"),
                        createElement("th", null, "Product")
                      )
                    ),
                    createElement(
                      "tbody",
                      null,
                      createElement(
                        "tr",
                        null,
                        createElement("td", null, "2026-10-01"),
                        createElement("td", null, "Office")
                      ),
                      createElement(
                        "tr",
                        null,
                        createElement("td", null, "2026-09-01"),
                        createElement("td", null, "Cowork")
                      )
                    )
                  )
                )
              );
  return createElement(
    "main",
    {
      style: {
        backgroundColor: "#102030",
        backgroundImage: "linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))",
        width: "100%",
      },
    },
    createElement(
      "aside",
      {
        "data-slot": "account-sidebar",
        style: { backgroundColor: "#405060", borderRadius: "8px" },
      },
      createElement(
        "nav",
        { "aria-label": "Account navigation" },
        sections.map(([key, label]) =>
          createElement(
            "button",
            {
              "aria-current": active === key ? "page" : undefined,
              key,
              onClick: () => setActive(key),
              style:
                active === key
                  ? { backgroundColor: "#203040", borderRadius: "12px", color: "#fefefe" }
                  : undefined,
              type: "button",
            },
            key === "reservations" ? label + "2" : label
          )
        )
      )
    ),
    createElement(
      "div",
      { "data-account-mobile-navigation": "" },
      sections.map(([key, label]) =>
        createElement(
          "button",
          {
            "aria-current": active === key ? "page" : undefined,
            "data-account-section": key,
            key,
            onClick: () => setActive(key),
            type: "button",
          },
          label
        )
      )
    ),
    createElement("h1", { style: headingStyle }, "Account"),
    target
  );
}
`,
    "utf8"
  );
  return path;
};

const writeNonWorkingCancelAdapter = async (directory: string) => {
  const path = join(directory, "non-working-cancel-adapter.tsx");
  const reactEntry = join(
    import.meta.dir,
    "../../node_modules/react/cjs/react.production.js"
  );
  await writeFile(
    path,
    `import { createElement, useState } from ${JSON.stringify(reactEntry)};

export const accountVisualAdapterMetadata = {
  owner: "temporary non-working cancel adapter",
  fixture: "temporary dialog with checkbox and non-working footer cancel",
};

export default function NonWorkingCancelAdapter() {
  const [open, setOpen] = useState(false);
  return createElement(
    "main",
    null,
    createElement(
      "button",
      { id: "delete-account-trigger", onClick: () => setOpen(true), type: "button" },
      "Delete"
    ),
    open
      ? createElement(
          "div",
          {
            "data-state": "open",
            onKeyDown: (event) => {
              if (event.key === "Escape") setOpen(false);
            },
            role: "dialog",
          },
           createElement(
             "div",
             null,
             createElement(
               "button",
               { "aria-checked": "false", onClick: () => {}, role: "checkbox", type: "button" },
               "I understand"
             )
           ),
           createElement(
             "div",
             null,
             createElement(
               "button",
               { onClick: () => {}, type: "button" },
               "Cancel"
             ),
             createElement(
               "button",
               { disabled: true, id: "delete-account-confirm", type: "button" },
               "Delete"
            )
          )
        )
      : null
  );
}
`,
    "utf8"
  );
  return path;
};

test("CLI parses the prescribed screen and adapter options", () => {
  const options = parseCliArgs([
    "--label",
    "after",
    "--screen",
    "legal",
    "--adapter",
    "scripts/account-visual/default-adapter.tsx",
    "--references",
    "/tmp/references",
    "--output",
    "/tmp/opencode/pr239-account-redesign/visual",
  ]);

  expect(options).toEqual({
    adapterPath: "scripts/account-visual/default-adapter.tsx",
    help: false,
    label: "after",
    locale: "en-US",
    outputRoot: "/tmp/opencode/pr239-account-redesign/visual",
    port: expectedRendererPort,
    referencesDir: "/tmp/references",
    screen: "legal",
    tablet: false,
  });
});

test("help is available without a label", () => {
  const options = parseCliArgs(["--help"]);

  expect(options.help).toBe(true);
  expect(HELP_TEXT).toContain(
    "Usage: bun apps/deskohub-workspace/scripts/account-visual/run.ts"
  );
  expect(HELP_TEXT).toContain("Limitations:");
});

test("desktop contract documents the chosen physical-pixel interpretation", async () => {
  expect(desktopCssHeightForReference(1419)).toBe(710);
  expect(desktopCssHeightForReference(2015)).toBe(1008);
  expect(desktopCssHeightForReference(1312)).toBe(656);
  expect(desktopCssHeightForReference(1419, 1)).toBe(1419);
  expect(HELP_TEXT).toContain("1280 CSS px wide, DPR 2");
  expect(HELP_TEXT).toContain(
    "Reference PNG pixels remain native with no resize"
  );
  expect(HELP_TEXT).toContain(
    "One renderer process owns the selected localhost port"
  );
  expect(HELP_TEXT).toContain("default 3111");
  expect(HELP_TEXT).toContain("WORKSPACE_ACCOUNT_VISUAL_PORT");
  expect(HELP_TEXT).toContain("--adapter PATH");
  expect(HELP_TEXT).toContain("--tablet");

  const rendererCss = await readFile(
    join(import.meta.dir, "renderer.css"),
    "utf8"
  );
  expect(rendererCss).toContain("--site-header-height: 0px;");
  expect(rendererCss).not.toContain("::after");
  expect(HELP_TEXT).toContain("layout-neutral-unavailable-annotation-v2");
  expect(HELP_TEXT).toContain("Historical baseline comparability is false");

  expect(
    parseCliArgs(["--label", "czech-tablet", "--locale", "cs-CZ", "--tablet"])
  ).toMatchObject({ locale: "cs-CZ", tablet: true });
});

test("renderer port accepts only valid TCP port integers", () => {
  expect(parseRendererPort(undefined)).toBe(3111);
  expect(parseRendererPort("3164")).toBe(3164);
  expect(parseRendererPort("1")).toBe(1);
  expect(parseRendererPort("65535")).toBe(65535);

  for (const value of ["", "0", "65536", "3164.5", "3164x", "-1"]) {
    expect(() => parseRendererPort(value)).toThrow(
      "WORKSPACE_ACCOUNT_VISUAL_PORT must be a decimal integer from 1 through 65535"
    );
  }
});

test("CLI rejects unsupported screens and unsafe labels", () => {
  expect(() =>
    parseCliArgs(["--label", "baseline", "--screen", "settings"])
  ).toThrow(
    "--screen must be profile, billing, legal, danger, or reservations"
  );
  expect(() => parseCliArgs(["--label", "../baseline"])).toThrow(
    "--label must contain only letters, numbers, dots, underscores, or hyphens"
  );
});

test("comparison metadata discloses locale and fixture comparability", () => {
  const defaultAdapter = join(import.meta.dir, "default-adapter.tsx");
  const populatedAdapter = join(import.meta.dir, "populated-adapter.tsx");

  expect(makeComparisonMetadata(defaultAdapter, "en-US")).toEqual({
    referenceLocale: "en-US",
    captureLocale: "en-US",
    copyMismatch: false,
    fixture:
      "apps/deskohub-workspace/scripts/account-visual/default-adapter.tsx",
    rendererMethodVersion: "layout-neutral-unavailable-annotation-v2",
    historicalBaselineComparability: false,
    historicalBaselineComparabilityReason: "annotation-layout-changed",
    iterationComparabilityRule:
      "eligible only when rendererMethodVersion, fixture, and locale match",
    controlledComparability: false,
    controlledComparabilityCaveat:
      "historical baseline is not controlled: prior renderer annotation changed layout",
  });
  expect(makeComparisonMetadata(populatedAdapter, "en-US")).toEqual({
    referenceLocale: "en-US",
    captureLocale: "en-US",
    copyMismatch: false,
    fixture:
      "apps/deskohub-workspace/scripts/account-visual/populated-adapter.tsx",
    rendererMethodVersion: "layout-neutral-unavailable-annotation-v2",
    historicalBaselineComparability: false,
    historicalBaselineComparabilityReason: "annotation-layout-changed",
    iterationComparabilityRule:
      "eligible only when rendererMethodVersion, fixture, and locale match",
    controlledComparability: false,
    controlledComparabilityCaveat:
      "historical baseline is not controlled: fixture differs from the default baseline and renderer annotation layout changed",
  });
  expect(makeComparisonMetadata(defaultAdapter, "cs-CZ")).toEqual({
    referenceLocale: "en-US",
    captureLocale: "cs-CZ",
    copyMismatch: true,
    fixture:
      "apps/deskohub-workspace/scripts/account-visual/default-adapter.tsx",
    rendererMethodVersion: "layout-neutral-unavailable-annotation-v2",
    historicalBaselineComparability: false,
    historicalBaselineComparabilityReason: "annotation-layout-changed",
    iterationComparabilityRule:
      "eligible only when rendererMethodVersion, fixture, and locale match",
    controlledComparability: false,
    controlledComparabilityCaveat:
      "historical baseline is not controlled: capture copy locale cs-CZ differs from reference locale en-US; renderer annotation layout changed",
  });
});

test("verification keeps comparison metadata on each run", () => {
  expect(
    compactComparisonMetadata({
      comparison: {
        referenceLocale: "en-US",
        captureLocale: "cs-CZ",
        copyMismatch: true,
        fixture: "controlled fixture",
        rendererMethodVersion: "layout-neutral-unavailable-annotation-v2",
        historicalBaselineComparability: false,
        historicalBaselineComparabilityReason: "annotation-layout-changed",
        iterationComparabilityRule:
          "eligible only when rendererMethodVersion, fixture, and locale match",
        controlledComparability: false,
        controlledComparabilityCaveat: "synthetic fixture caveat",
      },
    })
  ).toEqual({
    referenceLocale: "en-US",
    captureLocale: "cs-CZ",
    copyMismatch: true,
    fixture: "controlled fixture",
    rendererMethodVersion: "layout-neutral-unavailable-annotation-v2",
    historicalBaselineComparability: false,
    historicalBaselineComparabilityReason: "annotation-layout-changed",
    iterationComparabilityRule:
      "eligible only when rendererMethodVersion, fixture, and locale match",
    controlledComparability: false,
    controlledComparabilityCaveat: "synthetic fixture caveat",
  });
});

test("verification derives check status from supplied command evidence", () => {
  expect(
    compactCheckAttestation({
      name: "focused tests",
      command: "bun test focused",
      cwd: "/tmp/worktree",
      exitCode: 0,
      stdout: "17 pass, 112 expect() calls",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      counts: { tests: 17, passed: 17, failed: 0, expectCalls: 112 },
    })
  ).toMatchObject({
    command: "bun test focused",
    exitCode: 0,
    status: "passed",
    stdout: "17 pass, 112 expect() calls",
    counts: { tests: 17, passed: 17, failed: 0, expectCalls: 112 },
  });
  expect(
    compactCheckAttestation({
      name: "failed check",
      command: "bun test failing",
      cwd: "/tmp/worktree",
      exitCode: 1,
      stdout: "",
      stderr: "1 fail",
      stdoutTruncated: false,
      stderrTruncated: false,
      counts: { tests: 1, passed: 0, failed: 1 },
    }).status
  ).toBe("failed");
});

test("verification CLI requires externally captured checks", () => {
  expect(() => parseVerificationArgs([])).toThrow("--checks is required");
  expect(
    parseVerificationArgs([
      "/tmp/account-visual",
      "--checks",
      "/tmp/account-visual-checks.json",
    ])
  ).toEqual({
    archivePath: "/tmp/account-visual/final-verification.json",
    help: false,
    visualRoot: "/tmp/account-visual",
    checksPath: "/tmp/account-visual-checks.json",
    outputPath: "/tmp/account-visual/final-archival-hash-verification.json",
  });
});

test("archival hash verifier rejects a changed pinned archive", () => {
  expect(() => verifyPinnedArchiveBytes(new Uint8Array([0]))).toThrow(
    "Pinned archival final-verification.json SHA-256 or byte length mismatch"
  );
});

test("archival hash verifier rejects original manifest identity drift", () => {
  const archive = makeArchivalArchive();
  expect(validateArchivalArchiveStructure(archive).runs).toHaveLength(3);

  const driftedArchive = replaceJsonValue(
    archive,
    [
      "runs",
      "correctedV2",
      "default",
      "fullCapturePair",
      "first",
      "sourceManifest",
      "sha256",
    ],
    "b".repeat(64)
  );

  expect(() => validateArchivalArchiveStructure(driftedArchive)).toThrow(
    "default original first capture original source manifest identity drifted"
  );
});

test("archival hash verifier rejects a current PNG hash mismatch", () => {
  expect(() =>
    assertCurrentPngMatchesHistoricalHash({
      scenario: "default",
      screen: "profile",
      currentSha256: "b".repeat(64),
      firstSha256: "a".repeat(64),
      repeatSha256: "a".repeat(64),
    })
  ).toThrow(
    "default/profile current PNG does not match previously recorded historical PNG hash"
  );
});

test("archival comparison branches legacy proof from new-method informational diffs", () => {
  const legacy = compareCurrentPngWithHistoricalHash({
    currentFixture: null,
    currentLocale: null,
    currentRendererMethodVersion: "layout-changing-unavailable-annotation-v1",
    expectedFixture:
      "apps/deskohub-workspace/scripts/account-visual/default-adapter.tsx",
    expectedLocale: "en-US",
    currentSha256: "a".repeat(64),
    firstSha256: "a".repeat(64),
    repeatSha256: "a".repeat(64),
    scenario: "default",
    screen: "profile",
  });
  expect(legacy).toMatchObject({
    comparisonMode: "old-capture-method-archive-hash-proof",
    archiveHashProof: "passed",
    changedPixelsAllowed: false,
    pixelPerfectStatus: "not-asserted",
  });

  const newMethod = compareCurrentPngWithHistoricalHash({
    currentFixture:
      "apps/deskohub-workspace/scripts/account-visual/default-adapter.tsx",
    currentLocale: "en-US",
    currentRendererMethodVersion: "layout-neutral-unavailable-annotation-v2",
    expectedFixture:
      "apps/deskohub-workspace/scripts/account-visual/default-adapter.tsx",
    expectedLocale: "en-US",
    currentSha256: "b".repeat(64),
    firstSha256: "a".repeat(64),
    repeatSha256: "a".repeat(64),
    scenario: "default",
    screen: "profile",
  });
  expect(newMethod).toMatchObject({
    comparisonMode: "new-method-historical-diff-informational",
    archiveHashProof: "not-applicable-new-renderer-method",
    changedPixelsAllowed: true,
    changedPixelsObserved: true,
    controlledIterationEligible: true,
    pixelPerfectStatus: "not-asserted",
  });
  expect(() =>
    compareCurrentPngWithHistoricalHash({
      currentFixture: null,
      currentLocale: null,
      currentRendererMethodVersion: "layout-changing-unavailable-annotation-v1",
      expectedFixture:
        "apps/deskohub-workspace/scripts/account-visual/default-adapter.tsx",
      expectedLocale: "en-US",
      currentSha256: "b".repeat(64),
      firstSha256: "a".repeat(64),
      repeatSha256: "a".repeat(64),
      scenario: "default",
      screen: "profile",
    })
  ).toThrow(
    "default/profile current PNG does not match previously recorded historical PNG hash"
  );
});

test.serial.skipIf(!chromiumAvailable)(
  "controlled fixture header probe accepts readable English and Czech headings at mobile widths",
  async () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      for (const width of [320, 375] as const) {
        const heading =
          locale === "en-US" ? "My Workspace" : "Moje pracovni plocha";
        const probe = await withControlledPage(
          {
            html: controlledHeaderFixture(heading, {
              headingFontSize: 23,
              headingWidth: 142,
            }),
            locale,
            width,
          },
          (page) =>
            readInitialDomProbe(page, {
              deviceScaleFactor: 1,
              locale,
              mode: "mobile",
            })
        );

        expect(probe.capturedBeforeMutation).toBe(true);
        expect(probe.locale).toBe(locale);
        expect(probe.viewport.cssWidth).toBe(width);
        expect(probe.headerReadability.status).toBe("passed");
        expect(probe.headerReadability.minimumHeadingWidth).toBeGreaterThan(0);
        expect(probe.headerReadability.minimumHeadingWidth).toBeLessThanOrEqual(
          probe.headerReadability.headingWidth!
        );
        expect(probe.headerReadability.headingWidth).toBe(142);
        expect(probe.headerReadability.lineCount).toBeGreaterThan(0);
        expect(probe.headerReadability.computedStyle.fontSize).toBe("23px");
        expect(probe.headerReadability.computedStyle.lineHeight).toBe("28px");
        expect(probe.headerReadability.singleWordGlyphWrapping).toBe(false);
        expect(probe.failures).toEqual([]);

        const headingRect = probe.headerReadability.cssRect!;
        expect(
          probe.headerReadability.textRangeRects.every(
            (rect) =>
              rect.x >= headingRect.x - 1 &&
              rect.y >= headingRect.y - 1 &&
              rect.right <= headingRect.right + 1 &&
              rect.bottom <= headingRect.bottom + 1
          )
        ).toBe(true);
      }
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "controlled fixture sr-only label is excluded from visible text clipping",
  async () => {
    const probe = await withControlledPage(
      {
        html: controlledHeaderFixture("My Workspace", { srOnlyLabel: true }),
        locale: "en-US",
        width: 375,
      },
      (page) =>
        readInitialDomProbe(page, {
          deviceScaleFactor: 1,
          locale: "en-US",
          mode: "mobile",
        })
    );

    expect(probe.failures).toEqual([]);
    expect(
      probe.textRanges.main.some(({ text }) =>
        text.includes("Screen reader only label")
      )
    ).toBe(false);
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "controlled fixture header probe rejects a narrow single-word flex heading",
  async () => {
    for (const width of [320, 375] as const) {
      const probe = await withControlledPage(
        {
          html: controlledHeaderFixture("Workspace", { narrow: true }),
          locale: "en-US",
          width,
        },
        (page) =>
          readInitialDomProbe(page, {
            deviceScaleFactor: 1,
            locale: "en-US",
            mode: "mobile",
          })
      );

      expect(probe.headerReadability.status).toBe("failed");
      expect(probe.headerReadability.headingWidth).toBe(32);
      expect(probe.headerReadability.minimumHeadingWidth).toBeGreaterThan(0);
      expect(probe.headerReadability.minimumHeadingWidth).toBeGreaterThan(
        probe.headerReadability.headingWidth!
      );
      expect(probe.headerReadability.failures).toEqual(
        expect.arrayContaining([expect.stringContaining("below minimum")])
      );
      expect(probe.headerReadability.wrapped).toBe(true);
      expect(probe.headerReadability.singleWordGlyphWrapping).toBe(true);
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "controlled fixture header probe rejects nowrap text escaping a 160px heading",
  async () => {
    for (const width of [320, 375] as const) {
      const probe = await withControlledPage(
        {
          html: controlledHeaderFixture(
            "A deliberately long account heading that cannot fit",
            { overflowing: true }
          ),
          locale: "en-US",
          width,
        },
        (page) =>
          readInitialDomProbe(page, {
            deviceScaleFactor: 1,
            locale: "en-US",
            mode: "mobile",
          })
      );

      expect(probe.headerReadability.status).toBe("failed");
      expect(probe.headerReadability.headingWidth).toBe(160);
      expect(probe.headerReadability.minimumHeadingWidth).toBeGreaterThan(0);
      expect(probe.headerReadability.lineCount).toBe(1);
      expect(probe.headerReadability.cssRect?.right).toBeLessThanOrEqual(width);
      expect(probe.headerReadability.textRangeRects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ right: expect.any(Number) }),
        ])
      );
      expect(probe.headerReadability.failures).toEqual(
        expect.arrayContaining([
          expect.stringContaining("heading text range is outside h1 bounds"),
        ])
      );
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "controlled fixture unavailable annotation is layout-neutral at mobile widths",
  async () => {
    for (const width of [320, 375] as const) {
      await withControlledPage(
        {
          html: controlledHeaderFixture("My Workspace"),
          locale: "en-US",
          width,
        },
        async (page) => {
          const before = await page.evaluate(() => {
            const heading = document.querySelector("main header h1");
            const button =
              document.querySelector<HTMLButtonElement>("#account-sign-out");
            if (!heading || !button)
              throw new Error("controlled header is incomplete");
            const rect = (element: Element) => {
              const value = element.getBoundingClientRect();
              return {
                x: value.x,
                y: value.y,
                width: value.width,
                height: value.height,
                right: value.right,
                bottom: value.bottom,
              };
            };
            return {
              heading: rect(heading),
              button: rect(button),
              label: button.textContent,
              accessibleName: button.getAttribute("aria-label"),
            };
          });

          await page.evaluate(markUnavailableActions);

          const after = await page.evaluate(() => {
            const heading = document.querySelector("main header h1");
            const button =
              document.querySelector<HTMLButtonElement>("#account-sign-out");
            if (!heading || !button)
              throw new Error("controlled header is incomplete");
            const rect = (element: Element) => {
              const value = element.getBoundingClientRect();
              return {
                x: value.x,
                y: value.y,
                width: value.width,
                height: value.height,
                right: value.right,
                bottom: value.bottom,
              };
            };
            return {
              heading: rect(heading),
              button: rect(button),
              label: button.textContent,
              accessibleName: button.getAttribute("aria-label"),
              disabled: button.disabled,
              actionUnavailable:
                button.dataset.accountVisualActionUnavailable ?? null,
              unavailable: button.dataset.accountVisualUnavailable ?? null,
              ariaDisabled: button.getAttribute("aria-disabled"),
              title: button.title,
              ariaDescription: button.getAttribute("aria-description"),
              afterContent: getComputedStyle(button, "::after").content,
            };
          });

          expect(after.heading).toEqual(before.heading);
          expect(after.button).toEqual(before.button);
          expect(after.label).toBe(before.label);
          expect(after.accessibleName).toBe(before.accessibleName);
          expect(after.disabled).toBe(true);
          expect(after.actionUnavailable).toBe("true");
          expect(after.unavailable).toBe("true");
          expect(after.ariaDisabled).toBe("true");
          expect(after.title).toBe(unavailableActionDescription);
          expect(after.ariaDescription).toBe(unavailableActionDescription);
          expect(after.afterContent).toBe("none");
        }
      );
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "controlled fixture email probe accepts contained status at every captured viewport and locale",
  async () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      for (const width of [768, 375, 320] as const) {
        const probe = await withControlledPage(
          {
            html: controlledEmailFixture({
              statusText:
                locale === "cs-CZ"
                  ? "Ověřený přihlašovací e-mail"
                  : "Verified login email",
            }),
            locale,
            width,
          },
          (page) =>
            readSelectedEmailProbe(page, {
              deviceScaleFactor: 1,
              expectedSelectedProfile: true,
              locale,
              mode: width === 768 ? "desktop" : "mobile",
              requestedScreen: "profile",
              selectionStatus: "selected",
              selectedTargetVisible: true,
            })
        );

        expect(probe.emailContainment.status).toBe("passed");
        expect(probe.emailContainment.viewport).toEqual({
          cssWidth: width,
          cssHeight: 360,
        });
        expect(probe.emailContainment.email?.text).toBe("ada@example.test");
        expect(probe.emailContainment.statusText?.text).toBe(
          locale === "cs-CZ"
            ? "Ověřený přihlašovací e-mail"
            : "Verified login email"
        );
        expect(probe.emailContainment.email?.readable).toBe(true);
        expect(probe.emailContainment.statusText?.readable).toBe(true);
        expect(probe.emailContainment.failures).toEqual([]);
      }
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "controlled fixture email probe defers hidden profile coverage until profile selection",
  async () => {
    await withControlledPage(
      {
        html: controlledEmailFixture({
          includeSectionNavigation: true,
          statusText: "Ověřený přihlašovací e-mail",
        }),
        locale: "cs-CZ",
        width: 375,
      },
      async (page) => {
        const initial = await readInitialDomProbe(page, {
          deviceScaleFactor: 1,
          locale: "cs-CZ",
          mode: "mobile",
        });
        expect(initial.emailContainment.status).toBe("not-applicable");
        expect(initial.emailContainment.reason).toContain(
          "no profile DOM was measured"
        );

        const reservations = await readSelectedEmailProbe(page, {
          deviceScaleFactor: 1,
          expectedSelectedProfile: false,
          locale: "cs-CZ",
          mode: "mobile",
          requestedScreen: "reservations",
          selectionStatus: "selected",
          selectedTargetVisible: true,
        });
        expect(reservations.emailContainment.status).toBe("not-applicable");
        expect(reservations.emailContainment.reason).toContain(
          "hidden non-selected profile DOM was not measured"
        );

        await page
          .locator(
            "[data-account-mobile-navigation] button[data-account-section='profile']"
          )
          .click();
        const selectedTargetVisible = await page
          .locator("[data-slot='profile-screen']")
          .isVisible();
        const selected = await readSelectedEmailProbe(page, {
          deviceScaleFactor: 1,
          expectedSelectedProfile: true,
          locale: "cs-CZ",
          mode: "mobile",
          requestedScreen: "profile",
          selectionStatus: "selected",
          selectedTargetVisible,
        });

        expect(selected.capturedAfterSelection).toBe(true);
        expect(selected.emailContainment.status).toBe("passed");
        expect(selected.emailContainment.statusText?.text).toBe(
          "Ověřený přihlašovací e-mail"
        );
        expect(selected.failures).toEqual([]);
      }
    );
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "controlled fixture selected profile reports missing status while other sections stay not-applicable",
  async () => {
    await withControlledPage(
      {
        html: controlledEmailFixture({
          includeSectionNavigation: true,
          missingStatus: true,
        }),
        locale: "en-US",
        width: 375,
      },
      async (page) => {
        const otherSection = await readSelectedEmailProbe(page, {
          deviceScaleFactor: 1,
          expectedSelectedProfile: false,
          locale: "en-US",
          mode: "mobile",
          requestedScreen: "reservations",
          selectionStatus: "selected",
          selectedTargetVisible: true,
        });
        expect(otherSection.emailContainment.status).toBe("not-applicable");

        await page
          .locator(
            "[data-account-mobile-navigation] button[data-account-section='profile']"
          )
          .click();
        const selected = await readSelectedEmailProbe(page, {
          deviceScaleFactor: 1,
          expectedSelectedProfile: true,
          locale: "en-US",
          mode: "mobile",
          requestedScreen: "profile",
          selectionStatus: "selected",
          selectedTargetVisible: true,
        });
        expect(selected.emailContainment.status).toBe("failed");
        expect(selected.failures).toEqual([
          "selected profile email probe missing expected verified login-email status coverage",
        ]);
      }
    );
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "controlled fixture email probe accepts a long-page viewport-bottom crossing",
  async () => {
    await withControlledPage(
      {
        html: controlledEmailFixture({
          includeSectionNavigation: true,
          longPage: true,
        }),
        locale: "en-US",
        width: 375,
      },
      async (page) => {
        const initial = await readInitialDomProbe(page, {
          deviceScaleFactor: 1,
          locale: "en-US",
          mode: "mobile",
        });
        const longTextRange = initial.textRanges.main.find(({ text }) =>
          text.includes("Long page content")
        );
        expect(initial.failures).toEqual([]);
        expect(longTextRange?.withinViewportHorizontally).toBe(true);
        expect(longTextRange?.partiallyVisibleVertically).toBe(true);

        await page
          .locator(
            "[data-account-mobile-navigation] button[data-account-section='profile']"
          )
          .click();
        const selected = await readSelectedEmailProbe(page, {
          deviceScaleFactor: 1,
          expectedSelectedProfile: true,
          locale: "en-US",
          mode: "mobile",
          requestedScreen: "profile",
          selectionStatus: "selected",
          selectedTargetVisible: true,
        });

        expect(selected.emailContainment.status).toBe("passed");
        expect(selected.emailContainment.email?.withinField).toBe(true);
        expect(
          selected.emailContainment.email?.withinViewportHorizontally
        ).toBe(true);
        expect(
          selected.emailContainment.email?.partiallyVisibleVertically
        ).toBe(true);
        expect(selected.emailContainment.statusText?.readable).toBe(true);
        expect(selected.failures).toEqual([]);
      }
    );
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "controlled fixture email probe rejects clipped status without document overflow",
  async () => {
    const probe = await withControlledPage(
      {
        html: controlledEmailFixture({ overflowingStatus: true }),
        locale: "en-US",
        width: 320,
      },
      async (page) => {
        const result = await readSelectedEmailProbe(page, {
          deviceScaleFactor: 1,
          expectedSelectedProfile: true,
          locale: "en-US",
          mode: "mobile",
          requestedScreen: "profile",
          selectionStatus: "selected",
          selectedTargetVisible: true,
        });
        return {
          probe: result,
          documentScrollWidth: await page.evaluate(
            () => document.documentElement.scrollWidth
          ),
        };
      }
    );

    expect(probe.documentScrollWidth).toBeLessThanOrEqual(320);
    expect(probe.probe.emailContainment.status).toBe("failed");
    expect(probe.probe.emailContainment.statusText?.withinField).toBe(false);
    expect(probe.probe.emailContainment.statusText?.clippedByField).toBe(true);
    expect(probe.probe.emailContainment.statusText?.readable).toBe(false);
    expect(probe.probe.emailContainment.failures).toEqual(
      expect.arrayContaining([
        "login email status text range is clipped by its field or horizontally overflows the viewport",
      ])
    );
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "production profile email probe accepts the actual localized icon-button status at every captured viewport",
  async () => {
    for (const locale of ["en-US", "cs-CZ"] as const) {
      const copy = getAccountScreenCopy(locale).profile;
      for (const width of [1280, 375, 320] as const) {
        await withControlledPage(
          {
            html: productionProfileEmailHtml(locale),
            locale,
            width,
          },
          async (page) => {
            const actualButton = page.locator(
              productionProfileEmailStatusSelector
            );
            expect(await actualButton.count()).toBe(1);
            expect(
              await actualButton.evaluate((element) => element.tagName)
            ).toBe("BUTTON");
            const actualButtonRect = await readProductionProfileEmailProbeRect(
              page,
              productionProfileEmailStatusSelector
            );

            const probe = await readSelectedEmailProbe(page, {
              deviceScaleFactor: 1,
              expectedSelectedProfile: true,
              locale,
              mode: width === 1280 ? "desktop" : "mobile",
              requestedScreen: "profile",
              selectionStatus: "selected",
              selectedTargetVisible: true,
            });

            expect(probe.emailContainment.status).toBe("passed");
            expect(probe.emailContainment.email?.text).toBe(
              productionProfileEmail
            );
            const statusText = probe.emailContainment.statusText;
            expect(statusText).not.toBeNull();
            if (!statusText)
              throw new Error("production status evidence missing");
            expect(statusText.text).toBe(copy.emailVerification.verified);
            expect(statusText.selector).toBeTruthy();
            expect(
              await page
                .locator(statusText.selector)
                .evaluate((element) => element.tagName)
            ).toBe("BUTTON");
            expect(statusText.rects).toEqual([actualButtonRect]);
            expect(statusText.withinField).toBe(true);
            expect(statusText.withinViewportHorizontally).toBe(true);
            expect(statusText.readable).toBe(true);
            expect(probe.emailContainment.failures).toEqual([]);
          }
        );
      }
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "production profile email probe rejects an icon button clipped by its field without document overflow",
  async () => {
    const result = await withControlledPage(
      {
        html: productionProfileEmailHtml("en-US"),
        locale: "en-US",
        width: 320,
      },
      async (page) => {
        await page
          .locator(productionProfileEmailFieldSelector)
          .evaluate((field) => {
            const button = field.querySelector<HTMLButtonElement>("button");
            if (!(field instanceof HTMLElement) || !button) {
              throw new Error(
                "production email field is missing its status button"
              );
            }
            field.style.overflow = "hidden";
            field.style.position = "relative";
            button.style.position = "absolute";
            button.style.left = "calc(100% - 24px)";
            button.style.top = "4px";
          });
        return {
          bodyScrollWidth: await page.evaluate(() => document.body.scrollWidth),
          documentScrollWidth: await page.evaluate(
            () => document.documentElement.scrollWidth
          ),
          probe: await readSelectedEmailProbe(page, {
            deviceScaleFactor: 1,
            expectedSelectedProfile: true,
            locale: "en-US",
            mode: "mobile",
            requestedScreen: "profile",
            selectionStatus: "selected",
            selectedTargetVisible: true,
          }),
        };
      }
    );

    expect(result.documentScrollWidth).toBeLessThanOrEqual(320);
    expect(result.bodyScrollWidth).toBeLessThanOrEqual(320);
    expect(result.probe.emailContainment.status).toBe("failed");
    const statusText = result.probe.emailContainment.statusText;
    expect(statusText).not.toBeNull();
    if (!statusText) throw new Error("production status evidence missing");
    expect(statusText.withinField).toBe(false);
    expect(statusText.withinViewportHorizontally).toBe(true);
    expect(statusText.clippedByField).toBe(true);
    expect(statusText.readable).toBe(false);
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "production profile email probe rejects a wrong or unverified icon aria-label despite the retained pre-email verified badge",
  async () => {
    const locale = "en-US" as const;
    const copy = getAccountScreenCopy(locale).profile;
    await withControlledPage(
      {
        html: productionProfileEmailHtml(locale),
        locale,
        width: 375,
      },
      async (page) => {
        expect(
          await page.getByText(copy.verifiedEmail, { exact: true }).count()
        ).toBe(1);

        for (const ariaLabel of [
          copy.emailVerification.unverified,
          "Wrong email status",
        ]) {
          await page
            .locator(productionProfileEmailStatusSelector)
            .evaluate((button, label: string) => {
              button.setAttribute("aria-label", label);
            }, ariaLabel);
          const probe = await readSelectedEmailProbe(page, {
            deviceScaleFactor: 1,
            expectedSelectedProfile: true,
            locale,
            mode: "mobile",
            requestedScreen: "profile",
            selectionStatus: "selected",
            selectedTargetVisible: true,
          });

          expect(probe.emailContainment.status).toBe("failed");
          expect(probe.emailContainment.statusText).toBeNull();
          expect(probe.failures).toEqual([
            "selected profile email probe missing expected verified login-email status coverage",
          ]);
        }
      }
    );
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "production profile email probe rejects a verified button moved into a later profile section",
  async () => {
    const locale = "cs-CZ" as const;
    await withControlledPage(
      {
        html: productionProfileEmailHtml(locale),
        locale,
        width: 375,
      },
      async (page) => {
        await page.evaluate(() => {
          const profile = document.querySelector<HTMLElement>(
            "[data-slot='profile-screen']"
          );
          const field = profile?.querySelector<HTMLElement>(
            "fieldset[aria-labelledby$='-email-label'] > div"
          );
          const button = field?.querySelector<HTMLButtonElement>("button");
          const laterProfileSection = profile?.querySelector<HTMLElement>(
            ":scope > div:nth-of-type(3)"
          );
          if (!field || !button || !laterProfileSection) {
            throw new Error("production profile sections are incomplete");
          }
          laterProfileSection.append(button);
        });

        expect(
          await page
            .locator(productionProfileEmailFieldSelector)
            .locator("button")
            .count()
        ).toBe(0);
        expect(
          await page
            .getByText(getAccountScreenCopy(locale).profile.verifiedEmail, {
              exact: true,
            })
            .count()
        ).toBe(1);

        const probe = await readSelectedEmailProbe(page, {
          deviceScaleFactor: 1,
          expectedSelectedProfile: true,
          locale,
          mode: "mobile",
          requestedScreen: "profile",
          selectionStatus: "selected",
          selectedTargetVisible: true,
        });

        expect(probe.emailContainment.status).toBe("failed");
        expect(probe.emailContainment.statusText).toBeNull();
        expect(probe.failures).toEqual([
          "selected profile email probe missing expected verified login-email status coverage",
        ]);
      }
    );
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "production profile email probe reports hidden icon status as unreadable and failed",
  async () => {
    await withControlledPage(
      {
        html: productionProfileEmailHtml("en-US"),
        locale: "en-US",
        width: 320,
      },
      async (page) => {
        await page
          .locator(productionProfileEmailStatusSelector)
          .evaluate((button) => {
            button.style.display = "none";
          });
        const probe = await readSelectedEmailProbe(page, {
          deviceScaleFactor: 1,
          expectedSelectedProfile: true,
          locale: "en-US",
          mode: "mobile",
          requestedScreen: "profile",
          selectionStatus: "selected",
          selectedTargetVisible: true,
        });

        expect(probe.emailContainment.status).toBe("failed");
        expect(probe.emailContainment.statusText?.readable).toBe(false);
      }
    );
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "default adapter selects a production screen and reports its target",
  async () => {
    await mkdir(outputRoot, { recursive: true });
    const directory = await mkdtemp(`${outputRoot}/account-visual-selection-`);
    try {
      const referencesDir = join(directory, "references");
      await writeRegressionReference(referencesDir);
      const report = await runRendererCli([
        "--label",
        "production-screen-selection",
        "--screen",
        "billing",
        "--references",
        referencesDir,
        "--output",
        join(directory, "output"),
      ]);
      expect(report.execution.status).toBe("passed");
      expect(
        (await Bun.file(join(report.outputDirectory, "execution.json")).json())
          .findings
      ).toEqual([]);
      expect(report.screens.map(({ screen }) => screen)).toEqual(["billing"]);
      expect(report.screens[0]?.coverage).toMatchObject({
        source: "production-account-shell",
        selection: "selected",
      });
      expect(report.screens[0]?.desktop.selection).toMatchObject({
        status: "selected",
        targetVisible: true,
        targetSelector: "#account-profile-billing-kind",
      });
      expect(report.screens[0]?.desktop.selection.targetText).toBeTruthy();
      expect(report.screens[0]?.mobile["375"].focusSelection).toMatchObject({
        requestedScreen: "billing",
        status: "selected",
        targetVisible: true,
        targetSelector: "#account-profile-billing-kind",
      });
      expect(report.comparison).toMatchObject({
        referenceLocale: "en-US",
        captureLocale: "en-US",
        copyMismatch: false,
        controlledComparability: false,
        controlledComparabilityCaveat:
          "historical baseline is not controlled: prior renderer annotation changed layout",
      });
      expect(
        report.screens.flatMap(({ mobile }) =>
          Object.values(mobile).map(
            ({ sectionNavigation, draftPersistence }) => [
              sectionNavigation.status,
              draftPersistence.status,
            ]
          )
        )
      ).toEqual([
        ["passed", "passed"],
        ["passed", "passed"],
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "populated adapter proves native validation reroutes by the first invalid section",
  async () => {
    await mkdir(outputRoot, { recursive: true });
    const directory = await mkdtemp(
      `${outputRoot}/account-visual-native-validation-`
    );
    try {
      const referencesDir = join(directory, "references");
      await writeRegressionReference(referencesDir);
      const report = await runRendererCli([
        "--label",
        "native-validation-regression",
        "--screen",
        "profile",
        "--adapter",
        join(import.meta.dir, "populated-adapter.tsx"),
        "--references",
        referencesDir,
        "--output",
        join(directory, "output"),
      ]);
      const nativeValidation = report.nativeValidation;
      const firstSubmission = nativeValidation.firstSubmission!;
      const secondSubmission = nativeValidation.secondSubmission!;

      expect(report.execution.status).toBe("passed");
      expect(
        (await Bun.file(join(report.outputDirectory, "execution.json")).json())
          .findings
      ).toEqual([]);
      expect(nativeValidation).toMatchObject({
        status: "passed",
        method: "fresh-browser-context-native-request-submit",
        context: "fresh-context-after-original-capture",
        initialScreenshotsUntouched: true,
        prohibitedOperations: {
          dispatchedInvalidEvent: false,
          unhiddenDom: false,
          enabledBackendActionControls: false,
        },
      });
      expect(nativeValidation.navigation).toMatchObject({
        initialProfile: { status: "selected", targetVisible: true },
        billing: { status: "selected", targetVisible: true },
        backToProfile: { status: "selected", targetVisible: true },
      });
      expect(firstSubmission).toMatchObject({
        method: "HTMLFormElement.requestSubmit() via page.evaluate",
        blockedByNativeValidation: true,
        invalidEventSource: "requestSubmit",
        formValidityValid: false,
        visiblePanels: {
          profile: true,
          billing: false,
        },
        firstName: {
          mounted: true,
          visible: true,
          value: "",
          validityValid: false,
        },
        companyName: {
          mounted: true,
          visible: false,
          value: "",
          validityValid: false,
        },
      });
      expect(
        Object.keys(firstSubmission).filter((key) =>
          key.endsWith("InvalidEvents")
        )
      ).toEqual(["requestSubmitInvalidEvents"]);
      expect(
        firstSubmission.requestSubmitInvalidEvents.map(
          ({ targetId }) => targetId
        )
      ).toEqual([
        "account-profile-first-name",
        "account-profile-billing-company-name",
      ]);
      expect(
        firstSubmission.eligibleControlValidity
          .filter(({ id }) =>
            [
              "account-profile-first-name",
              "account-profile-billing-company-name",
            ].includes(id)
          )
          .map(({ id, validityValid }) => ({ id, validityValid }))
      ).toEqual([
        { id: "account-profile-first-name", validityValid: false },
        { id: "account-profile-billing-company-name", validityValid: false },
      ]);
      expect(secondSubmission).toMatchObject({
        method: "HTMLFormElement.requestSubmit() via page.evaluate",
        blockedByNativeValidation: true,
        invalidEventSource: "requestSubmit",
        formValidityValid: false,
        visiblePanels: {
          profile: false,
          billing: true,
        },
        firstName: {
          mounted: true,
          visible: false,
          value: "Ada",
          validityValid: true,
        },
        companyName: {
          mounted: true,
          visible: true,
          value: "",
          validityValid: false,
        },
        identityControlsValid: true,
      });
      expect(
        secondSubmission.requestSubmitInvalidEvents.map(
          ({ targetId }) => targetId
        )
      ).toEqual(["account-profile-billing-company-name"]);
      expect(
        Object.keys(secondSubmission).filter((key) =>
          key.endsWith("InvalidEvents")
        )
      ).toEqual(["requestSubmitInvalidEvents"]);
      expect(
        secondSubmission.eligibleControlValidity
          .filter(({ id }) => id === "account-profile-billing-company-name")
          .map(({ id, validityValid }) => ({ id, validityValid }))
      ).toEqual([
        { id: "account-profile-billing-company-name", validityValid: false },
      ]);
      expect(nativeValidation.draftsAfterSecondSubmission).toMatchObject({
        firstName: "Ada",
        phone: "+420 777 000 111",
        preserved: true,
        billing: {
          companyName: "",
          companyId: "98765432",
          vatId: "CZ98765432",
          addressLine1: "Synthetic Street 42",
          addressLine2: "Suite 5",
          city: "Prague",
          zip: "110 00",
          country: "CZ",
        },
      });
      expect(nativeValidation.actionInvocationCount).toEqual({
        initial: 0,
        beforeFirstSubmission: 0,
        afterFirstSubmission: 0,
        beforeSecondSubmission: 0,
        afterSecondSubmission: 0,
      });
      expect(nativeValidation.pageErrors).toEqual([]);
      expect(nativeValidation.backendActionControls).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "account-profile-submit",
            present: true,
            disabled: true,
          }),
        ])
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "external adapter metadata and pre-navigation overflow are reported",
  async () => {
    await mkdir(outputRoot, { recursive: true });
    const directory = await mkdtemp(`${outputRoot}/account-visual-regression-`);
    const adapterDirectory = await mkdtemp(
      join(outputRoot, "account-visual-adapter-")
    );
    try {
      const referencesDir = join(directory, "references");
      const output = join(directory, "output");
      await writeRegressionReference(referencesDir);
      const adapterPath = await writeRegressionAdapter(adapterDirectory);
      const report = await runRendererCli([
        "--label",
        "external-adapter-regression",
        "--screen",
        "profile",
        "--adapter",
        adapterPath,
        "--references",
        referencesDir,
        "--output",
        output,
      ]);
      const screen = report.screens[0]!;
      const actualAccountPagePath = join(
        import.meta.dir,
        "../../features/account/components/account-page.tsx"
      );
      const actualGlobalsCssPath = join(
        import.meta.dir,
        "../../app/globals.css"
      );
      const [actualAccountPageBytes, actualGlobalsCssBytes] = await Promise.all(
        [readFile(actualAccountPagePath), readFile(actualGlobalsCssPath)]
      );
      const mobile = screen.mobile["375"];
      const manifestPath = join(report.outputDirectory, "source-manifest.json");
      const manifestBytes = await Bun.file(manifestPath).bytes();
      const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
      const manifestSha256 = createHash("sha256")
        .update(manifestBytes)
        .digest("hex");

      expect(report.fixture).toBeNull();
      expect(report.environment.viewport).toMatchObject({
        desktopCssWidth: 1280,
        desktopPhysicalWidth: 2560,
        desktopDeviceScaleFactor: 2,
      });
      expect(report.environment.server).toEqual({
        port: expectedRendererPort,
        ownership: "single renderer process",
        concurrency: "sequential screens and runs only",
        occupiedPort: "fail without stopping another process",
      });
      expect(report.comparison.standardDesktopCapture).toMatchObject({
        cssWidth: 1280,
        physicalWidth: 2560,
        deviceScaleFactor: 2,
        interpretation: "chosen",
      });
      expect(report.comparison).toMatchObject({
        referenceLocale: "en-US",
        captureLocale: "en-US",
        copyMismatch: false,
        controlledComparability: false,
        controlledComparabilityCaveat:
          "historical baseline is not controlled: fixture differs from the default baseline and renderer annotation layout changed",
      });
      expect(report.comparison.regionGeometry).toMatchObject({
        coordinateSpace: "reference-physical-pixels",
        interpretation: "chosen",
        sidebarBoundary: 689,
        headerBoundary: 241,
      });
      expect(report.renderer.isolatedCss).toEqual({
        path: "apps/deskohub-workspace/scripts/account-visual/renderer.css",
        variable: "--site-header-height",
        value: "0px",
        purpose:
          "Main-only references exclude the site header; runtime styles are not modified.",
      });
      expect(report.renderer.actualSourceSnapshot).toEqual({
        capturedFrom: "current worktree at renderer invocation",
        accountPage: {
          path: "apps/deskohub-workspace/features/account/components/account-page.tsx",
          sha256: createHash("sha256")
            .update(actualAccountPageBytes)
            .digest("hex"),
          bytes: actualAccountPageBytes.byteLength,
        },
        globalsCss: {
          path: "apps/deskohub-workspace/app/globals.css",
          sha256: createHash("sha256")
            .update(actualGlobalsCssBytes)
            .digest("hex"),
          bytes: actualGlobalsCssBytes.byteLength,
        },
      });
      expect(screen.desktop.viewport).toEqual({
        cssWidth: 1280,
        cssHeight: 800,
        physicalWidth: 2560,
        physicalHeight: 1600,
        deviceScaleFactor: 2,
      });
      expect(screen.desktop.mainCssDimensions.width).toBeGreaterThan(1280);
      expect(screen.desktop.mainPhysicalDimensions.width).toBeGreaterThan(2560);
      expect(screen.desktop.comparison).toMatchObject({
        coordinateSpace: "reference-physical-pixels",
        referencePhysicalPixels: { width: 2560, height: 1600 },
        actualCssPixels: screen.desktop.mainCssDimensions,
        actualPhysicalPixels: screen.desktop.mainPhysicalDimensions,
      });
      expect(report.renderer.adapterMetadata).toEqual({
        owner: "temporary overflow adapter",
        fixture: "temporary linked source and legal destination",
      });
      expect(screen.coverage).toMatchObject({
        status: "adapter-defined",
        source: "adapter-defined",
        selection: "adapter-defined",
      });
      expect(mobile.focus.capture).toBe("same-page-native");
      expect(mobile.focus.reportedTarget).toEqual(mobile.focus.activeElement);
      expect(mobile.focus.matchesReportedTarget).toBe(true);
      expect(mobile.focusSelection).toMatchObject({
        requestedScreen: "profile",
        status: "adapter-defined",
      });
      expect(mobile.horizontalOverflow.offenders).toEqual(
        expect.arrayContaining([expect.objectContaining({ tag: "main" })])
      );
      expect(mobile.functional.navigation).toMatchObject({
        status: "passed",
        method: "anchor",
      });
      expect(mobile.functional.navigation.detail).toContain("screen=legal");
      expect(mobile.functional.failures).toEqual([]);
      expect(
        manifest.ownedSources.map(({ path }: { path: string }) => path)
      ).toEqual(expectedOwnedSourcePaths);
      expect(
        manifest.ownedSources.every(({ sha256 }: { sha256: string }) =>
          /^[a-f0-9]{64}$/.test(sha256)
        )
      ).toBe(true);
      expect(report.renderer.ownedSources).toEqual(manifest.ownedSources);
      expect(report.renderer.buildManifest).toEqual({
        path: "source-manifest.json",
        sha256: manifestSha256,
        bytes: manifestBytes.byteLength,
      });
      const execution = await Bun.file(
        join(report.outputDirectory, "execution.json")
      ).json();
      expect(execution.sourceManifest).toEqual(report.renderer.buildManifest);
      expect(execution.sourceFiles).toEqual(manifest.ownedSources);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(adapterDirectory, { recursive: true, force: true });
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "stores actual computed styles from a styled temporary fixture",
  async () => {
    await mkdir(outputRoot, { recursive: true });
    const directory = await mkdtemp(
      `${outputRoot}/account-visual-computed-styles-`
    );
    const adapterDirectory = await mkdtemp(
      join(outputRoot, "account-visual-computed-styles-adapter-")
    );
    try {
      const referencesDir = join(directory, "references");
      await writeRegressionReference(referencesDir);
      const adapterPath = await writeComputedStyleAdapter(adapterDirectory);
      const report = await runRendererCli([
        "--label",
        "computed-styles",
        "--screen",
        "reservations",
        "--adapter",
        adapterPath,
        "--references",
        referencesDir,
        "--output",
        join(directory, "output"),
      ]);
      const screen = report.screens[0]!;
      const desktop = screen.desktop.computedStyles;
      const mobile = screen.mobile["375"].computedStyles;

      expect(report.execution.status).toBe("passed");
      expect(desktop.capturedBeforeMutation).toBe(true);
      expect(mobile.capturedBeforeMutation).toBe(true);
      expect(desktop.mainBackground).toEqual({
        backgroundColor: "rgb(16, 32, 48)",
        backgroundImage: "linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))",
      });
      expect(desktop.main?.computedStyle).toMatchObject({
        backgroundColor: "rgb(16, 32, 48)",
        backgroundImage: "linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))",
      });
      expect(
        desktop.headings.map(({ tag, computedStyle }) => ({
          tag,
          fontWeight: computedStyle.fontWeight,
          fontSize: computedStyle.fontSize,
          fontFamily: computedStyle.fontFamily,
          lineHeight: computedStyle.lineHeight,
        }))
      ).toEqual([
        {
          tag: "h1",
          fontWeight: "700",
          fontSize: "32px",
          fontFamily: "Arial",
          lineHeight: "40px",
        },
        {
          tag: "h2",
          fontWeight: "700",
          fontSize: "32px",
          fontFamily: "Arial",
          lineHeight: "40px",
        },
        {
          tag: "h2",
          fontWeight: "700",
          fontSize: "32px",
          fontFamily: "Arial",
          lineHeight: "40px",
        },
      ]);
      expect(desktop.desktopNavigation.selectedButtonStyles).toEqual({
        color: "rgb(254, 254, 254)",
        backgroundColor: "rgb(32, 48, 64)",
        borderRadius: "12px",
      });
      expect(desktop.desktopNavigation.selectedButton).toMatchObject({
        tag: "button",
        text: "Reservations2",
        dataSlot: null,
      });
      expect(desktop.desktopNavigation.sidebar).toMatchObject({
        tag: "aside",
        dataSlot: "account-sidebar",
        computedStyle: {
          backgroundColor: "rgb(64, 80, 96)",
          borderRadius: "8px",
        },
      });
      expect(
        desktop.desktopNavigation.selectedButton?.boundingRect.physical
      ).toMatchObject({ coordinateSpace: "physical-pixels" });
      expect(
        desktop.desktopNavigation.selectedButton?.boundingRect.deviceScaleFactor
      ).toBe(2);
      expect(
        desktop.desktopNavigation.sidebar?.boundingRect.deviceScaleFactor
      ).toBe(2);
      expect(mobile.desktopNavigation.selectedButton).toBeNull();
      expect(mobile.mainBackground).toEqual(desktop.mainBackground);
      expect(mobile.main?.boundingRect.deviceScaleFactor).toBe(1);

      expect(desktop.pastTable?.label).toBe("Past reservations (2)");
      expect(desktop.pastTable?.table).toMatchObject({
        tag: "table",
        dataSlot: null,
      });
      expect(
        desktop.pastTable?.headers.map(({ text, computedStyle }) => ({
          text,
          display: computedStyle.display,
        }))
      ).toEqual([
        { text: "Date", display: "table-cell" },
        { text: "Product", display: "table-cell" },
      ]);
      expect(
        desktop.pastTable?.rows.map(({ row, labels }) => ({
          rowText: row.text,
          rowDisplay: row.computedStyle.display,
          labels: labels.map(({ text, computedStyle }) => ({
            text,
            display: computedStyle.display,
          })),
        }))
      ).toEqual([
        {
          rowText: "2026-10-01Office",
          rowDisplay: "table-row",
          labels: [
            { text: "2026-10-01", display: "table-cell" },
            { text: "Office", display: "table-cell" },
          ],
        },
        {
          rowText: "2026-09-01Cowork",
          rowDisplay: "table-row",
          labels: [
            { text: "2026-09-01", display: "table-cell" },
            { text: "Cowork", display: "table-cell" },
          ],
        },
      ]);
      expect(desktop.pastTable?.duplicateRowLabels).toEqual([]);
      expect(mobile.pastTable?.duplicateRowLabels).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(adapterDirectory, { recursive: true, force: true });
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "missing legal target fails even when the production-shaped sidebar exists",
  async () => {
    await mkdir(outputRoot, { recursive: true });
    const directory = await mkdtemp(
      `${outputRoot}/account-visual-missing-legal-`
    );
    const adapterDirectory = await mkdtemp(
      join(outputRoot, "account-visual-missing-legal-adapter-")
    );
    try {
      const referencesDir = join(directory, "references");
      await writeRegressionReference(referencesDir);
      const adapterPath = await writeMissingLegalAdapter(adapterDirectory);
      const report = await runRendererCli([
        "--label",
        "missing-legal-target",
        "--screen",
        "legal",
        "--adapter",
        adapterPath,
        "--references",
        referencesDir,
        "--output",
        join(directory, "output"),
      ]);
      const screen = report.screens[0]!;

      expect(screen.coverage).toMatchObject({
        status: "selection-failed",
        selection: "failed",
      });
      expect(screen.desktop.selection).toMatchObject({
        requestedScreen: "legal",
        status: "failed",
        targetSelector: "a[href$='/privacy-policy']",
        targetVisible: false,
      });
      expect(report.execution.status).toBe("completed-with-findings");
      const execution = await Bun.file(
        join(report.outputDirectory, "execution.json")
      ).json();
      expect(execution.findings).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "legal desktop: Production desktop selection did not expose"
          ),
        ])
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(adapterDirectory, { recursive: true, force: true });
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "dialog checkbox cannot satisfy cancellation when the footer cancel does not close",
  async () => {
    await mkdir(outputRoot, { recursive: true });
    const directory = await mkdtemp(`${outputRoot}/account-visual-cancel-`);
    const adapterDirectory = await mkdtemp(
      join(outputRoot, "account-visual-cancel-adapter-")
    );
    try {
      const referencesDir = join(directory, "references");
      await writeRegressionReference(referencesDir);
      const adapterPath = await writeNonWorkingCancelAdapter(adapterDirectory);
      const report = await runRendererCli([
        "--label",
        "non-working-cancel",
        "--screen",
        "danger",
        "--adapter",
        adapterPath,
        "--references",
        referencesDir,
        "--output",
        join(directory, "output"),
      ]);
      const screen = report.screens[0]!;

      expect(report.execution.status).toBe("completed-with-findings");
      expect(
        screen.mobile["375"].functional.deletionConfirmation
      ).toMatchObject({
        status: "failed",
        opened: true,
        finalActionDisabled: true,
        cancelled: false,
      });
      expect(screen.mobile["375"].functional.failures).toEqual(
        expect.arrayContaining([
          "deletion confirmation cancel control did not close the dialog",
        ])
      );
      const execution = await Bun.file(
        join(report.outputDirectory, "execution.json")
      ).json();
      expect(execution.findings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("cancel control did not close the dialog"),
        ])
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(adapterDirectory, { recursive: true, force: true });
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "captures initial mobile overflow before a roundtrip removes it",
  async () => {
    await mkdir(outputRoot, { recursive: true });
    const directory = await mkdtemp(`${outputRoot}/account-visual-roundtrip-`);
    const adapterDirectory = await mkdtemp(
      join(outputRoot, "account-visual-roundtrip-adapter-")
    );
    try {
      const referencesDir = join(directory, "references");
      await writeRegressionReference(referencesDir);
      const adapterPath = await writeRoundtripOverflowAdapter(adapterDirectory);
      const report = await runRendererCli([
        "--label",
        "roundtrip-overflow",
        "--screen",
        "profile",
        "--adapter",
        adapterPath,
        "--references",
        referencesDir,
        "--output",
        join(directory, "output"),
      ]);
      const screen = report.screens[0]!;
      const mobile = screen.mobile["375"];
      const execution = await Bun.file(
        join(report.outputDirectory, "execution.json")
      ).json();

      expect(report.execution.status).toBe("completed-with-findings");
      expect(mobile.selection).toMatchObject({
        status: "selected",
        method: "mobile-nav-button",
      });
      expect(mobile.sectionNavigation.status).toBe("passed");
      expect(mobile.horizontalOverflow.offenders).toEqual(
        expect.arrayContaining([expect.objectContaining({ tag: "main" })])
      );
      expect(execution.findings).toEqual(
        expect.arrayContaining([
          "profile mobile 375: 2 horizontal overflow offender(s)",
        ])
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(adapterDirectory, { recursive: true, force: true });
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "only visible auto or scroll mobile navigation may clip inactive sections",
  async () => {
    for (const overflowX of ["auto", "scroll", "hidden", "clip"] as const) {
      const directory = await mkdtemp(
        `${outputRoot}/account-visual-navigation-overflow-${overflowX}-`
      );
      const adapterDirectory = await mkdtemp(
        join(
          outputRoot,
          `account-visual-navigation-overflow-${overflowX}-adapter-`
        )
      );
      try {
        const referencesDir = join(directory, "references");
        await writeRegressionReference(referencesDir);
        const adapterPath = await writeNavigationOverflowAdapter(
          adapterDirectory,
          overflowX
        );
        const report = await runRendererCli([
          "--label",
          `navigation-overflow-${overflowX}`,
          "--screen",
          "profile",
          "--adapter",
          adapterPath,
          "--references",
          referencesDir,
          "--output",
          join(directory, "output"),
        ]);
        const screen = report.screens[0]!;
        const mobile = screen.mobile["375"];
        const execution = await Bun.file(
          join(report.outputDirectory, "execution.json")
        ).json();
        const navigationOverflow = mobile.horizontalOverflow.offenders.find(
          ({ id }) => id === "navigation-overflow-nav"
        );

        expect(mobile.selection.status).toBe("selected");
        expect(mobile.selection.selectedAriaCurrent).toBe("page");
        expect(mobile.sectionNavigation.status).toBe("passed");
        if (overflowX === "auto" || overflowX === "scroll") {
          expect(report.execution.status).toBe("passed");
          expect(mobile.initialDomProbe.failures).toEqual([]);
          expect(mobile.horizontalOverflow.offenders).toEqual([]);
          expect(execution.findings).toEqual([]);
        } else {
          expect(report.execution.status).toBe("completed-with-findings");
          expect(mobile.initialDomProbe.failures).toEqual(
            expect.arrayContaining([
              expect.stringContaining(
                "text range horizontally overflows the viewport"
              ),
            ])
          );
          expect(navigationOverflow).toMatchObject({ overflowX });
          expect(execution.findings).toEqual(
            expect.arrayContaining([
              expect.stringContaining("initial DOM probe"),
              expect.stringContaining("horizontal overflow offender"),
            ])
          );
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
        await rm(adapterDirectory, { recursive: true, force: true });
      }
    }
  },
  240_000
);

test.serial.skipIf(!chromiumAvailable)(
  "active mobile navigation section must remain fully visible",
  async () => {
    const directory = await mkdtemp(
      `${outputRoot}/account-visual-navigation-active-clipped-`
    );
    const adapterDirectory = await mkdtemp(
      join(outputRoot, "account-visual-navigation-active-clipped-adapter-")
    );
    try {
      const referencesDir = join(directory, "references");
      await writeRegressionReference(referencesDir);
      const adapterPath = await writeNavigationOverflowAdapter(
        adapterDirectory,
        "auto",
        true
      );
      const report = await runRendererCli([
        "--label",
        "navigation-active-clipped",
        "--screen",
        "profile",
        "--adapter",
        adapterPath,
        "--references",
        referencesDir,
        "--output",
        join(directory, "output"),
      ]);
      const screen = report.screens[0]!;
      const mobile = screen.mobile["375"];

      expect(report.execution.status).toBe("completed-with-findings");
      expect(mobile.selection.status).toBe("failed");
      expect(mobile.selection.detail).toContain(
        "a fully visible active button"
      );
      expect(mobile.sectionNavigation.status).toBe("failed");
      expect(mobile.horizontalOverflow.offenders).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "navigation-overflow-nav" }),
        ])
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(adapterDirectory, { recursive: true, force: true });
    }
  },
  120_000
);

test.serial.skipIf(!chromiumAvailable)(
  "fails on document overflow from a viewport-width nowrap block",
  async () => {
    await mkdir(outputRoot, { recursive: true });
    const directory = await mkdtemp(
      `${outputRoot}/account-visual-viewport-overflow-`
    );
    const adapterDirectory = await mkdtemp(
      join(outputRoot, "account-visual-viewport-overflow-adapter-")
    );
    try {
      const referencesDir = join(directory, "references");
      await writeRegressionReference(referencesDir);
      const adapterPath =
        await writeViewportWidthOverflowAdapter(adapterDirectory);
      const report = await runRendererCli([
        "--label",
        "viewport-width-overflow",
        "--screen",
        "profile",
        "--adapter",
        adapterPath,
        "--references",
        referencesDir,
        "--output",
        join(directory, "output"),
      ]);
      const screen = report.screens[0]!;
      const mobile = screen.mobile["375"];
      const execution = await Bun.file(
        join(report.outputDirectory, "execution.json")
      ).json();

      expect(mobile.horizontalOverflow.documentScrollWidth).toBeGreaterThan(
        mobile.horizontalOverflow.viewportWidth
      );
      expect(mobile.horizontalOverflow.bodyScrollWidth).toBeGreaterThan(
        mobile.horizontalOverflow.viewportWidth
      );
      expect(report.execution.status).toBe("completed-with-findings");
      expect(execution.findings).toEqual(
        expect.arrayContaining([
          expect.stringContaining("document scrollWidth"),
          expect.stringContaining("body scrollWidth"),
        ])
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(adapterDirectory, { recursive: true, force: true });
    }
  },
  120_000
);

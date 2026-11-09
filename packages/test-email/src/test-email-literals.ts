/**
 * Finds hand-written email addresses in test code across apps/, packages/,
 * and scripts/, except Boardgame Bar. Tests build addresses with
 * `testEmailAddress` (on the EMAIL_TEST_DOMAIN constant, so mail routes to
 * Console) or `resendSimulatorAddress` from `@deskohub/test-email`; a
 * hand-written address could reach a real inbox.
 *
 * It reads string, template, and JSX literals, folds `+` chains of literals
 * (parentheses included), decodes `\x40`, `\u0040`, `\u{40}` (through the
 * cooked literal value), `%40`, `&#64;`, `&#x40;`, and `&commat;`, and checks
 * every address-shaped token on its own, Unicode domains included. Trailing
 * sentence punctuation ends an address.
 *
 * Not addresses: URL authority credentials (`scheme://user:pass@host`), git
 * SCP remotes (`git@github.com:org/repo.git`), asset names such as
 * `icon@2x.png`, `@` mentions and scoped packages (no dotted domain), and a
 * bare `@host` followed by a path or port. It is a guardrail, not a security
 * boundary: it does not evaluate `[...].join("@")`, `String.fromCharCode`,
 * or other computed values.
 */
import { resolve } from "node:path";
import ts from "typescript";

export type TestEmailLiteral = {
  readonly line: number;
  readonly column: number;
  readonly address: string;
};

export type RepositoryTestEmailLiteral = TestEmailLiteral & {
  readonly path: string;
};

/**
 * Where and what the check scans. It reads files across the repository, so
 * its test is a `*.repository-wide.test.ts` that Workspace CI runs uncached on
 * every pull request instead of a cached package task.
 */
const scannedRoots = ["apps", "packages", "scripts"] as const;
/** Boardgame Bar keeps its own email setup and stays outside this check. */
const excludedRoots = ["apps/deskohub-boardgame-bar"] as const;
const scannedExtensions = ["ts", "tsx", "js", "jsx", "mjs", "cjs"] as const;

const moduleExtension = `\\.(?:${scannedExtensions.join("|")})$`;

const testPathPatterns = [
  new RegExp(
    `\\.(?:test|test-utils|test-fixture|pw|mock|spec)${moduleExtension}`
  ),
  new RegExp(
    `/(?:e2e|testing|__tests__|__fixtures__|_fixtures|fixtures|\\(testing-only\\))/.*${moduleExtension}`
  ),
  new RegExp(`(?:-fixture|/fixtures?)${moduleExtension}`),
  /apps\/deskohub-workspace\/scripts\/(?:account-visual|account-sticky)\/.*\.(?:ts|tsx)$/,
  /apps\/deskohub-workspace\/scripts\/posthog-identity-browser\.ts$/,
];

/** Test, fixture, E2E, and visual-script modules the rule covers. */
export const isTestEmailLiteralPath = (path: string) =>
  testPathPatterns.some((pattern) => pattern.test(path));

const encodedAt = /%40|&#0*64;|&#x0*40;|&commat;/gi;

// A local part, `@`, and a dotted domain whose TLD is letters (any script) or
// punycode. A trailing `.` ends the address unless a label follows it.
const addressToken =
  /(?<![\p{L}\p{N}._%+-])([\p{L}\p{N}._%+-]*)@((?:[\p{L}\p{N}-]+\.)+(\p{L}{2,}|xn--[a-z0-9-]+))(?![\p{L}\p{N}-]|\.[\p{L}\p{N}])/giu;

// `scheme://` followed by an authority with no whitespace, path, or `@` yet.
const urlAuthorityPrefix = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/?#@]*$/;

const assetExtensions = new Set([
  "avif",
  "bmp",
  "cjs",
  "css",
  "gif",
  "htm",
  "html",
  "ico",
  "jpeg",
  "jpg",
  "js",
  "json",
  "map",
  "mjs",
  "mp4",
  "pdf",
  "png",
  "svg",
  "ts",
  "tsx",
  "ttf",
  "txt",
  "webm",
  "webp",
  "woff",
  "woff2",
]);

const isAddressToken = (text: string, match: RegExpMatchArray) => {
  const [token, localPart = "", , extension = ""] = match;
  const start = match.index ?? 0;
  const atIndex = start + localPart.length;
  const rest = text.slice(start + token.length);

  if (assetExtensions.has(extension.toLowerCase())) return false;
  // Credentials inside a URL authority: `https://user:pass@host`.
  if (urlAuthorityPrefix.test(text.slice(0, atIndex))) return false;
  // A bare `@example.com` hand-writes the domain; before a path or port it is
  // a URL host after interpolated credentials.
  if (localPart === "") return !/^[/:?#]/.test(rest);
  // A git SCP remote: `git@github.com:org/repo.git`.
  return !/^:[^\s:]/.test(rest);
};

/** Address-shaped tokens in one literal value, after decoding `@`. */
const findAddresses = (value: string) => {
  const text = value.replace(encodedAt, "@");
  return [...text.matchAll(addressToken)]
    .filter((match) => isAddressToken(text, match))
    .map(([token]) => token);
};

const unwrapParentheses = (node: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(node)
    ? unwrapParentheses(node.expression)
    : node;

const isConcatenation = (node: ts.Node): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind === ts.SyntaxKind.PlusToken;

const isPlainLiteral = (
  node: ts.Node
): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

/** The nearest ancestor that is not a parenthesis. */
const enclosingNode = (node: ts.Node): ts.Node | undefined => {
  let ancestor = node.parent;
  while (ancestor && ts.isParenthesizedExpression(ancestor)) {
    ancestor = ancestor.parent;
  }
  return ancestor;
};

/** Flattens a `+` chain, through parentheses, into its operands. */
const concatenationOperands = (node: ts.Expression): ts.Expression[] => {
  const unwrapped = unwrapParentheses(node);
  return isConcatenation(unwrapped)
    ? [
        ...concatenationOperands(unwrapped.left),
        ...concatenationOperands(unwrapped.right),
      ]
    : [unwrapped];
};

const literalValues = (node: ts.Node): readonly string[] => {
  if (isPlainLiteral(node) || ts.isJsxText(node)) return [node.text];
  if (ts.isTemplateExpression(node)) {
    return [
      node.head.text,
      ...node.templateSpans.map((span) => span.literal.text),
    ];
  }
  return [];
};

const scriptKind = (fileName: string) => {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (fileName.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

/** Finds hand-written addresses in one module's source. */
export const findTestEmailLiterals = (
  fileName: string,
  sourceText: string
): TestEmailLiteral[] => {
  const source = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName)
  );
  const findings: TestEmailLiteral[] = [];
  const folded = new Set<ts.Node>();

  const report = (node: ts.Node, values: readonly string[]) => {
    for (const value of values) {
      for (const address of findAddresses(value)) {
        const position = source.getLineAndCharacterOfPosition(
          node.getStart(source)
        );
        findings.push({
          address,
          column: position.character + 1,
          line: position.line + 1,
        });
      }
    }
  };

  const visit = (node: ts.Node) => {
    const enclosing = enclosingNode(node);
    const isChainRoot =
      isConcatenation(node) &&
      !(enclosing !== undefined && isConcatenation(enclosing));
    if (isChainRoot) {
      // Adjacent literal operands fold into one value; any other operand
      // breaks the run.
      let run: ts.Expression[] = [];
      const flush = () => {
        const [first] = run;
        if (first) {
          report(first, [
            run
              .map((operand) => (isPlainLiteral(operand) ? operand.text : ""))
              .join(""),
          ]);
        }
        run = [];
      };
      for (const operand of concatenationOperands(node)) {
        if (isPlainLiteral(operand)) {
          run.push(operand);
          folded.add(operand);
        } else {
          flush();
        }
      }
      flush();
    } else if (!folded.has(node)) {
      report(node, literalValues(node));
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return findings;
};

const listRepositoryModules = async (repositoryRoot: string) => {
  const child = Bun.spawn(
    [
      "git",
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ...scannedRoots,
      ...excludedRoots.map((root) => `:(exclude)${root}`),
    ],
    { cwd: repositoryRoot, stderr: "inherit", stdout: "pipe" }
  );
  const [listing, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error("git ls-files failed while listing test modules");
  }
  return listing.split("\0").filter(Boolean);
};

/** Scans every test module in the repository for hand-written addresses. */
export const findRepositoryTestEmailLiterals = async (
  repositoryRoot: string
) => {
  const paths = (await listRepositoryModules(repositoryRoot)).filter(
    isTestEmailLiteralPath
  );
  const findings: RepositoryTestEmailLiteral[] = [];
  for (const path of paths) {
    const sourceText = await Bun.file(resolve(repositoryRoot, path)).text();
    for (const finding of findTestEmailLiterals(path, sourceText)) {
      findings.push({ ...finding, path });
    }
  }
  return { checkedModules: paths.length, findings };
};

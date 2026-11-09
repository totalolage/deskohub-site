import path from "node:path";
import { Schema } from "effect";

// A catalog maps each key to a pattern, or to variants of a matched message.
const MatchedMessage = Schema.Array(
  Schema.Struct({ match: Schema.Record(Schema.String, Schema.String) })
);
const isMatchedMessage = Schema.is(MatchedMessage);
const decodeCatalog = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Record(Schema.String, Schema.Union([Schema.String, MatchedMessage]))
  )
);

export type CatalogText = {
  /** The message key; keys are unique across catalogs. */
  readonly message: string;
  readonly locale: string;
  readonly text: string;
  /** A static run of a pattern with placeholders, matched anywhere. */
  readonly fragment: boolean;
};

const placeholder = /\{[^{}]*\}/;

// A short single word ("Codes") can be a coincidental literal in customer
// code; any multi-word or longer text can't.
const isDistinctive = (text: string) =>
  /\S\s+\S/.test(text.trim()) || text.trim().length >= 12;

/**
 * Lists a catalog's message texts. Paraglide compiles a pattern with
 * placeholders into a template literal split around each input, so such a
 * pattern contributes its static runs as fragments.
 */
export const readCatalogTexts = (locale: string, json: string): CatalogText[] =>
  Object.entries(decodeCatalog(json)).flatMap(([message, value]) =>
    (isMatchedMessage(value)
      ? value.flatMap(({ match }) => Object.values(match))
      : [value]
    ).flatMap((pattern): CatalogText[] =>
      placeholder.test(pattern)
        ? pattern
            .split(placeholder)
            .map((text) => ({ message, locale, text, fragment: true }))
        : [{ message, locale, text: pattern, fragment: false }]
    )
  );

/**
 * Keeps the administration texts whose presence in a chunk proves a leak: long
 * enough not to be coincidental, and not copy shared with the customer catalog.
 */
export const selectLeakEvidence = (
  administrationTexts: readonly CatalogText[],
  customerTexts: readonly CatalogText[]
) => {
  const customerPatterns = customerTexts.map(({ text }) => text);
  return administrationTexts.filter(
    ({ fragment, text }) =>
      isDistinctive(text) &&
      !customerPatterns.some((customer) =>
        fragment ? customer.includes(text) : customer === text
      )
  );
};

// Minifiers escape some characters (`ú` becomes `\xfa`), so decode string
// escapes before matching text.
const decodeEscapes = (source: string) =>
  source
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16))
    )
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16))
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16))
    );

const sourceForms = (text: string, fragment: boolean) => {
  const escaped = JSON.stringify(text).slice(1, -1);
  return fragment
    ? [text, escaped]
    : [JSON.stringify(text), `'${text.replaceAll("'", "\\'")}'`, `\`${text}\``];
};

/** Returns the texts that occur in a chunk's source. */
export const findTexts = <T extends Pick<CatalogText, "text" | "fragment">>(
  texts: readonly T[],
  source: string
) => {
  const decoded = decodeEscapes(source);
  return texts.filter(({ text, fragment }) =>
    sourceForms(text, fragment).some((form) => decoded.includes(form))
  );
};

// Too short to say anything about which message a chunk holds.
const isTrivial = (text: string) => text.trim().length < 3;

// Three words make a label or sentence no library writes by chance.
const isSentence = (text: string) => text.trim().split(/\s+/).length >= 3;

/**
 * Returns the evidence texts of the administration messages a chunk holds. A
 * text of three or more words counts on its own, so copy pasted into a
 * customer component instead of imported is caught without its translation.
 * A shorter phrase can be a library literal that happens to read "at least",
 * so it counts only when the chunk also holds a text of the same message in
 * every other locale that has one. Paraglide compiles every locale of a
 * message into one module, so an imported message always brings them along.
 * Texts in `sharedTexts` also occur in other source, such as the
 * administration API contract's English labels, and need the message's other
 * locales alongside however long they are. The message's other texts keep the
 * usual rule.
 */
export const findMessageTexts = (
  evidence: readonly CatalogText[],
  catalogTexts: readonly CatalogText[],
  source: string,
  sharedTexts: ReadonlySet<string> = new Set()
) => {
  const substantial = catalogTexts.filter(({ text }) => !isTrivial(text));
  const expected = localesByMessage(substantial);
  const found = localesByMessage(findTexts(substantial, source));
  return findTexts(evidence, source).filter(
    ({ message, text }) =>
      (isSentence(text) && !sharedTexts.has(text)) ||
      [...(expected.get(message) ?? [])].every((locale) =>
        found.get(message)?.has(locale)
      )
  );
};

const localesByMessage = (texts: readonly CatalogText[]) => {
  const locales = new Map<string, Set<string>>();
  for (const { message, locale } of texts) {
    locales.set(message, (locales.get(message) ?? new Set()).add(locale));
  }
  return locales;
};

/**
 * Splits every emitted client chunk into those only administration routes can
 * load and the rest. A chunk counts as administration-only when administration
 * route manifests list it, or other chunks load it lazily, and no chunk outside
 * that set loads it. Customer route chunks, root chunks, and any chunk nothing
 * accounts for are customer-reachable, and so is everything they load.
 */
export const classifyChunks = ({
  administrationEntryChunks,
  chunks,
  customerEntryChunks,
}: {
  readonly administrationEntryChunks: ReadonlySet<string>;
  readonly chunks: ReadonlyMap<string, string>;
  readonly customerEntryChunks: ReadonlySet<string>;
}) => {
  const chunksByFileName = new Map<string, string[]>();
  for (const chunk of chunks.keys()) {
    const fileName = path.posix.basename(chunk);
    chunksByFileName.set(fileName, [
      ...(chunksByFileName.get(fileName) ?? []),
      chunk,
    ]);
  }
  const loads = new Map<string, Set<string>>();
  const loaded = new Set<string>();
  for (const [chunk, source] of chunks) {
    const targets = new Set(
      (source.match(/[\w.-]+\.js\b/g) ?? [])
        .flatMap((fileName) => chunksByFileName.get(fileName) ?? [])
        .filter((target) => target !== chunk)
    );
    loads.set(chunk, targets);
    for (const target of targets) loaded.add(target);
  }

  const customerReachable = new Set(
    [...chunks.keys()].filter(
      (chunk) =>
        customerEntryChunks.has(chunk) ||
        !(administrationEntryChunks.has(chunk) || loaded.has(chunk))
    )
  );
  const pending = [...customerReachable];
  for (let chunk = pending.pop(); chunk; chunk = pending.pop()) {
    for (const target of loads.get(chunk) ?? []) {
      if (customerReachable.has(target)) continue;
      customerReachable.add(target);
      pending.push(target);
    }
  }

  return {
    administrationOnly: new Set(
      [...chunks.keys()].filter((chunk) => !customerReachable.has(chunk))
    ),
    customerReachable,
  };
};

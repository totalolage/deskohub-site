/** One body part of a `multipart/mixed` message (RFC 2046). */
export interface MultipartPart {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** A parsed body part; `body` is exactly the bytes between its delimiters. */
export interface ParsedMultipartPart {
  readonly headers: Headers;
  readonly body: string;
}

const lineBreak = "\r\n";

/**
 * Encodes text parts as a `multipart/mixed` body. Each part's body is framed
 * byte for byte, so a signature over a part's body still verifies after
 * parsing.
 */
export const encodeMultipartMixed = (
  parts: readonly MultipartPart[],
  boundary: string = crypto.randomUUID()
) => {
  const encodedParts = parts.map(({ headers, body }) =>
    [
      `--${boundary}`,
      ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
      "",
      body,
    ].join(lineBreak)
  );

  return {
    contentType: `multipart/mixed; boundary=${boundary}`,
    body: [...encodedParts, `--${boundary}--`, ""].join(lineBreak),
  };
};

const boundaryOf = (contentType: string) => {
  const [mediaType = "", ...parameters] = contentType.split(";");
  if (mediaType.trim().toLowerCase() !== "multipart/mixed") return undefined;

  const boundary = parameters
    .map((parameter) => parameter.trim())
    .find((parameter) => parameter.toLowerCase().startsWith("boundary="))
    ?.slice("boundary=".length);
  return boundary?.replace(/^"(.*)"$/, "$1") || undefined;
};

const parsePart = (text: string): ParsedMultipartPart => {
  if (text.startsWith(lineBreak)) {
    return { headers: new Headers(), body: text.slice(lineBreak.length) };
  }

  const headerEnd = text.indexOf(lineBreak + lineBreak);
  const headerBlock = headerEnd === -1 ? text : text.slice(0, headerEnd);
  const headers = new Headers();
  for (const line of headerBlock.split(lineBreak)) {
    const separator = line.indexOf(":");
    if (separator > 0) {
      headers.append(
        line.slice(0, separator),
        line.slice(separator + 1).trim()
      );
    }
  }

  return {
    headers,
    body: headerEnd === -1 ? "" : text.slice(headerEnd + 2 * lineBreak.length),
  };
};

/**
 * Parses a `multipart/mixed` body into its parts, ignoring any preamble and
 * epilogue. `undefined` when the content type is not `multipart/mixed` with
 * a boundary, or the body has no closing delimiter.
 */
export const parseMultipartMixed = (
  contentType: string,
  body: string
): readonly ParsedMultipartPart[] | undefined => {
  const boundary = boundaryOf(contentType);
  if (boundary === undefined) return undefined;

  const delimiter = `--${boundary}`;
  const framed = lineBreak + body;
  const parts: ParsedMultipartPart[] = [];
  let cursor = framed.indexOf(lineBreak + delimiter);

  while (cursor !== -1) {
    const afterDelimiter = cursor + lineBreak.length + delimiter.length;
    if (framed.startsWith("--", afterDelimiter)) return parts;

    const next = framed.indexOf(lineBreak + delimiter, afterDelimiter);
    if (next === -1) return undefined;

    parts.push(
      parsePart(framed.slice(afterDelimiter + lineBreak.length, next))
    );
    cursor = next;
  }

  return undefined;
};

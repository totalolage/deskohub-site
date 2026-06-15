const HTML_ESCAPE_LOOKUP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const HTML_ESCAPE_PATTERN = /[&<>"']/g;

export const escapeHtml = (value: string): string => {
  return value.replace(HTML_ESCAPE_PATTERN, (character) => {
    return HTML_ESCAPE_LOOKUP[character] ?? character;
  });
};

export const escapeMultilineHtml = (value: string): string => {
  return escapeHtml(value).replaceAll("\n", "<br />");
};

export const escapeOptionalHtml = (
  value: string | undefined | null
): string | undefined => {
  if (!value) {
    return undefined;
  }

  return escapeHtml(value);
};

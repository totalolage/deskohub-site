/** Returns the URL without its user info, or null when it has none. */
export const removeUrlCredentials = (href: string): string | null => {
  const url = new URL(href);
  if (!url.username && !url.password) return null;
  url.username = "";
  url.password = "";
  return url.toString();
};

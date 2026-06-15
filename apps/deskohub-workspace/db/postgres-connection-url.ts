export const normalizePostgresConnectionUrl = (connectionString: string) => {
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");

  if (
    sslMode === "require" ||
    sslMode === "prefer" ||
    sslMode === "verify-ca"
  ) {
    url.searchParams.set("sslmode", "verify-full");
  }

  return url.toString();
};

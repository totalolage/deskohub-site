export type NeonAuthConfiguration = {
  readonly baseUrl: string;
  readonly cookieSecret: string;
};

export const resolveNeonAuthConfiguration = (environment: {
  readonly NEON_AUTH_BASE_URL?: string | undefined;
  readonly NEON_AUTH_COOKIE_SECRET?: string | undefined;
}): NeonAuthConfiguration | undefined => {
  const baseUrl = environment.NEON_AUTH_BASE_URL;
  const cookieSecret = environment.NEON_AUTH_COOKIE_SECRET;
  return baseUrl && cookieSecret ? { baseUrl, cookieSecret } : undefined;
};

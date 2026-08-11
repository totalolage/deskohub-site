import "server-only";

import { Option, Schema } from "effect";
import { redirect } from "next/navigation";
import type { Locale } from "@/features/i18n";
import { auth } from "./auth.server";
import { customerAccountIdSchema } from "./contracts";

export const getCustomerSession = async () => {
  const result = await auth.getSession();
  return result.error ? null : result.data;
};

export const getFreshCustomerSession = async () => {
  const result = await auth.getSession({
    query: { disableCookieCache: "true" },
  });
  return result.error ? null : result.data;
};

export const getCustomerAccountId = (value: unknown) =>
  Option.getOrNull(Schema.decodeUnknownOption(customerAccountIdSchema)(value));

export const requireCustomerSession = async (locale: Locale) => {
  const session = await getCustomerSession();
  const accountId = getCustomerAccountId(session?.user.id);
  if (!session?.user || !accountId) {
    redirect(`/${locale}/auth/sign-in?redirectTo=/${locale}/account`);
  }

  return { accountId, session };
};

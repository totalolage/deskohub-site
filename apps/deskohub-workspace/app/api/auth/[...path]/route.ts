import { auth } from "@/features/account/auth.server";

export const { DELETE, GET, PATCH, POST, PUT } = auth.handler();

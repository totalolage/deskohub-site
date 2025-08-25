import { checkBotId } from "botid/server";
import { NextResponse } from "next/server";
import type { MiddlewareFactory } from "@/shared/utils/middleware-chain";

/**
 * Middleware for bot protection using Vercel BotID
 * Checks all POST requests (which includes Next.js server actions)
 */
export const botProtectionMiddleware: MiddlewareFactory = (next) => {
  return async (request, event, response) => {
    // Only check POST requests (server actions use POST)
    if (request.method === "POST") {
      try {
        const verification = await checkBotId();

        if (verification.isBot && !verification.isVerifiedBot) {
          // Block bad bots with a 403 Forbidden response
          console.warn("Bad bot detected and blocked:", {
            url: request.url,
            ip:
              request.headers.get("x-forwarded-for") ||
              request.headers.get("x-real-ip"),
            userAgent: request.headers.get("user-agent"),
          });

          return new NextResponse(JSON.stringify({ error: "Access denied" }), {
            status: 403,
            headers: {
              "Content-Type": "application/json",
            },
          });
        }

        if (verification.isVerifiedBot) {
          // Allow verified bots through (e.g., Google, Bing crawlers)
          // In production, you might want to log this to a monitoring service
        }
      } catch (error) {
        // If BotID check fails, allow the request to prevent blocking legitimate users
        console.error("BotID verification error in middleware:", error);
      }
    }

    // Continue to the next middleware
    return next(request, event, response);
  };
};

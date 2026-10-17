import { Schema } from "effect";

/**
 * What kind of client sent a request, in a fixed low-cardinality set. Humans
 * and everything we can't recognize are `unclassified`.
 */
const AgentCategory = Schema.Literals([
  "ai_user_agent",
  "ai_search_crawler",
  "ai_training_crawler",
  "search_crawler",
  "automation",
  "other_bot",
  "unclassified",
]);
type AgentCategory = typeof AgentCategory.Type;

/**
 * Who operates a recognized agent. A value outside the list, such as an
 * unknown BotID verified-bot name or Signature-Agent, is `other`; the raw
 * value is never kept.
 */
const AgentName = Schema.Literals([
  "chatgpt",
  "claude",
  "perplexity",
  "google",
  "bing",
  "apple",
  "duckduckgo",
  "seznam",
  "meta",
  "mistral",
  "amazon",
  "common_crawl",
  "cursor",
  "other",
]);
type AgentName = typeof AgentName.Type;

export interface AgentTraffic {
  readonly category: AgentCategory;
  readonly name?: AgentName;
}

export const unclassifiedTraffic: AgentTraffic = { category: "unclassified" };

/** The BotID verdict fields that identify a verified bot. */
export interface VerifiedBot {
  readonly verifiedBotName?: string | undefined;
  readonly verifiedBotCategory?: string | undefined;
}

interface KnownAgent {
  /** A lowercase User-Agent product token, also BotID's verified-bot name. */
  readonly token: string;
  readonly category: Exclude<AgentCategory, "unclassified">;
  readonly name: AgentName;
}

// Ordered: the first token the User-Agent contains wins, so a longer token
// (`applebot-extended`) comes before one it contains (`applebot`).
const knownAgents: readonly KnownAgent[] = [
  // User-triggered fetchers and agent browsers
  { token: "chatgpt-user", category: "ai_user_agent", name: "chatgpt" },
  { token: "chatgpt-operator", category: "ai_user_agent", name: "chatgpt" },
  { token: "gpt-actions", category: "ai_user_agent", name: "chatgpt" },
  { token: "claude-user", category: "ai_user_agent", name: "claude" },
  { token: "perplexity-user", category: "ai_user_agent", name: "perplexity" },
  { token: "google-agent", category: "ai_user_agent", name: "google" },
  { token: "gemini-deep-research", category: "ai_user_agent", name: "google" },
  { token: "mistralai-user", category: "ai_user_agent", name: "mistral" },
  { token: "meta-externalfetcher", category: "ai_user_agent", name: "meta" },
  { token: "duckassistbot", category: "ai_user_agent", name: "duckduckgo" },
  { token: "cursor-server", category: "ai_user_agent", name: "cursor" },
  // AI search indexers
  { token: "oai-searchbot", category: "ai_search_crawler", name: "chatgpt" },
  { token: "claude-searchbot", category: "ai_search_crawler", name: "claude" },
  { token: "perplexitybot", category: "ai_search_crawler", name: "perplexity" },
  { token: "mistralai-index", category: "ai_search_crawler", name: "mistral" },
  { token: "meta-webindexer", category: "ai_search_crawler", name: "meta" },
  // AI training crawlers
  { token: "gptbot", category: "ai_training_crawler", name: "chatgpt" },
  { token: "claudebot", category: "ai_training_crawler", name: "claude" },
  { token: "anthropic-ai", category: "ai_training_crawler", name: "claude" },
  {
    token: "applebot-extended",
    category: "ai_training_crawler",
    name: "apple",
  },
  { token: "google-extended", category: "ai_training_crawler", name: "google" },
  {
    token: "meta-externalagent",
    category: "ai_training_crawler",
    name: "meta",
  },
  { token: "amazonbot", category: "ai_training_crawler", name: "amazon" },
  { token: "ccbot", category: "ai_training_crawler", name: "common_crawl" },
  { token: "bytespider", category: "ai_training_crawler", name: "other" },
  { token: "cohere-ai", category: "ai_training_crawler", name: "other" },
  // Search engine crawlers
  { token: "googlebot", category: "search_crawler", name: "google" },
  { token: "bingbot", category: "search_crawler", name: "bing" },
  { token: "applebot", category: "search_crawler", name: "apple" },
  { token: "duckduckbot", category: "search_crawler", name: "duckduckgo" },
  { token: "seznambot", category: "search_crawler", name: "seznam" },
  { token: "yandexbot", category: "search_crawler", name: "other" },
  { token: "baiduspider", category: "search_crawler", name: "other" },
];

// Headless browsers, browser automation, and scripted HTTP clients.
const automationTokens = [
  "headless",
  "playwright",
  "puppeteer",
  "selenium",
  "webdriver",
  "phantomjs",
  "curl/",
  "wget/",
  "python-requests",
  "python-httpx",
  "python-urllib",
  "aiohttp",
  "go-http-client",
  "node-fetch",
  "undici",
  "axios/",
  "okhttp",
  "libwww-perl",
];

const genericBotPattern = /bot|crawl|spider|slurp|scraper/;

// BotID verified-bot categories (bots.fyi) mapped onto ours.
const verifiedBotCategories: ReadonlyMap<
  string,
  Exclude<AgentCategory, "unclassified">
> = new Map([
  ["agent", "ai_user_agent"],
  ["ai_assistant", "ai_user_agent"],
  ["user_initiated", "ai_user_agent"],
  ["ai_crawler", "ai_training_crawler"],
  ["search_engine_crawler", "search_crawler"],
]);

// Operators that sign agent requests with Web Bot Auth's Signature-Agent.
const signatureAgentOperators: readonly {
  readonly host: string;
  readonly name: AgentName;
}[] = [
  { host: "chatgpt.com", name: "chatgpt" },
  { host: "openai.com", name: "chatgpt" },
  { host: "claude.ai", name: "claude" },
  { host: "claude.com", name: "claude" },
  { host: "anthropic.com", name: "claude" },
  { host: "perplexity.ai", name: "perplexity" },
  { host: "google.com", name: "google" },
];

/**
 * Classifies a request from its `User-Agent` and `Signature-Agent` headers.
 * String checks only, so the proxy can run it on every page request. It never
 * reads the proxy's forwarded category, so a client can't choose its own.
 */
export const classifyAgentTraffic = (headers: Headers): AgentTraffic => {
  const userAgent = headers.get("user-agent")?.toLowerCase() ?? "";
  const knownAgent = knownAgents.find(({ token }) => userAgent.includes(token));
  if (knownAgent) {
    return { category: knownAgent.category, name: knownAgent.name };
  }

  const signatureAgent = headers.get("signature-agent")?.toLowerCase();
  if (signatureAgent) {
    return {
      category: "ai_user_agent",
      name:
        signatureAgentOperators.find(({ host }) =>
          signatureAgent.includes(host)
        )?.name ?? "other",
    };
  }

  if (automationTokens.some((token) => userAgent.includes(token))) {
    return { category: "automation" };
  }
  if (genericBotPattern.test(userAgent)) return { category: "other_bot" };
  return unclassifiedTraffic;
};

/** Classifies a bot BotID verified from its verified-bot name and category. */
export const classifyVerifiedBot = ({
  verifiedBotName,
  verifiedBotCategory,
}: VerifiedBot): AgentTraffic => {
  const name = verifiedBotName?.toLowerCase();
  const knownAgent = knownAgents.find(({ token }) => token === name);
  if (knownAgent) {
    return { category: knownAgent.category, name: knownAgent.name };
  }
  return {
    category:
      verifiedBotCategories.get(verifiedBotCategory ?? "") ?? "other_bot",
    name: "other",
  };
};

/** The PostHog event properties that report a request's agent traffic. */
export const agentTrafficProperties = ({ category, name }: AgentTraffic) => ({
  agent_category: category,
  agent_name: name,
});

const forwardedCategoryHeader = "x-deskohub-agent-category";
const forwardedNameHeader = "x-deskohub-agent-name";

/**
 * Hands the proxy's classification to the request's render, replacing any
 * value the client sent. Unclassified traffic carries no header. Returns
 * whether the request headers changed and so must be forwarded.
 */
export const forwardAgentTraffic = (
  headers: Headers,
  traffic: AgentTraffic
) => {
  const clientSentValue =
    headers.has(forwardedCategoryHeader) || headers.has(forwardedNameHeader);
  headers.delete(forwardedCategoryHeader);
  headers.delete(forwardedNameHeader);
  if (traffic.category === "unclassified") return clientSentValue;

  headers.set(forwardedCategoryHeader, traffic.category);
  if (traffic.name) headers.set(forwardedNameHeader, traffic.name);
  return true;
};

const isAgentCategory = Schema.is(AgentCategory);
const isAgentName = Schema.is(AgentName);

/**
 * The proxy's classification of a request it handed on. Only requests that
 * pass through the proxy, which replaces any client value, may be read this
 * way; route handlers classify their own headers.
 */
export const readForwardedAgentTraffic = (headers: Headers): AgentTraffic => {
  const category = headers.get(forwardedCategoryHeader);
  if (!isAgentCategory(category)) return unclassifiedTraffic;
  const name = headers.get(forwardedNameHeader);
  return isAgentName(name) ? { category, name } : { category };
};

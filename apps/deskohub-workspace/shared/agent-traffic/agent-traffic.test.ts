import { describe, expect, test } from "bun:test";
import {
  type AgentTraffic,
  agentTrafficProperties,
  classifyAgentTraffic,
  classifyVerifiedBot,
} from "./agent-traffic";

const chromeOnMac =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const safariOnIphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";

const classify = (userAgent: string, headers: Record<string, string> = {}) =>
  classifyAgentTraffic(new Headers({ "user-agent": userAgent, ...headers }));

describe("classifyAgentTraffic", () => {
  test.each<[string, AgentTraffic]>([
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
      { category: "ai_user_agent", name: "chatgpt" },
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +https://www.anthropic.com)",
      { category: "ai_user_agent", name: "claude" },
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
      { category: "ai_user_agent", name: "perplexity" },
    ],
    [
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent)",
      { category: "ai_user_agent", name: "google" },
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot",
      { category: "ai_search_crawler", name: "chatgpt" },
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)",
      { category: "ai_search_crawler", name: "claude" },
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
      { category: "ai_search_crawler", name: "perplexity" },
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.3; +https://openai.com/gptbot",
      { category: "ai_training_crawler", name: "chatgpt" },
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +https://www.anthropic.com)",
      { category: "ai_training_crawler", name: "claude" },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot-Extended/0.1; +http://www.apple.com/go/applebot)",
      { category: "ai_training_crawler", name: "apple" },
    ],
    [
      "CCBot/2.0 (https://commoncrawl.org/faq/)",
      { category: "ai_training_crawler", name: "common_crawl" },
    ],
    [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      { category: "search_crawler", name: "google" },
    ],
    [
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
      { category: "search_crawler", name: "bing" },
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
      { category: "search_crawler", name: "apple" },
    ],
    [
      "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)",
      { category: "search_crawler", name: "duckduckgo" },
    ],
    [
      "Mozilla/5.0 (compatible; SeznamBot/4.0; +https://o-seznam.cz/napoveda/vyhledavani/en/seznambot-crawler/)",
      { category: "search_crawler", name: "seznam" },
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.7390.37 Safari/537.36",
      { category: "automation" },
    ],
    ["curl/8.7.1", { category: "automation" }],
    ["python-requests/2.32.3", { category: "automation" }],
    [
      "Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)",
      { category: "other_bot" },
    ],
    [chromeOnMac, { category: "unclassified" }],
    [safariOnIphone, { category: "unclassified" }],
  ])("classifies %s", (userAgent, traffic) => {
    expect(classify(userAgent)).toEqual(traffic);
  });

  test("treats a request without a User-Agent as unclassified", () => {
    expect(classifyAgentTraffic(new Headers())).toEqual({
      category: "unclassified",
    });
  });

  test("upgrades a signed request without a known crawler token to a user-triggered agent", () => {
    expect(
      classify(chromeOnMac, { "signature-agent": '"https://chatgpt.com"' })
    ).toEqual({ category: "ai_user_agent", name: "chatgpt" });
    expect(
      classify(chromeOnMac, {
        "signature-agent": '"https://agent.example-browser.test"',
      })
    ).toEqual({ category: "ai_user_agent", name: "other" });
    expect(
      classify("Mozilla/5.0 HeadlessChrome/141.0.0.0", {
        "signature-agent": '"https://claude.ai"',
      })
    ).toEqual({ category: "ai_user_agent", name: "claude" });
    expect(
      classify("Mozilla/5.0 (compatible; AhrefsBot/7.0)", {
        "signature-agent": '"https://perplexity.ai"',
      })
    ).toEqual({ category: "ai_user_agent", name: "perplexity" });
  });

  test("keeps a known crawler's own category when it also signs its requests", () => {
    expect(
      classify(
        "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot",
        { "signature-agent": '"https://chatgpt.com"' }
      )
    ).toEqual({ category: "ai_search_crawler", name: "chatgpt" });
  });

  test.each<[string, string, AgentTraffic["name"]]>([
    ["the operator host", '"https://chatgpt.com"', "chatgpt"],
    [
      "a subdomain of the operator host",
      '"https://agents.openai.com"',
      "chatgpt",
    ],
    [
      "an uppercase operator host with a path",
      '"https://Claude.AI/agent"',
      "claude",
    ],
  ])("names a Signature-Agent from %s", (_, signatureAgent, name) => {
    expect(
      classify(chromeOnMac, { "signature-agent": signatureAgent })
    ).toEqual({ category: "ai_user_agent", name });
  });

  test.each<[string, string]>([
    ["a lookalike host", '"https://not-openai.com"'],
    [
      "a host that extends an operator host",
      '"https://chatgpt.com.example.test"',
    ],
    [
      "an operator host in the path",
      '"https://agents.example.test/path/openai.com"',
    ],
    [
      "an operator host in the query",
      '"https://agents.example.test/?openai.com"',
    ],
    [
      "an operator host as userinfo",
      '"https://openai.com@agents.example.test"',
    ],
    ["an unquoted URL", "https://chatgpt.com"],
    ["a dictionary member", 'sig1="https://chatgpt.com"'],
    ["a non-HTTPS URL", '"http://chatgpt.com"'],
    ["an unparseable URL", '"chatgpt.com"'],
    ["an escaped string", '"https://chatgpt.com\\"'],
  ])("names a Signature-Agent from %s other", (_, signatureAgent) => {
    expect(
      classify(chromeOnMac, { "signature-agent": signatureAgent })
    ).toEqual({ category: "ai_user_agent", name: "other" });
  });

  test("ignores an empty Signature-Agent", () => {
    expect(classify(chromeOnMac, { "signature-agent": "" })).toEqual({
      category: "unclassified",
    });
  });

  test("ignores a client-sent forwarded category", () => {
    expect(
      classify(chromeOnMac, {
        "x-deskohub-agent-category": "ai_user_agent",
        "x-deskohub-agent-name": "chatgpt",
      })
    ).toEqual({ category: "unclassified" });
    expect(
      classify("Mozilla/5.0 (compatible; Googlebot/2.1)", {
        "x-deskohub-agent-category": "unclassified",
      })
    ).toEqual({ category: "search_crawler", name: "google" });
  });
});

describe("classifyVerifiedBot", () => {
  test.each<[string, string, AgentTraffic]>([
    [
      "chatgpt-operator",
      "ai_assistant",
      { category: "ai_user_agent", name: "chatgpt" },
    ],
    [
      "claude-user",
      "ai_assistant",
      { category: "ai_user_agent", name: "claude" },
    ],
    ["google-agent", "agent", { category: "ai_user_agent", name: "google" }],
    [
      "perplexitybot",
      "ai_assistant",
      { category: "ai_search_crawler", name: "perplexity" },
    ],
    [
      "gptbot",
      "ai_crawler",
      { category: "ai_training_crawler", name: "chatgpt" },
    ],
    [
      "googlebot",
      "search_engine_crawler",
      { category: "search_crawler", name: "google" },
    ],
  ])("classifies the verified bot %s", (name, category, traffic) => {
    expect(
      classifyVerifiedBot({
        verifiedBotName: name,
        verifiedBotCategory: category,
      })
    ).toEqual(traffic);
  });

  test("classifies a BotID customer agent as a user agent whatever its category", () => {
    expect(
      classifyVerifiedBot({
        verifiedBotName: "chatgpt-operator",
        verifiedBotCategory: "monitor",
      })
    ).toEqual({ category: "ai_user_agent", name: "chatgpt" });
  });

  test("collapses an unknown verified bot name to other", () => {
    expect(
      classifyVerifiedBot({
        verifiedBotName: "amazon-q",
        verifiedBotCategory: "ai_assistant",
      })
    ).toEqual({ category: "ai_user_agent", name: "other" });
    expect(
      classifyVerifiedBot({
        verifiedBotName: "uptime-robot",
        verifiedBotCategory: "monitor",
      })
    ).toEqual({ category: "other_bot", name: "other" });
    expect(
      classifyVerifiedBot({
        verifiedBotName: undefined,
        verifiedBotCategory: "constructor",
      })
    ).toEqual({ category: "other_bot", name: "other" });
  });
});

test("reports the category and name as event properties", () => {
  expect(
    agentTrafficProperties({ category: "ai_user_agent", name: "chatgpt" })
  ).toEqual({ agent_category: "ai_user_agent", agent_name: "chatgpt" });
  expect(agentTrafficProperties({ category: "unclassified" })).toEqual({
    agent_category: "unclassified",
    agent_name: undefined,
  });
});

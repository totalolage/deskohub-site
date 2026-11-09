/**
 * Vercel verified-bot names (`verifiedBotName`) of agents that browse for a
 * customer at the customer's request. A verified signature proves which
 * vendor runs the agent, not that the customer authorized it, so a call site
 * that allows these still relies on its own sign-in, payment, and limits.
 * Directory: https://vercel.com/docs/botid/verified-bots
 */
export const customerAgentNames = [
  // ChatGPT agent's cloud browser signs every request with Web Bot Auth:
  // https://help.openai.com/en/articles/11845367-chatgpt-works-cloud-browser-allowlisting
  "chatgpt-operator",
] as const;

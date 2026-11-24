// OpenAI's network allowlist names these specific asset and Sentry hosts.
// https://help.openai.com/en/articles/9247338-network-recommendations-for-chatgpt-errors-on-web-and-apps
export const rules = [
  'DOMAIN,cdn.openaimerge.com',
  'DOMAIN,o207216.ingest.sentry.io',
];

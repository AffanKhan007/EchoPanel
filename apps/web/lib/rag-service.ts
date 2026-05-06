export function requireRagConfig() {
  const baseUrl = process.env.RAG_API_URL;
  const apiKey = process.env.RAG_API_KEY;

  if (!baseUrl) {
    throw new Error("Missing required environment variable: RAG_API_URL");
  }

  if (!apiKey) {
    throw new Error("Missing required environment variable: RAG_API_KEY");
  }

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
  };
}

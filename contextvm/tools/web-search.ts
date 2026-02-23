import { serverConfig } from "../../src/config/env.server";
import type { WebSearchResult } from "../web-schemas";

const USER_AGENT = "EarthlyCity/1.0 Map MCP Server (https://earthly.city)";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 10_000;

export interface WebSearchApiResult {
  query: string;
  count: number;
  results: WebSearchResult[];
}

export async function webSearch(
  query: string,
  limit?: number,
  categories?: string,
  language?: string,
): Promise<WebSearchApiResult> {
  const searxngUrl = serverConfig.searxngUrl;
  if (!searxngUrl) {
    throw new Error(
      "SearXNG is not configured. Set SEARXNG_URL environment variable.",
    );
  }

  const trimmedQuery = query?.trim();
  if (!trimmedQuery) {
    throw new Error("Query parameter is required and must be non-empty");
  }

  const cappedLimit = Math.min(
    Math.max(limit ?? DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  const url = new URL("/search", searxngUrl);
  url.searchParams.set("q", trimmedQuery);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", categories || "general");
  url.searchParams.set("language", language || "en");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `SearXNG API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        engine?: string;
        engines?: string[];
      }>;
    };
    const rawResults = Array.isArray(data.results) ? data.results : [];

    const results: WebSearchResult[] = rawResults
      .slice(0, cappedLimit)
      .map((r) => ({
        title: r.title || "",
        url: r.url || "",
        content: r.content || "",
        engine: Array.isArray(r.engines)
          ? r.engines.join(", ")
          : r.engine || "unknown",
      }));

    return {
      query: trimmedQuery,
      count: results.length,
      results,
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `SearXNG request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

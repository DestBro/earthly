import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

const USER_AGENT = "EarthlyCity/1.0 Map MCP Server (https://earthly.city)";
const DEFAULT_MAX_LENGTH = 10_000;
const MAX_MAX_LENGTH = 50_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB

export interface FetchUrlResult {
  url: string;
  title: string | null;
  siteName: string | null;
  description: string | null;
  textContent: string;
  textLength: number;
  truncated: boolean;
  fetchedAt: string;
}

export async function fetchUrl(
  url: string,
  maxLength?: number,
): Promise<FetchUrlResult> {
  const trimmedUrl = url?.trim();
  if (!trimmedUrl) {
    throw new Error("URL parameter is required and must be non-empty");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmedUrl);
  } catch {
    throw new Error(`Invalid URL: ${trimmedUrl}`);
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error(
      `Unsupported protocol: ${parsedUrl.protocol}. Only http and https are supported.`,
    );
  }

  const cappedMaxLength = Math.min(
    Math.max(maxLength ?? DEFAULT_MAX_LENGTH, 100),
    MAX_MAX_LENGTH,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(trimmedUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      // Non-HTML: return plain text
      const text = await response.text();
      const truncated = text.length > cappedMaxLength;
      return {
        url: trimmedUrl,
        title: null,
        siteName: null,
        description: null,
        textContent: text.slice(0, cappedMaxLength),
        textLength: text.length,
        truncated,
        fetchedAt: new Date().toISOString(),
      };
    }

    // Size guard
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number.parseInt(contentLength) > MAX_RESPONSE_BYTES) {
      throw new Error(
        `Response too large: ${contentLength} bytes (max ${MAX_RESPONSE_BYTES})`,
      );
    }

    const html = await response.text();
    const { document } = parseHTML(html);

    // Extract with Readability
    // biome-ignore lint/suspicious/noExplicitAny: linkedom Document is compatible but types differ
    const reader = new Readability(document as any);
    const article = reader.parse();

    // Extract meta tags as fallbacks
    const metaDescription =
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content") || null;
    const ogDescription =
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content") || null;
    const ogSiteName =
      document
        .querySelector('meta[property="og:site_name"]')
        ?.getAttribute("content") || null;

    const fullText =
      article?.textContent || document.body?.textContent || "";
    const cleanText = fullText.replace(/\s+/g, " ").trim();
    const truncated = cleanText.length > cappedMaxLength;

    return {
      url: trimmedUrl,
      title: article?.title || document.title || null,
      siteName: article?.siteName || ogSiteName || null,
      description: metaDescription || ogDescription || null,
      textContent: cleanText.slice(0, cappedMaxLength),
      textLength: cleanText.length,
      truncated,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

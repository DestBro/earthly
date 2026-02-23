import { z } from "zod";

// ==========================================
// Web Search Schemas (SearXNG)
// ==========================================

export const webSearchResultSchema = z.object({
	title: z.string(),
	url: z.string(),
	content: z.string().describe("Snippet/summary from the search engine"),
	engine: z.string().describe("Search engine that returned this result"),
});

export const webSearchInputSchema = {
	query: z.string().describe("Search query string"),
	limit: z
		.number()
		.int()
		.min(1)
		.max(20)
		.optional()
		.describe(
			"Maximum number of results to return (default: 5, max: 20)",
		),
	categories: z
		.string()
		.optional()
		.describe(
			'SearXNG search categories, comma-separated (e.g., "general", "science", "it"). Default: "general"',
		),
	language: z
		.string()
		.optional()
		.describe(
			'Language code for results (e.g., "en", "de"). Default: "en"',
		),
};

export const webSearchOutputSchema = {
	result: z.object({
		query: z.string(),
		count: z.number(),
		results: z.array(webSearchResultSchema),
	}),
};

export type WebSearchInput = {
	query: string;
	limit?: number;
	categories?: string;
	language?: string;
};

export type WebSearchResult = {
	title: string;
	url: string;
	content: string;
	engine: string;
};

export type WebSearchOutput = {
	result: {
		query: string;
		count: number;
		results: WebSearchResult[];
	};
};

// ==========================================
// Fetch URL Schemas (Readability)
// ==========================================

export const fetchUrlInputSchema = {
	url: z
		.string()
		.url()
		.describe("The URL to fetch and extract content from"),
	maxLength: z
		.number()
		.int()
		.min(100)
		.max(50000)
		.optional()
		.describe(
			"Maximum character length of extracted text content (default: 10000)",
		),
};

export const fetchUrlOutputSchema = {
	result: z.object({
		url: z.string(),
		title: z.string().nullable(),
		siteName: z.string().nullable(),
		description: z.string().nullable(),
		textContent: z
			.string()
			.describe("Extracted readable text content"),
		textLength: z
			.number()
			.describe("Length of full extracted text before truncation"),
		truncated: z.boolean(),
		fetchedAt: z.string().describe("ISO 8601 timestamp of fetch"),
	}),
};

export type FetchUrlInput = {
	url: string;
	maxLength?: number;
};

export type FetchUrlOutput = {
	result: {
		url: string;
		title: string | null;
		siteName: string | null;
		description: string | null;
		textContent: string;
		textLength: number;
		truncated: boolean;
		fetchedAt: string;
	};
};

// ==========================================
// Wikipedia Lookup Schemas
// ==========================================

export const wikipediaArticleSchema = z.object({
	title: z.string(),
	pageId: z.number(),
	url: z.string(),
	extract: z
		.string()
		.describe("Plain text extract/summary of the article"),
	coordinates: z
		.object({
			lat: z.number(),
			lon: z.number(),
		})
		.nullable()
		.describe("Geographic coordinates if available"),
	description: z
		.string()
		.nullable()
		.describe("Short Wikidata description"),
});

export const wikipediaLookupInputSchema = {
	title: z
		.string()
		.optional()
		.describe(
			'Wikipedia article title (e.g., "Mount Everest"). Either title or lat+lon is required.',
		),
	lat: z
		.number()
		.min(-90)
		.max(90)
		.optional()
		.describe(
			"Latitude for geographic article search. Must be paired with lon.",
		),
	lon: z
		.number()
		.min(-180)
		.max(180)
		.optional()
		.describe(
			"Longitude for geographic article search. Must be paired with lat.",
		),
	radius: z
		.number()
		.int()
		.min(10)
		.max(10000)
		.optional()
		.describe(
			"Search radius in meters for geo lookup (default: 1000, max: 10000)",
		),
	limit: z
		.number()
		.int()
		.min(1)
		.max(10)
		.optional()
		.describe(
			"Max articles to return for geo search (default: 5, max: 10)",
		),
	language: z
		.string()
		.optional()
		.describe(
			'Wikipedia language code (default: "en"). Examples: "en", "de", "fr", "ja"',
		),
};

export const wikipediaLookupOutputSchema = {
	result: z.object({
		mode: z.enum(["title", "geosearch"]),
		query: z.string().describe("The title or coordinate query used"),
		count: z.number(),
		articles: z.array(wikipediaArticleSchema),
	}),
};

export type WikipediaLookupInput = {
	title?: string;
	lat?: number;
	lon?: number;
	radius?: number;
	limit?: number;
	language?: string;
};

export type WikipediaArticle = {
	title: string;
	pageId: number;
	url: string;
	extract: string;
	coordinates: { lat: number; lon: number } | null;
	description: string | null;
};

export type WikipediaLookupOutput = {
	result: {
		mode: "title" | "geosearch";
		query: string;
		count: number;
		articles: WikipediaArticle[];
	};
};

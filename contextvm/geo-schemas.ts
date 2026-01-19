import { z } from "zod";

export const nominatimLocationSchema = z.object({
	placeId: z.number(),
	displayName: z.string(),
	coordinates: z.object({
		lat: z.number(),
		lon: z.number(),
	}),
	boundingbox: z
		.tuple([z.number(), z.number(), z.number(), z.number()])
		.nullable()
		.describe("Bounding box in [west, south, east, north] order"),
	type: z.string(),
	class: z.string(),
	importance: z.number().optional(),
	address: z.record(z.string()).optional(),
	geojson: z.any().optional(),
});

export type NominatimLocation = z.infer<typeof nominatimLocationSchema>;

export const searchLocationInputSchema = {
	query: z.string().describe('The location query (e.g., "New York City")'),
	limit: z
		.number()
		.optional()
		.describe("Maximum number of results (default: 10, max: 50)"),
};

export const searchLocationOutputSchema = {
	result: z.object({
		query: z.string(),
		count: z.number(),
		results: z.array(nominatimLocationSchema),
	}),
};

export type SearchLocationInput = {
	query: string;
	limit?: number;
};

export type SearchLocationOutput = {
	result: {
		query: string;
		count: number;
		results: NominatimLocation[];
	};
};

export const reverseLookupInputSchema = {
	lat: z.number().min(-90).max(90).describe("Latitude coordinate in WGS84"),
	lon: z.number().min(-180).max(180).describe("Longitude coordinate in WGS84"),
	zoom: z
		.number()
		.optional()
		.describe("Level of detail required (0-18, default 18)"),
};

export const reverseLookupOutputSchema = {
	result: z.object({
		coordinates: z.object({
			lat: z.number(),
			lon: z.number(),
		}),
		zoom: z.number(),
		result: nominatimLocationSchema.nullable(),
	}),
};

export type ReverseLookupInput = {
	lat: number;
	lon: number;
	zoom?: number;
};

export type ReverseLookupOutput = {
	result: {
		coordinates: { lat: number; lon: number };
		zoom: number;
		result: NominatimLocation | null;
	};
};

// ==========================================
// Overpass API Schemas
// ==========================================

export const osmElementTypeSchema = z.enum(["node", "way", "relation"]);

export const osmFiltersSchema = z.record(z.string()).describe(
	'OSM tag filters. Use "*" for any value, e.g. { highway: "*" } or { highway: "primary" }'
);

export const queryByIdInputSchema = {
	osmType: osmElementTypeSchema.describe("OSM element type"),
	osmId: z.number().positive().describe("OSM element ID"),
};

export const queryByIdOutputSchema = {
	result: z.object({
		feature: z.any().nullable().describe("GeoJSON Feature or null if not found"),
		osmType: osmElementTypeSchema,
		osmId: z.number(),
	}),
};

export type QueryByIdInput = {
	osmType: "node" | "way" | "relation";
	osmId: number;
};

export type QueryByIdOutput = {
	result: {
		feature: unknown | null;
		osmType: "node" | "way" | "relation";
		osmId: number;
	};
};

export const queryNearbyInputSchema = {
	lat: z.number().min(-90).max(90).describe("Latitude coordinate"),
	lon: z.number().min(-180).max(180).describe("Longitude coordinate"),
	radius: z.number().min(1).max(5000).default(100).describe("Search radius in meters (1-5000)"),
	filters: osmFiltersSchema.optional().describe("OSM tag filters"),
	limit: z.number().min(1).max(100).optional().describe("Maximum results to return"),
};

export const queryFeaturesOutputSchema = {
	result: z.object({
		features: z.array(z.any()).describe("Array of GeoJSON Features"),
		count: z.number().describe("Number of features returned"),
	}),
};

export type QueryNearbyInput = {
	lat: number;
	lon: number;
	radius?: number;
	filters?: Record<string, string>;
	limit?: number;
};

export type QueryFeaturesOutput = {
	result: {
		features: unknown[];
		count: number;
	};
};

export const queryBboxInputSchema = {
	west: z.number().min(-180).max(180).describe("Western longitude"),
	south: z.number().min(-90).max(90).describe("Southern latitude"),
	east: z.number().min(-180).max(180).describe("Eastern longitude"),
	north: z.number().min(-90).max(90).describe("Northern latitude"),
	filters: osmFiltersSchema.optional().describe("OSM tag filters"),
	limit: z.number().min(1).max(100).optional().describe("Maximum results to return"),
};

export type QueryBboxInput = {
	west: number;
	south: number;
	east: number;
	north: number;
	filters?: Record<string, string>;
	limit?: number;
};

// ==========================================
// Create Map (PMTiles) Schemas
// ==========================================

export const createMapExtractInputSchema = {
	west: z.number().min(-180).max(180).describe("Western longitude of bounding box"),
	south: z.number().min(-90).max(90).describe("Southern latitude of bounding box"),
	east: z.number().min(-180).max(180).describe("Eastern longitude of bounding box"),
	north: z.number().min(-90).max(90).describe("Northern latitude of bounding box"),
	maxZoom: z.number().int().min(0).max(16).default(14).describe("Maximum zoom level (0-16, default 14)"),
	blossomServer: z.string().url().describe("Blossom server URL for upload"),
};

export const unsignedEventSchema = z.object({
	kind: z.number(),
	created_at: z.number(),
	tags: z.array(z.array(z.string())),
	content: z.string(),
});

export const createMapExtractOutputSchema = {
	result: z.object({
		requestId: z.string().describe("Unique ID to reference this extraction"),
		sha256: z.string().describe("SHA-256 hash of the extracted PMTiles file"),
		fileSizeBytes: z.number().describe("Size of the extracted file in bytes"),
		areaSqKm: z.number().describe("Area of the bounding box in square kilometers"),
		unsignedEvent: unsignedEventSchema.describe("Unsigned Blossom auth event (kind 24242) for client to sign"),
	}),
};

export type CreateMapExtractInput = {
	west: number;
	south: number;
	east: number;
	north: number;
	maxZoom?: number;
	blossomServer: string;
};

export type CreateMapExtractOutput = {
	result: {
		requestId: string;
		sha256: string;
		fileSizeBytes: number;
		areaSqKm: number;
		unsignedEvent: {
			kind: number;
			created_at: number;
			tags: string[][];
			content: string;
		};
	};
};

export const signedEventSchema = z.object({
	id: z.string(),
	pubkey: z.string(),
	kind: z.number(),
	created_at: z.number(),
	tags: z.array(z.array(z.string())),
	content: z.string(),
	sig: z.string(),
});

export const createMapUploadInputSchema = {
	requestId: z.string().describe("Request ID from create_map_extract"),
	signedEvent: signedEventSchema.describe("Signed Blossom auth event from client"),
};

export const createMapUploadOutputSchema = {
	result: z.object({
		blobUrl: z.string().describe("URL of the uploaded PMTiles file"),
		sha256: z.string().describe("SHA-256 hash of the uploaded file"),
	}),
};

export type CreateMapUploadInput = {
	requestId: string;
	signedEvent: {
		id: string;
		pubkey: string;
		kind: number;
		created_at: number;
		tags: string[][];
		content: string;
		sig: string;
	};
};

export type CreateMapUploadOutput = {
	result: {
		blobUrl: string;
		sha256: string;
	};
};

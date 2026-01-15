import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

// Multiple Overpass API endpoints for failover
const OVERPASS_ENDPOINTS = [
	"https://overpass-api.de/api/interpreter",
	"https://overpass.kumi.systems/api/interpreter",
	"https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];
const USER_AGENT = "EarthlyCity/1.0 Map MCP Server (https://earthly.city)";

// OSM element types
export type OsmElementType = "node" | "way" | "relation";

// Filter format: { highway: "*" } means any highway, { highway: "primary" } means specific value
export type OsmFilters = Record<string, string>;

// Raw Overpass API response shapes
interface OverpassNode {
	type: "node";
	id: number;
	lat: number;
	lon: number;
	tags?: Record<string, string>;
}

interface OverpassWay {
	type: "way";
	id: number;
	nodes?: number[];
	geometry?: { lat: number; lon: number }[];
	tags?: Record<string, string>;
}

interface OverpassRelation {
	type: "relation";
	id: number;
	members?: {
		type: string;
		ref: number;
		role: string;
		geometry?: { lat: number; lon: number }[];
	}[];
	tags?: Record<string, string>;
}

type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

interface OverpassResponse {
	version: number;
	generator: string;
	elements: OverpassElement[];
}

// Result types
export interface QueryByIdResult {
	feature: Feature | null;
	osmType: OsmElementType;
	osmId: number;
}

export interface QueryFeaturesResult {
	features: Feature[];
	count: number;
}

/**
 * Execute an Overpass QL query with automatic failover between endpoints
 */
async function executeQuery(query: string): Promise<OverpassResponse> {
	let lastError: Error | null = null;
	
	for (const endpoint of OVERPASS_ENDPOINTS) {
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout
			
			const response = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					"User-Agent": USER_AGENT,
				},
				body: `data=${encodeURIComponent(query)}`,
				signal: controller.signal,
			});
			
			clearTimeout(timeoutId);

			if (!response.ok) {
				const text = await response.text();
				// If 504 or 429, try next endpoint
				if (response.status === 504 || response.status === 429 || response.status === 503) {
					console.warn(`Overpass ${endpoint} returned ${response.status}, trying next...`);
					lastError = new Error(`${response.status} - ${text.slice(0, 100)}`);
					continue;
				}
				throw new Error(`Overpass API error: ${response.status} - ${text.slice(0, 200)}`);
			}

			const data = await response.json();
			console.log(`✅ Overpass ${endpoint} returned ${data.elements?.length ?? 0} elements`);
			if (data.elements?.length > 0) {
				console.log(`   Sample element types: ${data.elements.slice(0, 5).map((e: any) => e.type).join(', ')}`);
			}
			return data;
		} catch (err: any) {
			// On timeout or network error, try next endpoint
			if (err.name === 'AbortError') {
				console.warn(`Overpass ${endpoint} timed out, trying next...`);
				lastError = new Error(`Request timeout`);
				continue;
			}
			lastError = err;
			console.warn(`Overpass ${endpoint} failed: ${err.message}, trying next...`);
		}
	}
	
	throw new Error(`All Overpass endpoints failed. Last error: ${lastError?.message || 'Unknown'}`);
}

/**
 * Build filter string from OsmFilters object
 * { highway: "*" } -> ["highway"]
 * { highway: "primary" } -> ["highway"="primary"]
 * { highway: "primary", surface: "asphalt" } -> ["highway"="primary"]["surface"="asphalt"]
 */
function buildFilterString(filters: OsmFilters): string {
	return Object.entries(filters)
		.map(([key, value]) => {
			if (value === "*") {
				return `["${key}"]`;
			}
			return `["${key}"="${value}"]`;
		})
		.join("");
}

/**
 * Convert Overpass node to GeoJSON Point
 */
function nodeToFeature(node: OverpassNode): Feature {
	return {
		type: "Feature",
		id: `node/${node.id}`,
		properties: {
			"@id": `node/${node.id}`,
			"@type": "node",
			...node.tags,
		},
		geometry: {
			type: "Point",
			coordinates: [node.lon, node.lat],
		},
	};
}

/**
 * Check if a way should be treated as a polygon (closed + area-like tags)
 */
function isPolygonWay(way: OverpassWay): boolean {
	if (!way.geometry || way.geometry.length < 4) return false;
	
	const first = way.geometry[0];
	const last = way.geometry[way.geometry.length - 1];
	if (!first || !last) return false;
	const isClosed = first.lat === last.lat && first.lon === last.lon;
	
	if (!isClosed) return false;
	
	// Check for area-indicating tags
	const areaTags = ["building", "landuse", "natural", "leisure", "amenity", "shop", "tourism", "area"];
	return areaTags.some(tag => way.tags?.[tag] !== undefined) || way.tags?.area === "yes";
}

/**
 * Convert Overpass way to GeoJSON Feature (LineString or Polygon)
 */
function wayToFeature(way: OverpassWay): Feature | null {
	if (!way.geometry || way.geometry.length < 2) {
		return null;
	}

	const coordinates: Position[] = way.geometry.map((p) => [p.lon, p.lat]);
	
	let geometry: Geometry;
	if (isPolygonWay(way)) {
		geometry = {
			type: "Polygon",
			coordinates: [coordinates],
		};
	} else {
		geometry = {
			type: "LineString",
			coordinates,
		};
	}

	return {
		type: "Feature",
		id: `way/${way.id}`,
		properties: {
			"@id": `way/${way.id}`,
			"@type": "way",
			...way.tags,
		},
		geometry,
	};
}

/**
 * Convert Overpass relation to GeoJSON Feature (MultiPolygon or GeometryCollection)
 */
function relationToFeature(relation: OverpassRelation): Feature | null {
	if (!relation.members || relation.members.length === 0) {
		return null;
	}

	const isMultipolygon = relation.tags?.type === "multipolygon" || relation.tags?.type === "boundary";

	if (isMultipolygon) {
		// Collect outer and inner rings
		const outers: Position[][] = [];
		const inners: Position[][] = [];

		for (const member of relation.members) {
			if (!member.geometry || member.geometry.length < 2) continue;
			
			const ring: Position[] = member.geometry.map((p) => [p.lon, p.lat]);
			
			if (member.role === "outer") {
				outers.push(ring);
			} else if (member.role === "inner") {
				inners.push(ring);
			}
		}

		if (outers.length === 0) return null;

		// Simple case: single outer with potential inners
		if (outers.length === 1 && outers[0]) {
			const polygonRings: Position[][] = [outers[0], ...inners];
			return {
				type: "Feature",
				id: `relation/${relation.id}`,
				properties: {
					"@id": `relation/${relation.id}`,
					"@type": "relation",
					...relation.tags,
				},
				geometry: {
					type: "Polygon",
					coordinates: polygonRings,
				},
			};
		}

		// Multiple outers: MultiPolygon (simplified - not matching inners to outers)
		return {
			type: "Feature",
			id: `relation/${relation.id}`,
			properties: {
				"@id": `relation/${relation.id}`,
				"@type": "relation",
				...relation.tags,
			},
			geometry: {
				type: "MultiPolygon",
				coordinates: outers.map((outer) => [outer]),
			},
		};
	}

	// For route relations and other linear relations, create a MultiLineString
	const lines: Position[][] = [];
	for (const member of relation.members) {
		if (!member.geometry || member.geometry.length < 2) continue;
		lines.push(member.geometry.map((p) => [p.lon, p.lat]));
	}

	if (lines.length === 0) return null;

	if (lines.length === 1 && lines[0]) {
		return {
			type: "Feature",
			id: `relation/${relation.id}`,
			properties: {
				"@id": `relation/${relation.id}`,
				"@type": "relation",
				...relation.tags,
			},
			geometry: {
				type: "LineString",
				coordinates: lines[0],
			},
		};
	}

	return {
		type: "Feature",
		id: `relation/${relation.id}`,
		properties: {
			"@id": `relation/${relation.id}`,
			"@type": "relation",
			...relation.tags,
		},
		geometry: {
			type: "MultiLineString",
			coordinates: lines,
		},
	};
}

/**
 * Convert Overpass element to GeoJSON Feature
 */
function elementToFeature(element: OverpassElement): Feature | null {
	switch (element.type) {
		case "node":
			return nodeToFeature(element);
		case "way":
			return wayToFeature(element);
		case "relation":
			return relationToFeature(element);
		default:
			return null;
	}
}

/**
 * Query a single OSM element by type and ID
 */
export async function queryById(
	osmType: OsmElementType,
	osmId: number,
): Promise<QueryByIdResult> {
	if (osmId <= 0) {
		throw new Error("OSM ID must be a positive number");
	}

	const query = `[out:json][timeout:25];${osmType}(${osmId});out geom;`;
	const response = await executeQuery(query);

	const element = response.elements[0];
	const feature = element ? elementToFeature(element) : null;

	return {
		feature,
		osmType,
		osmId,
	};
}

/**
 * Query OSM elements near a point
 */
export async function queryNearby(
	lat: number,
	lon: number,
	radius: number = 100,
	filters?: OsmFilters,
	limit?: number,
): Promise<QueryFeaturesResult> {
	if (lat < -90 || lat > 90) {
		throw new Error("Latitude must be between -90 and 90");
	}
	if (lon < -180 || lon > 180) {
		throw new Error("Longitude must be between -180 and 180");
	}
	if (radius < 1 || radius > 5000) {
		throw new Error("Radius must be between 1 and 5000 meters");
	}

	const filterStr = filters ? buildFilterString(filters) : "";
	const around = `(around:${radius},${lat},${lon})`;

	// Query only nodes and ways (relations are heavy and slow)
	// Use shorter timeout to fail fast and allow retry
	const query = `[out:json][timeout:15];
(
  node${filterStr}${around};
  way${filterStr}${around};
);
out geom;`;

	const response = await executeQuery(query);

	let features = response.elements
		.map(elementToFeature)
		.filter((f): f is Feature => f !== null);

	// Apply limit if specified
	if (limit && limit > 0) {
		features = features.slice(0, limit);
	}

	return {
		features,
		count: features.length,
	};
}

/**
 * Query OSM elements within a bounding box
 */
export async function queryBbox(
	west: number,
	south: number,
	east: number,
	north: number,
	filters?: OsmFilters,
	limit?: number,
): Promise<QueryFeaturesResult> {
	if (south < -90 || south > 90 || north < -90 || north > 90) {
		throw new Error("Latitude must be between -90 and 90");
	}
	if (west < -180 || west > 180 || east < -180 || east > 180) {
		throw new Error("Longitude must be between -180 and 180");
	}
	if (south >= north) {
		throw new Error("South must be less than north");
	}

	const filterStr = filters ? buildFilterString(filters) : "";
	const bbox = `(${south},${west},${north},${east})`;

	// Query only nodes and ways (relations are heavy and slow)
	const query = `[out:json][timeout:15];
(
  node${filterStr}${bbox};
  way${filterStr}${bbox};
);
out geom;`;

	const response = await executeQuery(query);

	let features = response.elements
		.map(elementToFeature)
		.filter((f): f is Feature => f !== null);

	// Apply limit if specified
	if (limit && limit > 0) {
		features = features.slice(0, limit);
	}

	return {
		features,
		count: features.length,
	};
}

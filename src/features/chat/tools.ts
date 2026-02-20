/**
 * Tool definitions for AI chat
 * Maps EarthlyGeoServer tools + local map editor actions
 * to OpenAI function calling format.
 */

import { EarthlyGeoServerClient } from "@/ctxcn/EarthlyGeoServerClient";
import type { EditorFeature } from "@/features/geo-editor/core";
import { useEditorStore } from "@/features/geo-editor/store";

// OpenAI function calling tool definition
export interface Tool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<
        string,
        {
          type: string;
          description: string;
          enum?: string[];
        }
      >;
      required?: string[];
    };
  };
}

// Tool call from API response
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

// Tool call result to send back
export interface ToolResult {
  tool_call_id: string;
  role: "tool";
  content: string;
}

const DEFAULT_QUERY_LIMIT = 50;
const DEFAULT_IMPORT_LIMIT = 100;
const MAX_QUERY_LIMIT = 500;
const NAME_MATCH_KEYS = [
  "name",
  "name:en",
  "name:de",
  "name:fr",
  "int_name",
  "official_name",
  "short_name",
  "alt_name",
];

// Define available tools
export const geoTools: Tool[] = [
  {
    type: "function",
    function: {
      name: "get_editor_state",
      description:
        "Get current map editor context (center, zoom, viewport bbox, feature count, mode). Use this before map-editing operations.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_location",
      description:
        "Search for locations by name using OpenStreetMap. Returns coordinates, bounding boxes, and addresses.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'The location query (e.g., "New York City", "Eiffel Tower")',
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default: 5, max: 50)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reverse_lookup",
      description:
        "Get address information for coordinates. Useful for identifying what is at a specific location.",
      parameters: {
        type: "object",
        properties: {
          lat: {
            type: "number",
            description: "Latitude coordinate in WGS84",
          },
          lon: {
            type: "number",
            description: "Longitude coordinate in WGS84",
          },
          zoom: {
            type: "number",
            description:
              "Level of detail (0-18, default 18). Lower = less detail.",
          },
        },
        required: ["lat", "lon"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_osm_by_id",
      description:
        "Fetch one exact OpenStreetMap element by type and ID (node/way/relation).",
      parameters: {
        type: "object",
        properties: {
          osmType: {
            type: "string",
            description: "OSM element type",
            enum: ["node", "way", "relation"],
          },
          osmId: {
            type: "number",
            description: "OSM element numeric ID",
          },
        },
        required: ["osmType", "osmId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_osm_nearby",
      description:
        "Find OpenStreetMap features near a point. Can filter by tags like amenity=cafe, shop=supermarket.",
      parameters: {
        type: "object",
        properties: {
          lat: {
            type: "number",
            description: "Latitude coordinate",
          },
          lon: {
            type: "number",
            description: "Longitude coordinate",
          },
          radius: {
            type: "number",
            description: "Search radius in meters (1-5000, default 500)",
          },
          filters: {
            type: "object",
            description:
              'OSM tag filters like {"amenity": "cafe"} or {"shop": "supermarket"}',
          },
          limit: {
            type: "number",
            description: "Maximum results to return (default 10)",
          },
        },
        required: ["lat", "lon"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_osm_bbox",
      description:
        "Find OpenStreetMap features within a bounding box. Can filter by tags.",
      parameters: {
        type: "object",
        properties: {
          west: {
            type: "number",
            description: "Western longitude of bounding box",
          },
          south: {
            type: "number",
            description: "Southern latitude of bounding box",
          },
          east: {
            type: "number",
            description: "Eastern longitude of bounding box",
          },
          north: {
            type: "number",
            description: "Northern latitude of bounding box",
          },
          filters: {
            type: "object",
            description: 'OSM tag filters like {"amenity": "restaurant"}',
          },
          limit: {
            type: "number",
            description: "Maximum results to return (default 10)",
          },
        },
        required: ["west", "south", "east", "north"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "import_osm_to_editor",
      description:
        'Query OSM and import matching features directly into the map editor. For rivers/roads/buildings, pass filters (example: {"waterway":"river"}). If bbox/point are omitted, it uses current map viewport, then falls back to search_location(name).',
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: 'Target feature name to match (example: "Rhine").',
          },
          west: {
            type: "number",
            description: "Optional bbox west longitude.",
          },
          south: {
            type: "number",
            description: "Optional bbox south latitude.",
          },
          east: {
            type: "number",
            description: "Optional bbox east longitude.",
          },
          north: {
            type: "number",
            description: "Optional bbox north latitude.",
          },
          lat: {
            type: "number",
            description:
              "Optional point latitude (uses nearby query when paired with lon).",
          },
          lon: {
            type: "number",
            description:
              "Optional point longitude (uses nearby query when paired with lat).",
          },
          radius: {
            type: "number",
            description: "Nearby query radius in meters (default 500).",
          },
          filters: {
            type: "object",
            description:
              'Optional OSM tag filters (example: {"waterway":"river"}).',
          },
          limit: {
            type: "number",
            description:
              "Max OSM features to fetch before filtering by name (default 100, max 500).",
          },
          replaceExisting: {
            type: "boolean",
            description:
              "If true, replace all editor features with imported set. Default false (append).",
          },
        },
        required: ["name"],
      },
    },
  },
];

// Singleton client instance
let geoClient: EarthlyGeoServerClient | null = null;

/**
 * Get or create the geo client instance
 */
export function getGeoClient(): EarthlyGeoServerClient {
  if (!geoClient) {
    geoClient = new EarthlyGeoServerClient();
  }
  return geoClient;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function hasExplicitBbox(args: Record<string, unknown>): boolean {
  return (
    toFiniteNumber(args.west) !== undefined &&
    toFiniteNumber(args.south) !== undefined &&
    toFiniteNumber(args.east) !== undefined &&
    toFiniteNumber(args.north) !== undefined
  );
}

function hasExplicitPoint(args: Record<string, unknown>): boolean {
  return (
    toFiniteNumber(args.lat) !== undefined &&
    toFiniteNumber(args.lon) !== undefined
  );
}

function clampLimit(value: unknown, fallback: number): number {
  const numeric = toFiniteNumber(value);
  if (numeric === undefined) return fallback;
  return Math.max(1, Math.min(MAX_QUERY_LIMIT, Math.floor(numeric)));
}

function normalizeFilters(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: Record<string, string> = {};

  for (const [key, raw] of entries) {
    if (
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      normalized[key] = String(raw);
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function asFeatureObject(value: unknown): GeoJSON.Feature | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as GeoJSON.Feature;
  if (!candidate.geometry || typeof candidate.geometry !== "object")
    return null;
  return candidate;
}

function featureStableId(feature: GeoJSON.Feature): string {
  const rawId = feature.id;
  if (typeof rawId === "string" || typeof rawId === "number") {
    return String(rawId);
  }

  const props = feature.properties;
  if (props && typeof props === "object") {
    const atId = (props as Record<string, unknown>)["@id"];
    if (typeof atId === "string" || typeof atId === "number") {
      return String(atId);
    }
  }

  return crypto.randomUUID();
}

function toEditorFeature(feature: GeoJSON.Feature): EditorFeature {
  const stableId = featureStableId(feature);
  const sourceProps = (feature.properties || {}) as Record<string, unknown>;

  return {
    ...feature,
    id: stableId,
    properties: {
      ...sourceProps,
      meta: "feature",
      featureId: stableId,
      importSource: "chat_tool",
    },
  } as EditorFeature;
}

function getEditorViewportBbox(): [number, number, number, number] | null {
  const { editor } = useEditorStore.getState();
  return editor?.getMapBounds() ?? null;
}

function featureMatchesName(
  feature: GeoJSON.Feature,
  targetName: string,
): boolean {
  const lowerTarget = targetName.toLowerCase();
  const props = feature.properties;
  if (!props || typeof props !== "object") return false;

  for (const key of NAME_MATCH_KEYS) {
    const rawValue = (props as Record<string, unknown>)[key];
    if (
      typeof rawValue === "string" &&
      rawValue.toLowerCase().includes(lowerTarget)
    ) {
      return true;
    }
  }

  return false;
}

function importFeaturesToEditor(
  features: GeoJSON.Feature[],
  replaceExisting: boolean,
) {
  const { editor, setFeatures } = useEditorStore.getState();
  if (!editor) {
    throw new Error(
      "Map editor is not ready. Open the map editor first, then try again.",
    );
  }

  const normalized = features.map(toEditorFeature);
  if (normalized.length === 0) {
    throw new Error("No valid GeoJSON features available to import.");
  }

  if (replaceExisting) {
    editor.setFeatures(normalized);
    setFeatures(normalized);
    return {
      importedCount: normalized.length,
      skippedDuplicates: 0,
      totalFeaturesInEditor: normalized.length,
    };
  }

  const existingIds = new Set(
    editor.getAllFeatures().map((feature) => feature.id),
  );
  let importedCount = 0;
  let skippedDuplicates = 0;

  for (const feature of normalized) {
    if (existingIds.has(feature.id)) {
      skippedDuplicates += 1;
      continue;
    }

    editor.addFeature(feature);
    existingIds.add(feature.id);
    importedCount += 1;
  }

  return {
    importedCount,
    skippedDuplicates,
    totalFeaturesInEditor: editor.getAllFeatures().length,
  };
}

function ensureBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [west, south, east, north] = value;
  if (
    typeof west !== "number" ||
    typeof south !== "number" ||
    typeof east !== "number" ||
    typeof north !== "number"
  ) {
    return null;
  }
  return [west, south, east, north];
}

/**
 * Execute a tool call and return the result
 */
export async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
  const client = getGeoClient();

  try {
    const args = (
      toolCall.function.arguments?.trim()
        ? JSON.parse(toolCall.function.arguments)
        : {}
    ) as Record<string, unknown>;

    let result: unknown;

    switch (toolCall.function.name) {
      case "get_editor_state": {
        const store = useEditorStore.getState();
        const viewport = store.editor?.getMapBounds() ?? store.currentBbox;
        const center = store.editor?.getMapCenter() ?? null;
        const zoom = store.editor?.getMapZoom() ?? null;
        result = {
          editorReady: Boolean(store.editor),
          mode: store.mode,
          featureCount: store.features.length,
          selectedFeatureCount: store.selectedFeatureIds.length,
          viewportBbox: viewport,
          mapCenter: center,
          mapZoom: zoom,
          mapView: {
            center,
            zoom,
            bbox: viewport,
          },
        };
        break;
      }
      case "search_location": {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) {
          throw new Error("query must be a non-empty string");
        }
        const response = await client.SearchLocation(
          query,
          clampLimit(args.limit, 5),
        );
        result = response.result;
        break;
      }
      case "reverse_lookup": {
        const lat = toFiniteNumber(args.lat);
        const lon = toFiniteNumber(args.lon);
        const zoom = toFiniteNumber(args.zoom);
        if (lat === undefined || lon === undefined) {
          throw new Error("lat and lon must be valid numbers");
        }
        const response = await client.ReverseLookup(lat, lon, zoom);
        result = response.result;
        break;
      }
      case "query_osm_by_id": {
        const osmId = toFiniteNumber(args.osmId);
        if (
          typeof args.osmType !== "string" ||
          !["node", "way", "relation"].includes(args.osmType)
        ) {
          throw new Error("osmType must be one of: node, way, relation");
        }
        if (osmId === undefined) {
          throw new Error("osmId must be a valid number");
        }
        const response = await client.QueryOsmById(
          args.osmType,
          Math.floor(osmId),
        );
        result = response.result;
        break;
      }
      case "query_osm_nearby": {
        const lat = toFiniteNumber(args.lat);
        const lon = toFiniteNumber(args.lon);
        const radius = toFiniteNumber(args.radius);
        if (lat === undefined || lon === undefined) {
          throw new Error("lat and lon must be valid numbers");
        }
        const response = await client.QueryOsmNearby(
          lat,
          lon,
          radius,
          normalizeFilters(args.filters),
          clampLimit(args.limit, DEFAULT_QUERY_LIMIT),
        );
        result = response.result;
        break;
      }
      case "query_osm_bbox": {
        if (!hasExplicitBbox(args)) {
          throw new Error(
            "west, south, east, and north are required and must be numbers",
          );
        }
        const west = toFiniteNumber(args.west) as number;
        const south = toFiniteNumber(args.south) as number;
        const east = toFiniteNumber(args.east) as number;
        const north = toFiniteNumber(args.north) as number;
        const response = await client.QueryOsmBbox(
          west,
          south,
          east,
          north,
          normalizeFilters(args.filters),
          clampLimit(args.limit, DEFAULT_QUERY_LIMIT),
        );
        result = response.result;
        break;
      }
      case "import_osm_to_editor": {
        const name = typeof args.name === "string" ? args.name.trim() : "";
        if (!name) {
          throw new Error("name is required");
        }

        const limit = clampLimit(args.limit, DEFAULT_IMPORT_LIMIT);
        const replaceExisting = Boolean(args.replaceExisting);
        const filters = normalizeFilters(args.filters);

        let source = "viewport";
        let usedBbox: [number, number, number, number] | null = null;
        let rawFeatures: unknown[] = [];

        if (hasExplicitPoint(args)) {
          source = "nearby";
          const lat = toFiniteNumber(args.lat) as number;
          const lon = toFiniteNumber(args.lon) as number;
          const response = await client.QueryOsmNearby(
            lat,
            lon,
            clampLimit(args.radius, 500),
            filters,
            limit,
          );
          rawFeatures = Array.isArray(response.result.features)
            ? response.result.features
            : [];
        } else {
          if (hasExplicitBbox(args)) {
            source = "bbox";
            usedBbox = [
              toFiniteNumber(args.west) as number,
              toFiniteNumber(args.south) as number,
              toFiniteNumber(args.east) as number,
              toFiniteNumber(args.north) as number,
            ];
          } else {
            usedBbox = getEditorViewportBbox();
            if (!usedBbox) {
              source = "search_location";
              const searchResponse = await client.SearchLocation(name, 1);
              const first = searchResponse.result.results[0];
              usedBbox = ensureBbox(first?.boundingbox);

              if (!usedBbox) {
                throw new Error(
                  "No map viewport available and location search did not return a bounding box.",
                );
              }
            }
          }

          const response = await client.QueryOsmBbox(
            usedBbox[0],
            usedBbox[1],
            usedBbox[2],
            usedBbox[3],
            filters,
            limit,
          );
          rawFeatures = Array.isArray(response.result.features)
            ? response.result.features
            : [];
        }

        const validFeatures = rawFeatures
          .map(asFeatureObject)
          .filter((feature): feature is GeoJSON.Feature => feature !== null);
        const matchedByName = validFeatures.filter((feature) =>
          featureMatchesName(feature, name),
        );
        const selected =
          matchedByName.length > 0 ? matchedByName : validFeatures;

        const importResult = importFeaturesToEditor(selected, replaceExisting);

        result = {
          source,
          name,
          filters: filters ?? null,
          usedBbox,
          queryResultCount: validFeatures.length,
          nameMatchedCount: matchedByName.length,
          importedCount: importResult.importedCount,
          skippedDuplicates: importResult.skippedDuplicates,
          totalFeaturesInEditor: importResult.totalFeaturesInEditor,
          replaceExisting,
          warning:
            matchedByName.length === 0
              ? "No name-matching features found; imported unfiltered query results."
              : null,
        };
        break;
      }
      default:
        throw new Error(`Unknown tool: ${toolCall.function.name}`);
    }

    return {
      tool_call_id: toolCall.id,
      role: "tool",
      content: JSON.stringify(result, null, 2),
    };
  } catch (error) {
    return {
      tool_call_id: toolCall.id,
      role: "tool",
      content: JSON.stringify({
        error: error instanceof Error ? error.message : "Tool execution failed",
      }),
    };
  }
}

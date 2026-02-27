/**
 * Tool definitions for AI chat
 * Maps EarthlyGeoServer tools + local map editor actions
 * to OpenAI function calling format.
 */

import { EarthlyGeoServerClient } from "@/ctxcn/EarthlyGeoServerClient";
import type { EditorFeature } from "@/features/geo-editor/core";
import {
  executeEditorAiTool,
  getEditorAiToolDefinitions,
} from "@/features/geo-editor/commands";
import { useEditorStore } from "@/features/geo-editor/store";
import { isStyleProperty } from "@/features/geo-editor/types/styleProperties";
import type { ChatMessage } from "./routstr";

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

export interface GeometryBakeAnalysis {
  canBake: boolean;
  featureCount: number;
  geometryTypeCounts: Record<string, number>;
  reason?: string;
}

export interface GeometryBakeResult {
  importedCount: number;
  skippedDuplicates: number;
  totalFeaturesInEditor: number;
  replaceExisting: boolean;
  extractedFeatureCount: number;
  geometryTypeCounts: Record<string, number>;
}

const DEFAULT_QUERY_LIMIT = 50;
const DEFAULT_IMPORT_LIMIT = 100;
const DEFAULT_NEARBY_RADIUS_METERS = 500;
const MAX_NEARBY_RADIUS_METERS = 5000;
const MAX_QUERY_LIMIT = 500;
const DEFAULT_SNAPSHOT_MAX_WIDTH = 1024;
const DEFAULT_SNAPSHOT_MAX_HEIGHT = 768;
const MAX_SNAPSHOT_CACHE_SIZE = 5;
const MAX_GEOJSON_TEXT_CHARS = 200000;
const TO_EDITOR_COMPATIBLE_TOOLS = new Set([
  "query_osm_by_id",
  "query_osm_nearby",
  "query_osm_bbox",
  "get_osm_relation_geometry",
  "get_country_boundary",
  "valhalla_route",
  "valhalla_isochrone",
]);
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
const NON_CUSTOM_EDITOR_PROPERTY_KEYS = new Set([
  "meta",
  "active",
  "mode",
  "parent",
  "coord_path",
  "featureId",
  "importSource",
  "customProperties",
  "name",
  "description",
  "featureType",
  "text",
  "textFontSize",
  "textColor",
  "textHaloColor",
  "textHaloWidth",
]);

interface CachedMapSnapshot {
  snapshotId: string;
  dataUrl: string;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  createdAt: number;
  mapCenter: { lat: number; lon: number } | null;
  mapZoom: number | null;
  mapBbox: [number, number, number, number] | null;
}

const mapSnapshotCache = new Map<string, CachedMapSnapshot>();
const editorCommandTools: Tool[] = getEditorAiToolDefinitions().map((tool) => ({
  type: "function",
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}));

// Define available tools
export const geoTools: Tool[] = [
  {
    type: "function",
    function: {
      name: "get_editor_state",
      description:
        "Get current map editor context (center, zoom, viewport bbox, feature count, mode). Returns compact output by default; use detail='full' only when needed.",
      parameters: {
        type: "object",
        properties: {
          detail: {
            type: "string",
            description:
              "Response detail level. 'compact' (default) omits large arrays like visible dataset ids. 'full' returns the full snapshot.",
            enum: ["compact", "full"],
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "capture_map_snapshot",
      description:
        "Capture the current map viewport as a PNG/JPEG snapshot. Returns a snapshotId that can be forwarded to vision-capable models.",
      parameters: {
        type: "object",
        properties: {
          mimeType: {
            type: "string",
            description: "Output image type",
            enum: ["image/png", "image/jpeg"],
          },
          quality: {
            type: "number",
            description:
              "JPEG quality from 0 to 1 (ignored for PNG, default 0.9).",
          },
          maxWidth: {
            type: "number",
            description: "Optional max output width in pixels (default 1024).",
          },
          maxHeight: {
            type: "number",
            description: "Optional max output height in pixels (default 768).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_geojson_to_editor",
      description:
        "Create features in the editor from GeoJSON. Accepts FeatureCollection, Feature, or Geometry. Use this for custom shapes and direct map edits. Prefer geojson object arguments; avoid large escaped JSON strings in geojsonText.",
      parameters: {
        type: "object",
        properties: {
          geojson: {
            type: "object",
            description:
              "GeoJSON payload. Can be a FeatureCollection, Feature, or Geometry object.",
          },
          geojsonText: {
            type: "string",
            description:
              "GeoJSON payload as a JSON string. Use as fallback if object arguments are hard to produce.",
          },
          replaceExisting: {
            type: "boolean",
            description:
              "If true, replace all current editor features with the provided GeoJSON. Default false (append).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_feature_to_editor",
      description:
        "Add one generated GeoJSON feature to the editor. Preferred for direct LLM-authored geometry edits. Keep arguments compact and strictly valid JSON.",
      parameters: {
        type: "object",
        properties: {
          feature: {
            type: "object",
            description:
              "Optional full GeoJSON Feature object. If provided, geometry/properties/id fields are ignored.",
          },
          geometry: {
            type: "object",
            description:
              "GeoJSON Geometry object (Point, LineString, Polygon, etc). Use this when passing a feature piecemeal.",
          },
          properties: {
            type: "object",
            description: "Optional GeoJSON feature properties object.",
          },
          id: {
            type: "string",
            description:
              "Optional feature id (string/number accepted; converted to string).",
          },
          replaceExisting: {
            type: "boolean",
            description:
              "If true, replace existing editor features before adding this feature. Default false (append).",
          },
        },
      },
    },
  },
  ...editorCommandTools,
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
          toEditor: {
            type: "boolean",
            description:
              "If true, import returned geometry directly into editor and return a compact import summary.",
          },
          replaceExisting: {
            type: "boolean",
            description:
              "Used when toEditor=true. If true, replaces current editor features.",
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
        "Find OpenStreetMap features near a point. Can filter by tags like amenity=cafe, shop=supermarket. Set includeRelations=true for boundaries and route relations.",
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
          includeRelations: {
            type: "boolean",
            description:
              "If true, include OSM relations in results (heavier but required for many boundaries).",
          },
          toEditor: {
            type: "boolean",
            description:
              "If true, import returned geometries directly into editor and return a compact import summary.",
          },
          replaceExisting: {
            type: "boolean",
            description:
              "Used when toEditor=true. If true, replaces current editor features.",
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
        "Find OpenStreetMap features within a bounding box. Can filter by tags. Set includeRelations=true for administrative boundaries.",
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
          includeRelations: {
            type: "boolean",
            description:
              "If true, include OSM relations (recommended for administrative boundaries).",
          },
          toEditor: {
            type: "boolean",
            description:
              "If true, import returned geometries directly into editor and return a compact import summary.",
          },
          replaceExisting: {
            type: "boolean",
            description:
              "Used when toEditor=true. If true, replaces current editor features.",
          },
        },
        required: ["west", "south", "east", "north"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resolve_osm_entity",
      description:
        "Resolve a name/place to concrete OSM IDs before importing (best first step for administrative boundaries).",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Entity name, e.g. 'Vienna', 'Germany', 'Rhine'.",
          },
          limit: {
            type: "number",
            description: "Maximum candidates (default 5, max 10).",
          },
          preferredOsmType: {
            type: "string",
            description: "Prefer this OSM type.",
            enum: ["node", "way", "relation"],
          },
          adminLevel: {
            type: "number",
            description:
              "Optional admin level filter (2 country, 4 region/state, etc).",
          },
          countryCode: {
            type: "string",
            description:
              "Optional ISO-2 country code to constrain matches, e.g. 'AT'.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_osm_relation_geometry",
      description:
        "Fetch one OSM relation by id and assemble geometry. Use after resolve_osm_entity for clean boundary imports.",
      parameters: {
        type: "object",
        properties: {
          relationId: {
            type: "number",
            description: "OSM relation id.",
          },
          coordinatePrecision: {
            type: "number",
            description: "Optional coordinate decimal precision (3-7).",
          },
          maxPointsPerRing: {
            type: "number",
            description: "Optional max vertices per ring/path (50-20000).",
          },
          toEditor: {
            type: "boolean",
            description:
              "If true, import the relation geometry directly into editor and return a compact import summary.",
          },
          replaceExisting: {
            type: "boolean",
            description:
              "Used when toEditor=true. If true, replaces current editor features.",
          },
        },
        required: ["relationId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_country_boundary",
      description:
        "Get a country administrative boundary relation (admin_level=2 by default) with cleaner geometry than generic bbox lookup.",
      parameters: {
        type: "object",
        properties: {
          countryCode: {
            type: "string",
            description: "ISO alpha-2 code, e.g. 'AT'.",
          },
          name: {
            type: "string",
            description:
              "Fallback country name when countryCode isn't provided.",
          },
          adminLevel: {
            type: "number",
            description: "Boundary admin level (default 2).",
          },
          coordinatePrecision: {
            type: "number",
            description: "Optional coordinate precision (3-7).",
          },
          maxPointsPerRing: {
            type: "number",
            description: "Optional max vertices per ring/path.",
          },
          toEditor: {
            type: "boolean",
            description:
              "If true, import the boundary geometry directly into editor and return a compact import summary.",
          },
          replaceExisting: {
            type: "boolean",
            description:
              "Used when toEditor=true. If true, replaces current editor features.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "valhalla_route",
      description:
        "Compute a route polyline from waypoints using Valhalla. Returns GeoJSON line geometry and summary.",
      parameters: {
        type: "object",
        properties: {
          locations: {
            type: "array",
            description:
              "Route points as [{lat, lon}, ...] with at least two points.",
          },
          profile: {
            type: "string",
            description: "Travel profile/costing.",
            enum: ["auto", "bicycle", "pedestrian", "bus", "truck"],
          },
          units: {
            type: "string",
            description: "Distance units.",
            enum: ["kilometers", "miles"],
          },
          baseUrl: {
            type: "string",
            description: "Optional Valhalla base URL override.",
          },
          toEditor: {
            type: "boolean",
            description:
              "If true, import route geometry directly into editor and return a compact import summary.",
          },
          replaceExisting: {
            type: "boolean",
            description:
              "Used when toEditor=true. If true, replaces current editor features.",
          },
        },
        required: ["locations"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "valhalla_isochrone",
      description:
        "Compute travel-time contours around a location using Valhalla. Returns GeoJSON contour features.",
      parameters: {
        type: "object",
        properties: {
          location: {
            type: "object",
            description: "Center location as {lat, lon}.",
          },
          contoursMinutes: {
            type: "array",
            description: "Minute contours, e.g. [10,20,30].",
          },
          profile: {
            type: "string",
            description: "Travel profile/costing.",
            enum: ["auto", "bicycle", "pedestrian"],
          },
          polygons: {
            type: "boolean",
            description: "Return polygons if true (default true).",
          },
          baseUrl: {
            type: "string",
            description: "Optional Valhalla base URL override.",
          },
          toEditor: {
            type: "boolean",
            description:
              "If true, import isochrone geometries directly into editor and return a compact import summary.",
          },
          replaceExisting: {
            type: "boolean",
            description:
              "Used when toEditor=true. If true, replaces current editor features.",
          },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "import_osm_to_editor",
      description:
        "Import OSM features directly into the editor after narrowing candidates. Recommended flow: run query_osm_bbox/query_osm_nearby first, then import with explicit bbox/point + filters. Name is optional; omit it to import all matched features in the selected area.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description:
              'Optional target feature name to match (example: "Rhine"). Omit to import all matched features.',
          },
          relationId: {
            type: "number",
            description:
              "Optional direct OSM relation id to import. Best for boundaries after resolve_osm_entity.",
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
          includeRelations: {
            type: "boolean",
            description:
              "If true, include relation results (recommended for boundaries and administrative areas).",
          },
          replaceExisting: {
            type: "boolean",
            description:
              "If true, replace all editor features with imported set. Default false (append).",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for information. Returns titles, URLs, and content snippets. Useful for finding current information, facts, and context about places, topics, or anything else.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query string",
          },
          limit: {
            type: "number",
            description: "Maximum results (default 5, max 20)",
          },
          categories: {
            type: "string",
            description:
              'Search categories: "general", "science", "it", etc. (default: "general")',
          },
          language: {
            type: "string",
            description: 'Language code (default: "en")',
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_url",
      description:
        "Fetch a URL and extract its readable text content. Useful for reading articles, documentation, or any web page. Returns cleaned text with title and description.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch",
          },
          maxLength: {
            type: "number",
            description:
              "Max characters of text to return (default 10000, max 50000)",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "wikipedia_lookup",
      description:
        "Look up Wikipedia articles by title or geographic coordinates. For geo-mapping context, use lat/lon to find articles about nearby landmarks and places. Returns article summaries.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: 'Article title (e.g., "Mount Everest")',
          },
          lat: {
            type: "number",
            description: "Latitude for geographic search",
          },
          lon: {
            type: "number",
            description: "Longitude for geographic search",
          },
          radius: {
            type: "number",
            description:
              "Search radius in meters for geo lookup (default 1000)",
          },
          limit: {
            type: "number",
            description: "Max articles for geo search (default 5, max 10)",
          },
          language: {
            type: "string",
            description: 'Wikipedia language code (default: "en")',
          },
        },
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

function countFeaturesByGeometry(features: EditorFeature[]) {
  const counts: Record<string, number> = {};
  for (const feature of features) {
    const type = feature.geometry?.type ?? "Unknown";
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

function getMapContextSnapshot() {
  const store = useEditorStore.getState();
  const viewport = store.editor?.getMapBounds() ?? store.currentBbox;
  const center = store.editor?.getMapCenter() ?? null;
  const zoom = store.editor?.getMapZoom() ?? null;
  const selectedFeatures = new Set(store.selectedFeatureIds);
  const selectedSummary = store.features
    .filter((feature) => selectedFeatures.has(feature.id))
    .slice(0, 20)
    .map((feature) => ({
      id: feature.id,
      geometryType: feature.geometry?.type ?? "Unknown",
      name:
        typeof feature.properties?.name === "string"
          ? feature.properties?.name
          : undefined,
    }));
  const visibleMapLayers = store.mapLayers
    .filter((layer) => layer.enabled)
    .map((layer) => ({
      id: layer.id,
      title: layer.title,
      kind: layer.kind,
      opacity: layer.opacity,
    }));
  const visibleDatasetIds = Object.entries(store.datasetVisibility)
    .filter(([, visible]) => visible)
    .map(([datasetId]) => datasetId);

  return {
    editorReady: Boolean(store.editor),
    mode: store.mode,
    featureCount: store.features.length,
    selectedFeatureCount: store.selectedFeatureIds.length,
    selectedFeatures: selectedSummary,
    featureGeometryCounts: countFeaturesByGeometry(store.features),
    viewportBbox: viewport,
    mapCenter: center,
    mapZoom: zoom,
    mapView: {
      center,
      zoom,
      bbox: viewport,
    },
    visibleLayers: visibleMapLayers,
    visibleDatasets: visibleDatasetIds,
    mapSource: store.mapSource,
  };
}

function getCompactMapContextForPrompt(
  snapshot: ReturnType<typeof getMapContextSnapshot>,
) {
  const selectedFeatureHints = snapshot.selectedFeatures
    .slice(0, 4)
    .map((feature) => ({
      geometryType: feature.geometryType,
      name: feature.name ?? null,
    }));

  const visibleLayerIds = snapshot.visibleLayers
    .map((layer) => layer.id)
    .slice(0, 8);

  return {
    editorReady: snapshot.editorReady,
    mode: snapshot.mode,
    featureCount: snapshot.featureCount,
    selectedFeatureCount: snapshot.selectedFeatureCount,
    mapView: snapshot.mapView,
    featureGeometryCounts: snapshot.featureGeometryCounts,
    mapSource: snapshot.mapSource,
    enabledLayerCount: snapshot.visibleLayers.length,
    visibleLayerIds,
    visibleDatasetCount: snapshot.visibleDatasets.length,
    selectedFeatureHints,
  };
}

function getCompactMapContextForTool(
  snapshot: ReturnType<typeof getMapContextSnapshot>,
) {
  return {
    editorReady: snapshot.editorReady,
    mode: snapshot.mode,
    featureCount: snapshot.featureCount,
    selectedFeatureCount: snapshot.selectedFeatureCount,
    featureGeometryCounts: snapshot.featureGeometryCounts,
    viewportBbox: snapshot.viewportBbox,
    mapCenter: snapshot.mapCenter,
    mapZoom: snapshot.mapZoom,
    mapView: snapshot.mapView,
    mapSource: snapshot.mapSource,
    enabledLayerCount: snapshot.visibleLayers.length,
    visibleLayerIds: snapshot.visibleLayers
      .map((layer) => layer.id)
      .slice(0, 8),
    visibleDatasetCount: snapshot.visibleDatasets.length,
    selectedFeatureHints: snapshot.selectedFeatures
      .slice(0, 6)
      .map((feature) => ({
        id: feature.id,
        geometryType: feature.geometryType,
        name: feature.name ?? null,
      })),
  };
}

export function createMapContextSystemMessage(): ChatMessage | null {
  const snapshot = getMapContextSnapshot();
  const compact = getCompactMapContextForPrompt(snapshot);
  return {
    role: "system",
    content: [
      "You have map-editing tool access in this chat.",
      "If the user asks to draw/create/edit map features, call tools instead of replying that you cannot edit the map.",
      "For draw requests, generate GeoJSON yourself and call add_feature_to_editor or write_geojson_to_editor directly.",
      "For many OSM features in an area (e.g. all military bases in viewport), prefer import_osm_to_editor with filters and bbox/point instead of embedding large GeoJSON argument strings.",
      "For boundaries, prefer resolve_osm_entity -> get_osm_relation_geometry/get_country_boundary, then import using relationId or returned feature.",
      "For routing and travel-time polygons, use valhalla_route and valhalla_isochrone.",
      "When a geometry-producing tool supports it, set toEditor=true to import directly and keep tool results compact.",
      "For toolbar-like operations (undo/redo/mode/selection ops), use editor_* tools.",
      "For add_feature_to_editor, send one feature per call with compact JSON.",
      "Do not ask the user for intermediate geometry parameters unless they explicitly want to customize shape details.",
      "For OSM imports, first query candidates with query_osm_bbox/query_osm_nearby, verify non-empty results, then import with explicit bbox/point and filters.",
      "When calling a tool, output strict JSON arguments only.",
      `Current map state JSON:\n${JSON.stringify(compact)}`,
    ].join("\n\n"),
  };
}

function pruneSnapshotCache() {
  if (mapSnapshotCache.size <= MAX_SNAPSHOT_CACHE_SIZE) return;
  const oldest = [...mapSnapshotCache.values()]
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, mapSnapshotCache.size - MAX_SNAPSHOT_CACHE_SIZE);
  for (const entry of oldest) {
    mapSnapshotCache.delete(entry.snapshotId);
  }
}

export function consumeMapSnapshot(
  snapshotId: string,
): CachedMapSnapshot | null {
  const snapshot = mapSnapshotCache.get(snapshotId);
  if (!snapshot) return null;
  mapSnapshotCache.delete(snapshotId);
  return snapshot;
}

function serializeToolResult(result: unknown): string {
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result) ?? "null";
  } catch (error) {
    console.error("Failed to serialize tool result", error);
    return JSON.stringify({ error: "Tool result serialization failed" });
  }
}

function extractMcpToolResult(
  toolName: string,
  response: unknown,
): Record<string, unknown> {
  if (!response || typeof response !== "object") {
    throw new Error(`${toolName}: invalid tool response payload`);
  }

  const envelope = response as Record<string, unknown>;
  const error =
    typeof envelope.error === "string" ? envelope.error.trim() : null;
  if (error) {
    throw new Error(`${toolName}: ${error}`);
  }

  if (!("result" in envelope) || envelope.result === undefined) {
    throw new Error(
      `${toolName}: missing result in tool response. Raw keys: ${Object.keys(
        envelope,
      ).join(", ") || "(none)"}`,
    );
  }

  if (!envelope.result || typeof envelope.result !== "object") {
    return { value: envelope.result };
  }

  return envelope.result as Record<string, unknown>;
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

function clampPositiveInt(
  value: unknown,
  fallback: number,
  max: number,
): number {
  const numeric = toFiniteNumber(value);
  if (numeric === undefined) return fallback;
  return Math.max(1, Math.min(max, Math.floor(numeric)));
}

function clampRadiusMeters(value: unknown): number {
  const numeric = toFiniteNumber(value);
  if (numeric === undefined) return DEFAULT_NEARBY_RADIUS_METERS;
  return Math.max(1, Math.min(MAX_NEARBY_RADIUS_METERS, numeric));
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
  const existingCustomProperties =
    sourceProps.customProperties &&
    typeof sourceProps.customProperties === "object" &&
    !Array.isArray(sourceProps.customProperties)
      ? (sourceProps.customProperties as Record<string, unknown>)
      : {};
  const mirroredCustomProperties: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sourceProps)) {
    if (NON_CUSTOM_EDITOR_PROPERTY_KEYS.has(key) || isStyleProperty(key)) {
      continue;
    }
    mirroredCustomProperties[key] = value;
  }
  const mergedCustomProperties = {
    ...existingCustomProperties,
    ...mirroredCustomProperties,
  };

  return {
    ...feature,
    id: stableId,
    properties: {
      ...sourceProps,
      ...(Object.keys(mergedCustomProperties).length > 0
        ? { customProperties: mergedCustomProperties }
        : {}),
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

function countGeometryTypes(
  features: GeoJSON.Feature[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const feature of features) {
    const geometryType = feature.geometry?.type ?? "Unknown";
    counts[geometryType] = (counts[geometryType] ?? 0) + 1;
  }
  return counts;
}

function extractGeoJsonFeaturesFromUnknown(value: unknown): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];

  const visit = (candidate: unknown): void => {
    if (!candidate) return;

    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item);
      return;
    }

    if (typeof candidate !== "object") return;
    const objectValue = candidate as Record<string, unknown>;
    const objectType = objectValue.type;

    if (objectType === "FeatureCollection" && Array.isArray(objectValue.features)) {
      visit(objectValue.features);
      return;
    }

    if (objectType === "Feature") {
      const feature = asFeatureObject(objectValue);
      if (feature) features.push(feature);
      return;
    }

    if (isGeoJsonGeometryType(objectType)) {
      features.push({
        type: "Feature",
        geometry: objectValue as unknown as GeoJSON.Geometry,
        properties: {},
      });
      return;
    }

    if ("feature" in objectValue) {
      visit(objectValue.feature);
    }
    if ("features" in objectValue) {
      visit(objectValue.features);
    }
    if ("featureCollection" in objectValue) {
      visit(objectValue.featureCollection);
    }
  };

  visit(value);
  return features;
}

function parseToolResultContent(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function toEditorFromToolResultValue(
  resultValue: unknown,
  replaceExisting: boolean,
): GeometryBakeResult {
  const features = extractGeoJsonFeaturesFromUnknown(resultValue);
  if (features.length === 0) {
    throw new Error("No geometry found in tool result to import.");
  }

  const importResult = importFeaturesToEditor(features, replaceExisting);
  return {
    importedCount: importResult.importedCount,
    skippedDuplicates: importResult.skippedDuplicates,
    totalFeaturesInEditor: importResult.totalFeaturesInEditor,
    replaceExisting,
    extractedFeatureCount: features.length,
    geometryTypeCounts: countGeometryTypes(features),
  };
}

export function analyzeToolResultGeometryContent(
  content: string,
): GeometryBakeAnalysis {
  const parsed = parseToolResultContent(content);
  if (parsed === null) {
    return {
      canBake: false,
      featureCount: 0,
      geometryTypeCounts: {},
      reason: "Tool result is not JSON.",
    };
  }
  const features = extractGeoJsonFeaturesFromUnknown(parsed);
  return {
    canBake: features.length > 0,
    featureCount: features.length,
    geometryTypeCounts: countGeometryTypes(features),
    reason:
      features.length > 0 ? undefined : "No GeoJSON geometry found in result.",
  };
}

export function bakeToolResultContentToEditor(
  content: string,
  replaceExisting = false,
): GeometryBakeResult {
  const parsed = parseToolResultContent(content);
  if (parsed === null) {
    throw new Error("Tool result is not valid JSON.");
  }
  return toEditorFromToolResultValue(parsed, replaceExisting);
}

function compactToolResultAfterBake(resultValue: unknown): Record<string, unknown> {
  const base =
    resultValue && typeof resultValue === "object"
      ? { ...(resultValue as Record<string, unknown>) }
      : { value: resultValue };

  delete base.feature;
  delete base.features;
  delete base.featureCollection;

  if (typeof base.preview === "string" && base.preview.length > 280) {
    base.preview = `${base.preview.slice(0, 280)}...`;
  }

  return base;
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

function isGeoJsonGeometryType(
  value: unknown,
): value is GeoJSON.Geometry["type"] {
  return (
    typeof value === "string" &&
    [
      "Point",
      "MultiPoint",
      "LineString",
      "MultiLineString",
      "Polygon",
      "MultiPolygon",
      "GeometryCollection",
    ].includes(value)
  );
}

function parseGeoJsonArg(args: Record<string, unknown>): unknown {
  if (args.geojson && typeof args.geojson === "object") {
    return args.geojson;
  }

  if (typeof args.geojsonText === "string") {
    const text = args.geojsonText.trim();
    if (!text) {
      throw new Error("geojsonText must be a non-empty JSON string.");
    }
    if (text.length > MAX_GEOJSON_TEXT_CHARS) {
      throw new Error(
        `geojsonText is too large (${text.length} chars). Maximum is ${MAX_GEOJSON_TEXT_CHARS}.`,
      );
    }
    return JSON.parse(text);
  }

  throw new Error("Provide either geojson (object) or geojsonText (string).");
}

function stripJsonCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const fencedBody = match?.[1];
  return fencedBody ? fencedBody.trim() : trimmed;
}

function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaping = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }

  return null;
}

function repairLikelyTruncatedJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  const source = raw.slice(start);
  let output = "";
  const stack: string[] = [];
  let inString = false;
  let escaping = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (!ch) continue;
    output += ch;

    if (inString) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") {
      stack.push("}");
      continue;
    }
    if (ch === "[") {
      stack.push("]");
      continue;
    }
    if ((ch === "}" || ch === "]") && stack.length > 0) {
      const expected = stack[stack.length - 1];
      if (expected === ch) {
        stack.pop();
      }
    }
  }

  if (inString) {
    output += '"';
  }
  while (stack.length > 0) {
    const close = stack.pop();
    if (close) output += close;
  }

  const cleaned = output.replace(/,(\s*[}\]])/g, "$1").trim();
  return cleaned.length > 0 ? cleaned : null;
}

function parseToolCallArguments(
  rawArguments: string | undefined,
): Record<string, unknown> {
  const raw = rawArguments?.trim();
  if (!raw) return {};

  const candidates = new Set<string>([raw]);
  const fenceStripped = stripJsonCodeFence(raw);
  candidates.add(fenceStripped);
  const extracted = extractFirstJsonObject(fenceStripped);
  if (extracted) {
    candidates.add(extracted);
  }
  const repaired = repairLikelyTruncatedJsonObject(fenceStripped);
  if (repaired) {
    candidates.add(repaired);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        continue;
      }
      return parsed as Record<string, unknown>;
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    `Invalid tool arguments JSON for tool call. Raw arguments prefix: ${raw.slice(0, 200)}`,
  );
}

function normalizeGeoJsonToFeatures(value: unknown): GeoJSON.Feature[] {
  if (!value || typeof value !== "object") {
    throw new Error("GeoJSON payload must be an object.");
  }

  const obj = value as Record<string, unknown>;
  const type = obj.type;

  if (type === "FeatureCollection") {
    const features = Array.isArray(obj.features) ? obj.features : [];
    const normalized = features
      .map(asFeatureObject)
      .filter((feature): feature is GeoJSON.Feature => feature !== null);
    if (normalized.length === 0) {
      throw new Error("FeatureCollection does not contain valid features.");
    }
    return normalized;
  }

  if (type === "Feature") {
    const feature = asFeatureObject(obj);
    if (!feature) {
      throw new Error("Invalid GeoJSON Feature.");
    }
    return [feature];
  }

  if (isGeoJsonGeometryType(type)) {
    return [
      {
        type: "Feature",
        geometry: obj as unknown as GeoJSON.Geometry,
        properties: {},
      },
    ];
  }

  throw new Error(
    "Unsupported GeoJSON. Expected FeatureCollection, Feature, or Geometry.",
  );
}

function asGeometryObject(value: unknown): GeoJSON.Geometry | null {
  if (!value || typeof value !== "object") return null;
  const geometry = value as GeoJSON.Geometry;
  if (!isGeoJsonGeometryType(geometry.type)) return null;
  return geometry;
}

function normalizePropertiesArg(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function parseSingleFeatureArg(args: Record<string, unknown>): GeoJSON.Feature {
  if (args.feature && typeof args.feature === "object") {
    const feature = asFeatureObject(args.feature);
    if (!feature) {
      throw new Error("feature must be a valid GeoJSON Feature object.");
    }
    return feature;
  }

  const geometry = asGeometryObject(args.geometry);
  if (!geometry) {
    throw new Error(
      "Provide either feature (GeoJSON Feature) or geometry (GeoJSON Geometry).",
    );
  }

  const feature: GeoJSON.Feature = {
    type: "Feature",
    geometry,
    properties: normalizePropertiesArg(args.properties),
  };
  if (typeof args.id === "string" || typeof args.id === "number") {
    feature.id = args.id;
  }

  return feature;
}

/**
 * Execute a tool call and return the result
 */
export async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
  const client = getGeoClient();

  try {
    const args = parseToolCallArguments(toolCall.function.arguments);

    let result: unknown;

    switch (toolCall.function.name) {
      case "get_editor_state": {
        const detail = args.detail === "full" ? "full" : "compact";
        const snapshot = getMapContextSnapshot();
        result =
          detail === "full"
            ? snapshot
            : {
                ...getCompactMapContextForTool(snapshot),
                detail,
              };
        break;
      }
      case "write_geojson_to_editor": {
        const payload = parseGeoJsonArg(args);
        const features = normalizeGeoJsonToFeatures(payload);
        const replaceExisting = Boolean(args.replaceExisting);
        const importResult = importFeaturesToEditor(features, replaceExisting);
        result = {
          importedCount: importResult.importedCount,
          skippedDuplicates: importResult.skippedDuplicates,
          totalFeaturesInEditor: importResult.totalFeaturesInEditor,
          replaceExisting,
        };
        break;
      }
      case "add_feature_to_editor": {
        const feature = parseSingleFeatureArg(args);
        const replaceExisting = Boolean(args.replaceExisting);
        const importResult = importFeaturesToEditor([feature], replaceExisting);
        result = {
          geometryType: feature.geometry.type,
          providedFeatureId:
            typeof feature.id === "string" || typeof feature.id === "number"
              ? String(feature.id)
              : null,
          importedCount: importResult.importedCount,
          skippedDuplicates: importResult.skippedDuplicates,
          totalFeaturesInEditor: importResult.totalFeaturesInEditor,
          replaceExisting,
        };
        break;
      }
      case "capture_map_snapshot": {
        const store = useEditorStore.getState();
        if (!store.editor) {
          throw new Error(
            "Map editor is not ready. Open the map editor first, then try again.",
          );
        }

        const mimeType =
          args.mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
        const quality =
          typeof args.quality === "number"
            ? Math.max(0, Math.min(1, args.quality))
            : 0.9;
        const maxWidth = clampPositiveInt(
          args.maxWidth,
          DEFAULT_SNAPSHOT_MAX_WIDTH,
          4096,
        );
        const maxHeight = clampPositiveInt(
          args.maxHeight,
          DEFAULT_SNAPSHOT_MAX_HEIGHT,
          4096,
        );
        const capture = store.editor.captureMapSnapshot({
          mimeType,
          quality,
          maxWidth,
          maxHeight,
        });
        const snapshot = getMapContextSnapshot();
        const snapshotId = crypto.randomUUID();
        mapSnapshotCache.set(snapshotId, {
          snapshotId,
          dataUrl: capture.dataUrl,
          mimeType,
          width: capture.width,
          height: capture.height,
          createdAt: Date.now(),
          mapCenter: snapshot.mapCenter,
          mapZoom: snapshot.mapZoom,
          mapBbox: snapshot.viewportBbox,
        });
        pruneSnapshotCache();

        result = {
          snapshotId,
          mimeType,
          width: capture.width,
          height: capture.height,
          dataUrlLength: capture.dataUrl.length,
          mapView: snapshot.mapView,
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
        result = extractMcpToolResult("search_location", response);
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
        result = extractMcpToolResult("reverse_lookup", response);
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
        result = extractMcpToolResult("query_osm_by_id", response);
        break;
      }
      case "query_osm_nearby": {
        const lat = toFiniteNumber(args.lat);
        const lon = toFiniteNumber(args.lon);
        const radius = clampRadiusMeters(args.radius);
        if (lat === undefined || lon === undefined) {
          throw new Error("lat and lon must be valid numbers");
        }
        const response = await client.QueryOsmNearby(
          lat,
          lon,
          radius,
          normalizeFilters(args.filters) ?? undefined,
          clampLimit(args.limit, DEFAULT_QUERY_LIMIT),
          Boolean(args.includeRelations),
        );
        result = extractMcpToolResult("query_osm_nearby", response);
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
          normalizeFilters(args.filters) ?? undefined,
          clampLimit(args.limit, DEFAULT_QUERY_LIMIT),
          Boolean(args.includeRelations),
        );
        result = extractMcpToolResult("query_osm_bbox", response);
        break;
      }
      case "resolve_osm_entity": {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) {
          throw new Error("query must be a non-empty string");
        }
        const response = await client.ResolveOsmEntity(
          query,
          clampPositiveInt(args.limit, 5, 10),
          typeof args.preferredOsmType === "string"
            ? args.preferredOsmType
            : undefined,
          toFiniteNumber(args.adminLevel),
          typeof args.countryCode === "string"
            ? args.countryCode.trim().toUpperCase()
            : undefined,
        );
        result = extractMcpToolResult("resolve_osm_entity", response);
        break;
      }
      case "get_osm_relation_geometry": {
        const relationId = toFiniteNumber(args.relationId);
        if (relationId === undefined) {
          throw new Error("relationId must be a valid number");
        }
        const precision =
          toFiniteNumber(args.coordinatePrecision) !== undefined
            ? Math.max(
                3,
                Math.min(
                  7,
                  Math.floor(
                    toFiniteNumber(args.coordinatePrecision) as number,
                  ),
                ),
              )
            : undefined;
        const maxPoints =
          toFiniteNumber(args.maxPointsPerRing) !== undefined
            ? Math.max(
                50,
                Math.min(
                  20000,
                  Math.floor(toFiniteNumber(args.maxPointsPerRing) as number),
                ),
              )
            : undefined;
        const response = await client.GetOsmRelationGeometry(
          Math.floor(relationId),
          precision,
          maxPoints,
        );
        result = extractMcpToolResult("get_osm_relation_geometry", response);
        break;
      }
      case "get_country_boundary": {
        const countryCode =
          typeof args.countryCode === "string"
            ? args.countryCode.trim().toUpperCase()
            : undefined;
        const name =
          typeof args.name === "string" ? args.name.trim() : undefined;
        if (!countryCode && !name) {
          throw new Error("countryCode or name is required");
        }
        const response = await client.GetCountryBoundary(
          countryCode || undefined,
          name || undefined,
          toFiniteNumber(args.adminLevel),
          toFiniteNumber(args.coordinatePrecision),
          toFiniteNumber(args.maxPointsPerRing),
        );
        result = extractMcpToolResult("get_country_boundary", response);
        break;
      }
      case "valhalla_route": {
        const locations = Array.isArray(args.locations) ? args.locations : [];
        if (locations.length < 2) {
          throw new Error(
            "locations must contain at least two {lat, lon} points",
          );
        }
        const normalizedLocations = locations
          .map((location) => {
            if (!location || typeof location !== "object") return null;
            const lat = toFiniteNumber(
              (location as Record<string, unknown>).lat,
            );
            const lon = toFiniteNumber(
              (location as Record<string, unknown>).lon,
            );
            if (lat === undefined || lon === undefined) return null;
            return { lat, lon };
          })
          .filter(
            (location): location is { lat: number; lon: number } =>
              location !== null,
          );
        if (normalizedLocations.length < 2) {
          throw new Error(
            "locations must contain at least two valid {lat, lon} points",
          );
        }
        const response = await client.ValhallaRoute(
          normalizedLocations,
          typeof args.profile === "string" ? args.profile : undefined,
          typeof args.units === "string" ? args.units : undefined,
          typeof args.baseUrl === "string" ? args.baseUrl : undefined,
        );
        result = extractMcpToolResult("valhalla_route", response);
        break;
      }
      case "valhalla_isochrone": {
        const location = args.location;
        if (!location || typeof location !== "object") {
          throw new Error("location must be an object with lat and lon");
        }
        const lat = toFiniteNumber((location as Record<string, unknown>).lat);
        const lon = toFiniteNumber((location as Record<string, unknown>).lon);
        if (lat === undefined || lon === undefined) {
          throw new Error(
            "location.lat and location.lon must be valid numbers",
          );
        }
        const contours = Array.isArray(args.contoursMinutes)
          ? args.contoursMinutes
              .map((value) => toFiniteNumber(value))
              .filter((value): value is number => value !== undefined)
          : undefined;
        const response = await client.ValhallaIsochrone(
          { lat, lon },
          contours,
          typeof args.profile === "string" ? args.profile : undefined,
          typeof args.polygons === "boolean" ? args.polygons : undefined,
          typeof args.baseUrl === "string" ? args.baseUrl : undefined,
        );
        result = extractMcpToolResult("valhalla_isochrone", response);
        break;
      }
      case "import_osm_to_editor": {
        const name = typeof args.name === "string" ? args.name.trim() : "";
        const relationId = toFiniteNumber(args.relationId);

        const limit = clampLimit(args.limit, DEFAULT_IMPORT_LIMIT);
        const replaceExisting = Boolean(args.replaceExisting);
        const filters = normalizeFilters(args.filters);
        const includeRelations =
          Boolean(args.includeRelations) || relationId !== undefined;

        let source = "viewport";
        let usedBbox: [number, number, number, number] | null = null;
        let rawFeatures: unknown[] = [];
        let usedSearchFallback = false;

        const queryBbox = async (bbox: [number, number, number, number]) => {
          const response = await client.QueryOsmBbox(
            bbox[0],
            bbox[1],
            bbox[2],
            bbox[3],
            filters ?? undefined,
            limit,
            includeRelations,
          );
          const queryResult = extractMcpToolResult("query_osm_bbox", response);
          return Array.isArray(queryResult.features)
            ? (queryResult.features as unknown[])
            : [];
        };

        if (relationId !== undefined) {
          source = "relation";
          const relationResponse = await client.GetOsmRelationGeometry(
            Math.floor(relationId),
          );
          const relationResult = extractMcpToolResult(
            "get_osm_relation_geometry",
            relationResponse,
          );
          rawFeatures = relationResult.feature
            ? [relationResult.feature]
            : [];
        } else if (hasExplicitPoint(args)) {
          source = "nearby";
          const lat = toFiniteNumber(args.lat) as number;
          const lon = toFiniteNumber(args.lon) as number;
          const response = await client.QueryOsmNearby(
            lat,
            lon,
            clampRadiusMeters(args.radius),
            filters ?? undefined,
            limit,
            includeRelations,
          );
          const nearbyResult = extractMcpToolResult("query_osm_nearby", response);
          rawFeatures = Array.isArray(nearbyResult.features)
            ? (nearbyResult.features as unknown[])
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
              if (!name) {
                throw new Error(
                  "No viewport bbox available. Provide explicit bbox/point arguments or a name for search fallback.",
                );
              }
              source = "search_location";
              const searchResponse = await client.SearchLocation(name, 1);
              const searchResult = extractMcpToolResult(
                "search_location",
                searchResponse,
              );
              const searchCandidates = Array.isArray(searchResult.results)
                ? searchResult.results
                : [];
              const first = searchCandidates[0] as
                | Record<string, unknown>
                | undefined;
              usedBbox = ensureBbox(first?.boundingbox);

              if (!usedBbox) {
                throw new Error(
                  "No map viewport available and location search did not return a bounding box.",
                );
              }
            }
          }

          rawFeatures = await queryBbox(usedBbox);
        }

        let validFeatures = rawFeatures
          .map(asFeatureObject)
          .filter((feature): feature is GeoJSON.Feature => feature !== null);
        if (
          name &&
          validFeatures.length === 0 &&
          relationId === undefined &&
          !hasExplicitPoint(args) &&
          !hasExplicitBbox(args)
        ) {
          const searchResponse = await client.SearchLocation(name, 1);
          const searchResult = extractMcpToolResult(
            "search_location",
            searchResponse,
          );
          const candidates = Array.isArray(searchResult.results)
            ? searchResult.results
            : [];
          const fallbackBbox = ensureBbox(
            (candidates[0] as Record<string, unknown> | undefined)?.boundingbox,
          );
          if (fallbackBbox) {
            source = "search_location";
            usedSearchFallback = true;
            usedBbox = fallbackBbox;
            rawFeatures = await queryBbox(fallbackBbox);
            validFeatures = rawFeatures
              .map(asFeatureObject)
              .filter(
                (feature): feature is GeoJSON.Feature => feature !== null,
              );
          }
        }
        if (validFeatures.length === 0) {
          throw new Error(
            "No OSM features matched this import query. Run query_osm_bbox/query_osm_nearby first, refine filters, then import.",
          );
        }

        const matchedByName = name
          ? validFeatures.filter((feature) => featureMatchesName(feature, name))
          : validFeatures;
        const selected =
          matchedByName.length > 0 ? matchedByName : validFeatures;

        const importResult = importFeaturesToEditor(selected, replaceExisting);

        result = {
          source,
          name: name || null,
          filters: filters ?? null,
          usedBbox,
          queryResultCount: validFeatures.length,
          nameMatchedCount: name ? matchedByName.length : null,
          importedCount: importResult.importedCount,
          skippedDuplicates: importResult.skippedDuplicates,
          totalFeaturesInEditor: importResult.totalFeaturesInEditor,
          replaceExisting,
          usedSearchFallback,
          includeRelations,
          warning:
            name && matchedByName.length === 0
              ? "No name-matching features found; imported unfiltered query results."
              : null,
        };
        break;
      }
      case "web_search": {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) {
          throw new Error("query must be a non-empty string");
        }
        const response = await client.WebSearch(
          query,
          clampLimit(args.limit, 5),
          typeof args.categories === "string" ? args.categories : undefined,
          typeof args.language === "string" ? args.language : undefined,
        );
        result = extractMcpToolResult("web_search", response);
        break;
      }
      case "fetch_url": {
        const url = typeof args.url === "string" ? args.url.trim() : "";
        if (!url) {
          throw new Error("url must be a non-empty string");
        }
        const maxLength = toFiniteNumber(args.maxLength);
        const response = await client.FetchUrl(url, maxLength);
        result = extractMcpToolResult("fetch_url", response);
        break;
      }
      case "wikipedia_lookup": {
        const title =
          typeof args.title === "string" && args.title.trim()
            ? args.title.trim()
            : undefined;
        const lat = toFiniteNumber(args.lat);
        const lon = toFiniteNumber(args.lon);
        const radius = toFiniteNumber(args.radius);
        const limit = toFiniteNumber(args.limit);
        const language =
          typeof args.language === "string" ? args.language : undefined;

        if (!title && (lat === undefined || lon === undefined)) {
          throw new Error(
            "Either 'title' or both 'lat' and 'lon' are required",
          );
        }
        const response = await client.WikipediaLookup(
          title,
          lat,
          lon,
          radius,
          limit,
          language,
        );
        result = extractMcpToolResult("wikipedia_lookup", response);
        break;
      }
      default: {
        const editorCommandResult = executeEditorAiTool(
          toolCall.function.name,
          args,
        );
        if (editorCommandResult) {
          result = editorCommandResult;
          break;
        }
        throw new Error(`Unknown tool: ${toolCall.function.name}`);
      }
    }

    if (
      Boolean(args.toEditor) &&
      TO_EDITOR_COMPATIBLE_TOOLS.has(toolCall.function.name)
    ) {
      const bakeResult = toEditorFromToolResultValue(
        result,
        Boolean(args.replaceExisting),
      );
      result = {
        ...compactToolResultAfterBake(result),
        editorImport: bakeResult,
        toEditor: true,
      };
    }

    console.log("tool result", result);

    return {
      tool_call_id: toolCall.id,
      role: "tool",
      content: serializeToolResult(result),
    };
  } catch (error) {
    const rawArguments =
      typeof toolCall.function.arguments === "string"
        ? toolCall.function.arguments
        : "";
    const argumentPreview =
      rawArguments.length > 240
        ? `${rawArguments.slice(0, 240)}...`
        : rawArguments;
    return {
      tool_call_id: toolCall.id,
      role: "tool",
      content: JSON.stringify({
        tool: toolCall.function.name,
        error: error instanceof Error ? error.message : "Tool execution failed",
        argumentsPreview: argumentPreview,
      }),
    };
  }
}

/**
 * Tool definitions for AI chat
 * Maps EarthlyGeoServer tools + local map editor actions
 * to OpenAI function calling format.
 */

import { EarthlyGeoServerClient } from "@/ctxcn/EarthlyGeoServerClient";
import type { EditorFeature } from "@/features/geo-editor/core";
import { useEditorStore } from "@/features/geo-editor/store";
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

const DEFAULT_QUERY_LIMIT = 50;
const DEFAULT_IMPORT_LIMIT = 100;
const MAX_QUERY_LIMIT = 500;
const DEFAULT_SNAPSHOT_MAX_WIDTH = 1024;
const DEFAULT_SNAPSHOT_MAX_HEIGHT = 768;
const MAX_SNAPSHOT_CACHE_SIZE = 5;
const MAX_TOOL_RESULT_CHARS = 20000;
const MAX_GEOJSON_TEXT_CHARS = 200000;
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
        "Create features in the editor from GeoJSON. Accepts FeatureCollection, Feature, or Geometry. Use this for custom shapes and direct map edits.",
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
        "Add one generated GeoJSON feature to the editor. Preferred for direct LLM-authored geometry edits.",
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
      "Do not ask the user for intermediate geometry parameters unless they explicitly want to customize shape details.",
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
  const raw = JSON.stringify(result, null, 2);
  if (raw.length <= MAX_TOOL_RESULT_CHARS) return raw;

  return JSON.stringify(
    {
      truncated: true,
      originalLength: raw.length,
      preview: raw.slice(0, MAX_TOOL_RESULT_CHARS),
      note: "Result truncated to fit model context window. Narrow the query if you need more detail.",
    },
    null,
    2,
  );
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
        geometry: obj as GeoJSON.Geometry,
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
    const args = (
      toolCall.function.arguments?.trim()
        ? JSON.parse(toolCall.function.arguments)
        : {}
    ) as Record<string, unknown>;

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
        result = response.result;
        break;
      }
      case "fetch_url": {
        const url = typeof args.url === "string" ? args.url.trim() : "";
        if (!url) {
          throw new Error("url must be a non-empty string");
        }
        const maxLength = toFiniteNumber(args.maxLength);
        const response = await client.FetchUrl(url, maxLength);
        result = response.result;
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
        result = response.result;
        break;
      }
      default:
        throw new Error(`Unknown tool: ${toolCall.function.name}`);
    }

    console.log("tool result", result);

    return {
      tool_call_id: toolCall.id,
      role: "tool",
      content: serializeToolResult(result),
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

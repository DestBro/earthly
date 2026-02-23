import {
  NostrServerTransport,
  PrivateKeySigner,
  ApplesauceRelayPool,
} from "@contextvm/sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { serverConfig } from "../src/config/env.server";
import {
  reverseLookupInputSchema,
  reverseLookupOutputSchema,
  searchLocationInputSchema,
  searchLocationOutputSchema,
  queryByIdInputSchema,
  queryByIdOutputSchema,
  queryNearbyInputSchema,
  queryBboxInputSchema,
  queryFeaturesOutputSchema,
  createMapExtractInputSchema,
  createMapExtractOutputSchema,
  createMapUploadInputSchema,
  createMapUploadOutputSchema,
} from "./geo-schemas.ts";
import {
  webSearchInputSchema,
  webSearchOutputSchema,
  fetchUrlInputSchema,
  fetchUrlOutputSchema,
  wikipediaLookupInputSchema,
  wikipediaLookupOutputSchema,
} from "./web-schemas.ts";
import { reverseLookup, searchLocation } from "./tools/nominatim.ts";
import { queryById, queryNearby, queryBbox } from "./tools/overpass.ts";
import {
  extractPmtiles,
  getPendingExtraction,
  removePendingExtraction,
  calculateBBoxAreaSqKm,
} from "./tools/pmtiles.ts";
import {
  checkBlossomServer,
  uploadToBlossomWithAuth,
} from "./tools/blossom.ts";
import { webSearch } from "./tools/web-search.ts";
import { fetchUrl } from "./tools/fetch-url.ts";
import { wikipediaLookup } from "./tools/wikipedia.ts";

// Configuration from validated environment
const SERVER_PRIVATE_KEY =
  serverConfig.serverKey ||
  "0000000000000000000000000000000000000000000000000000000000000001"; // Dev fallback
const RELAYS = [
  serverConfig.relayUrl || "ws://localhost:3334",
  "wss://relay.contextvm.org/",
];

async function main() {
  console.log("🗺️ Starting ContextVM Geo Server...\n");

  // 1. Setup Signer and Relay Pool
  const signer = new PrivateKeySigner(SERVER_PRIVATE_KEY);
  const relayPool = new ApplesauceRelayPool(RELAYS);
  const serverPubkey = await signer.getPublicKey();

  console.log(`📡 Server Public Key: ${serverPubkey}`);
  console.log(`🔌 Connecting to relays: ${RELAYS.join(", ")}...\n`);

  // 2. Create and Configure the MCP Server
  const mcpServer = new McpServer({
    name: "earthly-geo-server",
    version: "0.0.2",
  });

  // 9. Register Tool: Search Locations (Nominatim)
  mcpServer.registerTool(
    "search_location",
    {
      title: "Search Locations (Nominatim)",
      description:
        "Search for locations using OpenStreetMap Nominatim API. Returns coordinates, bounding boxes, and geojson outlines.",
      inputSchema: searchLocationInputSchema,
      outputSchema: searchLocationOutputSchema,
    },
    async ({ query, limit }) => {
      try {
        console.log(`🗺️ Searching locations: ${query}`);
        const result = await searchLocation(query, limit);

        const output = { result };
        return {
          content: [],
          structuredContent: output,
        };
      } catch (error: any) {
        console.error(`❌ Location search failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 10. Register Tool: Reverse Geocoding (Nominatim)
  mcpServer.registerTool(
    "reverse_lookup",
    {
      title: "Reverse Geocode (Nominatim)",
      description:
        "Reverse geocode coordinates using OpenStreetMap Nominatim API. Returns address information for a point.",
      inputSchema: reverseLookupInputSchema,
      outputSchema: reverseLookupOutputSchema,
    },
    async ({ lat, lon, zoom }) => {
      try {
        console.log(
          `🗺️ Reverse geocoding: lat=${lat}, lon=${lon}, zoom=${zoom ?? 18}`,
        );
        const result = await reverseLookup(lat, lon, zoom);

        const output = { result };
        return {
          content: [],
          structuredContent: output,
        };
      } catch (error: any) {
        console.error(`❌ Reverse lookup failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 11. Register Tool: Query OSM by ID (Overpass)
  mcpServer.registerTool(
    "query_osm_by_id",
    {
      title: "Query OSM Element by ID (Overpass)",
      description:
        "Query a single OpenStreetMap element by type and ID. Returns full geometry as GeoJSON.",
      inputSchema: queryByIdInputSchema,
      outputSchema: queryByIdOutputSchema,
    },
    async ({ osmType, osmId }) => {
      try {
        console.log(`🗺️ Querying OSM ${osmType}/${osmId}`);
        const result = await queryById(osmType, osmId);

        return {
          content: [],
          structuredContent: { result },
        };
      } catch (error: any) {
        console.error(`❌ OSM query by ID failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 12. Register Tool: Query OSM Nearby (Overpass)
  mcpServer.registerTool(
    "query_osm_nearby",
    {
      title: "Query OSM Elements Nearby (Overpass)",
      description:
        "Query OpenStreetMap elements near a point. Supports filtering by OSM tags. Returns GeoJSON features.",
      inputSchema: queryNearbyInputSchema,
      outputSchema: queryFeaturesOutputSchema,
    },
    async ({ lat, lon, radius, filters, limit }) => {
      try {
        console.log(`🗺️ Querying OSM nearby: ${lat},${lon} radius=${radius}m`);
        const result = await queryNearby(lat, lon, radius, filters, limit);

        // Log response size for debugging
        const responseStr = JSON.stringify({ result });
        console.log(
          `📦 Response size: ${responseStr.length} bytes (${result.count} features)`,
        );

        return {
          content: [],
          structuredContent: { result },
        };
      } catch (error: any) {
        console.error(`❌ OSM nearby query failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 13. Register Tool: Query OSM Bbox (Overpass)
  mcpServer.registerTool(
    "query_osm_bbox",
    {
      title: "Query OSM Elements in Bounding Box (Overpass)",
      description:
        "Query OpenStreetMap elements within a bounding box. Supports filtering by OSM tags. Returns GeoJSON features.",
      inputSchema: queryBboxInputSchema,
      outputSchema: queryFeaturesOutputSchema,
    },
    async ({ west, south, east, north, filters, limit }) => {
      try {
        console.log(
          `🗺️ Querying OSM bbox: [${west},${south},${east},${north}]`,
        );
        const result = await queryBbox(
          west,
          south,
          east,
          north,
          filters,
          limit,
        );

        // Log response size for debugging
        const responseStr = JSON.stringify({ result });
        console.log(
          `📦 Response size: ${responseStr.length} bytes (${result.count} features)`,
        );

        return {
          content: [],
          structuredContent: { result },
        };
      } catch (error: any) {
        console.error(`❌ OSM bbox query failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 14. Register Tool: Create Map Extract (PMTiles)
  mcpServer.registerTool(
    "create_map_extract",
    {
      title: "Extract PMTiles Map Excerpt",
      description:
        "Extract a PMTiles map excerpt for a bounding box. Returns an unsigned Blossom auth event for the client to sign, then call create_map_upload with the signed event.",
      inputSchema: createMapExtractInputSchema,
      outputSchema: createMapExtractOutputSchema,
    },
    async ({ west, south, east, north, maxZoom, blossomServer }) => {
      try {
        console.log(
          `🗺️ Create map extract: bbox=[${west},${south},${east},${north}] maxZoom=${maxZoom ?? 16}`,
        );

        // Check Blossom server reachability first (without auth for now)
        try {
          const testUrl = new URL(blossomServer);
          const healthCheck = await fetch(testUrl.toString(), {
            method: "HEAD",
          }).catch(() => null);
          if (!healthCheck) {
            throw new Error(`Cannot reach Blossom server at ${blossomServer}`);
          }
        } catch (err: any) {
          throw new Error(
            `Invalid or unreachable Blossom server: ${err.message}`,
          );
        }

        const extractResult = await extractPmtiles(
          { west, south, east, north },
          maxZoom ?? 16,
          blossomServer,
        );

        const areaSqKm = calculateBBoxAreaSqKm({ west, south, east, north });

        return {
          content: [],
          structuredContent: {
            result: {
              ...extractResult,
              areaSqKm,
            },
          },
        };
      } catch (error: any) {
        console.error(`❌ Create map extract failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 15. Register Tool: Create Map Upload (Blossom)
  mcpServer.registerTool(
    "create_map_upload",
    {
      title: "Upload PMTiles to Blossom",
      description:
        "Upload the extracted PMTiles file to Blossom using a signed auth event. Call create_map_extract first to get the unsigned event.",
      inputSchema: createMapUploadInputSchema,
      outputSchema: createMapUploadOutputSchema,
    },
    async ({ requestId, signedEvent }) => {
      try {
        console.log(`📤 Create map upload: requestId=${requestId}`);

        const pending = getPendingExtraction(requestId);
        if (!pending) {
          throw new Error(
            `No pending extraction found for requestId: ${requestId}. It may have expired (10 min TTL).`,
          );
        }

        // Verify signed event matches expected hash
        const hashTag = signedEvent.tags.find((t) => t[0] === "x");
        if (!hashTag || hashTag[1] !== pending.sha256) {
          throw new Error(
            `Signed event hash mismatch. Expected: ${pending.sha256}, Got: ${hashTag?.[1] ?? "none"}`,
          );
        }

        // Upload to Blossom
        const uploadResult = await uploadToBlossomWithAuth(
          pending.blossomServer,
          pending.filePath,
          signedEvent,
        );

        // Cleanup
        await removePendingExtraction(requestId);

        return {
          content: [],
          structuredContent: {
            result: uploadResult,
          },
        };
      } catch (error: any) {
        console.error(`❌ Create map upload failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 16. Register Tool: Web Search (SearXNG)
  mcpServer.registerTool(
    "web_search",
    {
      title: "Web Search (SearXNG)",
      description:
        "Search the web using SearXNG. Returns titles, URLs, and content snippets from multiple search engines.",
      inputSchema: webSearchInputSchema,
      outputSchema: webSearchOutputSchema,
    },
    async ({ query, limit, categories, language }) => {
      try {
        console.log(`🔍 Web search: ${query}`);
        const result = await webSearch(query, limit, categories, language);
        return {
          content: [],
          structuredContent: { result },
        };
      } catch (error: any) {
        console.error(`❌ Web search failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 17. Register Tool: Fetch URL (Readability)
  mcpServer.registerTool(
    "fetch_url",
    {
      title: "Fetch URL (Readability)",
      description:
        "Fetch a URL and extract readable text content using Mozilla Readability. Returns title, description, and cleaned article text.",
      inputSchema: fetchUrlInputSchema,
      outputSchema: fetchUrlOutputSchema,
    },
    async ({ url, maxLength }) => {
      try {
        console.log(`🌐 Fetching URL: ${url}`);
        const result = await fetchUrl(url, maxLength);
        console.log(
          `📦 Fetched: ${result.title || url} (${result.textLength} chars)`,
        );
        return {
          content: [],
          structuredContent: { result },
        };
      } catch (error: any) {
        console.error(`❌ Fetch URL failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 18. Register Tool: Wikipedia Lookup
  mcpServer.registerTool(
    "wikipedia_lookup",
    {
      title: "Wikipedia Lookup",
      description:
        "Look up Wikipedia articles by title or by geographic coordinates. Returns article summaries and coordinates.",
      inputSchema: wikipediaLookupInputSchema,
      outputSchema: wikipediaLookupOutputSchema,
    },
    async ({ title, lat, lon, radius, limit, language }) => {
      try {
        const mode = title ? `title: ${title}` : `geo: ${lat},${lon}`;
        console.log(`📚 Wikipedia lookup: ${mode}`);
        const result = await wikipediaLookup({
          title,
          lat,
          lon,
          radius,
          limit,
          language,
        });
        console.log(`📦 Found ${result.count} articles`);
        return {
          content: [],
          structuredContent: { result },
        };
      } catch (error: any) {
        console.error(`❌ Wikipedia lookup failed: ${error.message}`);
        return {
          content: [],
          structuredContent: { error: error.message },
          isError: true,
        };
      }
    },
  );

  // 19. Configure the Nostr Server Transport
  const serverTransport = new NostrServerTransport({
    signer,
    relayHandler: relayPool,
    isPublicServer: true, // Announce this server on the Nostr network
    serverInfo: {
      name: "Earthly Geo Server",
      website: "https://earthly.city",
      about:
        "Geocoding, reverse geocoding, OSM queries, web search, URL fetching, and Wikipedia lookups.",
      picture: "https://openmaptiles.org/img/home-banner-map.png",
    },
  });

  // 6. Connect the server
  console.log("🔗 Connecting MCP server to Nostr transport...");
  await mcpServer.connect(serverTransport);

  console.log("✅ Server is running and listening for requests on Nostr");
  console.log("📋 Available tools:");
  console.log("   - search_location");
  console.log("   - reverse_lookup");
  console.log("   - query_osm_by_id");
  console.log("   - query_osm_nearby");
  console.log("   - query_osm_bbox");
  console.log("   - create_map_extract");
  console.log("   - create_map_upload");
  console.log("   - web_search");
  console.log("   - fetch_url");
  console.log("   - wikipedia_lookup");
  console.log(`\n🔑 Client should use server pubkey: ${serverPubkey}`);
  console.log("💡 Press Ctrl+C to exit.\n");

  // Log when requests are received
  console.log("👂 Listening for tool requests...\n");
}

// Start the server
main().catch((error) => {
  console.error("❌ Failed to start metadata server:", error);
  process.exit(1);
});

import {
	NostrServerTransport,
	PrivateKeySigner,
	SimpleRelayPool,
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
} from "./geo-schemas.ts";
import { reverseLookup, searchLocation } from "./tools/nominatim.ts";
import { queryById, queryNearby, queryBbox } from "./tools/overpass.ts";

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
	const relayPool = new SimpleRelayPool(RELAYS);
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
				console.log(`📦 Response size: ${responseStr.length} bytes (${result.count} features)`);

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
				console.log(`🗺️ Querying OSM bbox: [${west},${south},${east},${north}]`);
				const result = await queryBbox(west, south, east, north, filters, limit);
				
				// Log response size for debugging
				const responseStr = JSON.stringify({ result });
				console.log(`📦 Response size: ${responseStr.length} bytes (${result.count} features)`);

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

	// 14. Configure the Nostr Server Transport
	const serverTransport = new NostrServerTransport({
		signer,
		relayHandler: relayPool,
		isPublicServer: true, // Announce this server on the Nostr network
		serverInfo: {
			name: "Earthly Geo Server",
			website: "https://earthly.city",
			about:
				"Geocoding, reverse geocoding (Nominatim), and OpenStreetMap feature queries (Overpass API).",
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

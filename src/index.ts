import { join } from "node:path";
import { hexToBytes } from "@noble/hashes/utils";
import NDK, { NDKEvent, NDKPrivateKeySigner } from "@nostr-dev-kit/ndk";
import { file, serve } from "bun";
import { getPublicKey } from "nostr-tools/pure";
import { serverConfig } from "./config/env.server";
import {
  isCrawler,
  generateHomeOGHtml,
  generateGeoEventOGHtml,
  generateCollectionOGHtml,
  fetchGeoEventOGData,
  fetchCollectionOGData,
} from "./lib/og";

const isProduction = process.env.NODE_ENV === "production";

console.log(
  `Starting server in ${isProduction ? "production" : "development"} mode`,
);
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);

// Get the expected pubkey for migration auth
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY;
const EXPECTED_PUBKEY = APP_PRIVATE_KEY
  ? getPublicKey(hexToBytes(APP_PRIVATE_KEY))
  : undefined;

type BunRouteRequest = Request & { params: Record<string, string> };
type BunRouteResponse = Response | Promise<Response>;
type BunRoute =
  | ((req: BunRouteRequest) => BunRouteResponse)
  | Partial<
      Record<
        "GET" | "POST" | "PUT" | "DELETE" | "OPTIONS",
        (req: BunRouteRequest) => BunRouteResponse
      >
    >;

type AnnouncementRecord = Record<
  string,
  { bbox: [number, number, number, number]; file: string; maxZoom: number }
>;

type LayerAnnouncement = {
  id: string;
  title: string;
  kind: "pmtiles";
  pmtilesType: "raster" | "vector";
  file: string;
  defaultEnabled?: boolean;
  defaultOpacity?: number;
};

async function readAnnouncementRecord(): Promise<AnnouncementRecord | null> {
  const jsonPath = new URL("../map-chunks/announcement.json", import.meta.url);
  const jsonFile = Bun.file(jsonPath);
  if (!(await jsonFile.exists())) return null;
  try {
    return (await jsonFile.json()) as AnnouncementRecord;
  } catch {
    return null;
  }
}

async function readLayerAnnouncements(): Promise<LayerAnnouncement[]> {
  const mapChunksDir = new URL("../map-chunks/", import.meta.url);
  const layers: LayerAnnouncement[] = [];

  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(mapChunksDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".announcement.json")) continue;
      if (entry.name === "announcement.json") continue; // Skip the main chunked-vector announcement

      try {
        const filePath = new URL(entry.name, mapChunksDir);
        const content = await Bun.file(filePath).json();
        if (content && content.id && content.kind === "pmtiles") {
          layers.push(content as LayerAnnouncement);
        }
      } catch (err) {
        console.warn(`[map-announcement] Failed to read ${entry.name}:`, err);
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  return layers;
}

async function publishMapLayerSetAnnouncement(): Promise<void> {
  // We sign announcements using SERVER_KEY so clients can trust SERVER_PUBKEY.
  if (!serverConfig.serverKey) {
    console.log(
      "[map-announcement] SERVER_KEY not set; skipping announcement publish",
    );
    return;
  }

  const announcement = await readAnnouncementRecord();
  const layerAnnouncements = await readLayerAnnouncements();

  try {
    const signer = new NDKPrivateKeySigner(serverConfig.serverKey);
    const ndk = new NDK({
      explicitRelayUrls: [serverConfig.relayUrl],
      signer,
    });

    await ndk.connect();

    const event = new NDKEvent(ndk);
    event.kind = 15000;
    event.tags.push(["d", "earthly-map-layers"]);
    event.tags.push(["alt", "Earthly map layer set announcement"]);

    // Build layers array: chunked-vector basemap + any additional PMTiles layers
    const layers: any[] = [];

    // Add chunked-vector basemap layer if announcement exists
    if (announcement && Object.keys(announcement).length > 0) {
      layers.push({
        id: "chunked-vector",
        title: "Chunked Vector Basemap",
        kind: "chunked-vector",
        blossomServer: serverConfig.blossomServer,
        announcement,
      });
    }

    // Add additional PMTiles layers from *.announcement.json files
    for (const layer of layerAnnouncements) {
      layers.push({
        ...layer,
        blossomServer: serverConfig.blossomServer,
      });
    }

    if (layers.length === 0) {
      console.log("[map-announcement] No layers to announce; skipping");
      return;
    }

    event.content = JSON.stringify({
      version: 1,
      layers,
    });

    await event.publish();
    console.log(
      `[map-announcement] Published kind 15000 to ${serverConfig.relayUrl} as ${EXPECTED_PUBKEY ?? "unknown"}`,
    );
  } catch (error) {
    console.warn(
      "[map-announcement] Failed to publish announcement event:",
      error,
    );
  }
}

/**
 * Get base URL from request for OG tags
 */
function getBaseUrl(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Handle OG routes for crawlers, serve SPA for regular users
 */
async function handleGeoEventRoute(req: BunRouteRequest): Promise<Response> {
  const naddr = req.params.naddr ?? "";
  const baseUrl = getBaseUrl(req);

  if (!naddr) {
    return Response.redirect(baseUrl, 302);
  }

  if (isCrawler(req)) {
    // Fetch event data and return OG HTML
    const data = await fetchGeoEventOGData(naddr, serverConfig.relayUrl);
    const html = generateGeoEventOGHtml(
      baseUrl,
      naddr,
      data?.title ?? "Geographic Dataset",
      data?.description ?? "View this geographic dataset on Earthly",
    );
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // For regular users, redirect to hash-based route
  return Response.redirect(`${baseUrl}/#/geoevent/${naddr}`, 302);
}

async function handleCollectionRoute(req: BunRouteRequest): Promise<Response> {
  const naddr = req.params.naddr ?? "";
  const baseUrl = getBaseUrl(req);

  if (!naddr) {
    return Response.redirect(baseUrl, 302);
  }

  if (isCrawler(req)) {
    // Fetch collection data and return OG HTML
    const data = await fetchCollectionOGData(naddr, serverConfig.relayUrl);
    const html = generateCollectionOGHtml(
      baseUrl,
      naddr,
      data?.name ?? "Map Collection",
      data?.description ?? "View this collection on Earthly",
      data?.picture,
    );
    return new Response(html, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // For regular users, redirect to hash-based route
  return Response.redirect(`${baseUrl}/#/collection/${naddr}`, 302);
}

// Define route handlers that work in both modes
const apiRoutes: Record<string, BunRoute> = {
  "/api/hello": {
    async GET(_req: BunRouteRequest) {
      return Response.json({
        message: "Hello, world!",
        method: "GET",
      });
    },
    async PUT(_req: BunRouteRequest) {
      return Response.json({
        message: "Hello, world!",
        method: "PUT",
      });
    },
  },

  "/api/app-pubkey": {
    async GET() {
      return Response.json({
        pubkey: EXPECTED_PUBKEY || null,
      });
    },
  },
};

// Add debug endpoints in development only
if (!isProduction) {
  apiRoutes["/api/debug/pubkey"] = {
    async GET(_req: BunRouteRequest) {
      return Response.json({
        hasPrivateKey: !!APP_PRIVATE_KEY,
        expectedPubkey: EXPECTED_PUBKEY || "NOT SET",
        nodeEnv: process.env.NODE_ENV,
      });
    },
  };
}
// Start server
(async () => {
  // Publish nostr-based map announcement (best-effort; does not block server startup).
  publishMapLayerSetAnnouncement().catch(() => undefined);

  // Serve static files from public/static/ (stable URLs, no hashing)
  const serveStaticFile = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const staticFile = file(join(process.cwd(), "public", url.pathname));
    if (await staticFile.exists()) {
      return new Response(staticFile);
    }
    return new Response("Not found", { status: 404 });
  };

  if (isProduction) {
    // OG routes for social media crawlers (production only)
    const ogRoutes: Record<string, BunRoute> = {
      "/geoevent/:naddr": handleGeoEventRoute,
      "/collection/:naddr": handleCollectionRoute,
    };

    // Production: Serve static files from dist/ and public/
    const server = serve({
      routes: {
        ...apiRoutes,
        ...ogRoutes,
        // Explicit static file route for stable URLs
        "/static/*": serveStaticFile,
        "/*": async (req) => {
          const url = new URL(req.url);

          // Check for crawler on home page
          if (url.pathname === "/" && isCrawler(req)) {
            const baseUrl = getBaseUrl(req);
            const html = generateHomeOGHtml(baseUrl);
            return new Response(html, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }

          const pathname = url.pathname === "/" ? "/index.html" : url.pathname;

          // Try to serve from public/ first (for static assets like images)
          const publicPath = join(process.cwd(), "public", pathname);
          const publicFile = file(publicPath);

          if (await publicFile.exists()) {
            return new Response(publicFile);
          }

          // Try to serve from dist/ (built assets)
          const filePath = join(process.cwd(), "dist", pathname);
          const staticFile = file(filePath);

          if (await staticFile.exists()) {
            return new Response(staticFile);
          }

          // If file not found, serve index.html for client-side routing
          return new Response(file(join(process.cwd(), "dist", "index.html")));
        },
      },
    });

    console.log(`🚀 Server running at ${server.url} (production)`);
  } else {
    // Development: Use Bun's bundler with HMR
    // Assets in src/assets/ are bundled automatically by Bun
    const index = (await import("./index.html")).default;

    const server = serve({
      routes: {
        ...apiRoutes,
        // Serve static files from public/static/ (stable URLs for OG images, etc.)
        "/static/*": serveStaticFile,
        // Catch-all for SPA routing (Bun handles assets from src/assets/)
        "/*": index,
      },

      development: {
        hmr: true,
        console: true,
      },
    });

    console.log(`🚀 Server running at ${server.url} (development)`);
  }
})();

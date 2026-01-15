import { Client } from "@modelcontextprotocol/sdk/client";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  NostrClientTransport,
  type NostrTransportOptions,
  PrivateKeySigner,
  ApplesauceRelayPool,
} from "@contextvm/sdk";

export interface SearchLocationInput {
  /**
   * The location query (e.g., "New York City")
   */
  query: string;
  /**
   * Maximum number of results (default: 10, max: 50)
   */
  limit?: number;
}

export interface SearchLocationOutput {
  result: {
    query: string;
    count: number;
    results: {
      placeId: number;
      displayName: string;
      coordinates: {
        lat: number;
        lon: number;
      };
      /**
       * Bounding box in [west, south, east, north] order
       */
      boundingbox: [number, number, number, number] | null;
      type: string;
      class: string;
      importance?: number;
      address?: {
        [k: string]: string;
      };
      geojson?: unknown;
    }[];
  };
}

export interface ReverseLookupInput {
  /**
   * Latitude coordinate in WGS84
   */
  lat: number;
  /**
   * Longitude coordinate in WGS84
   */
  lon: number;
  /**
   * Level of detail required (0-18, default 18)
   */
  zoom?: number;
}

export interface ReverseLookupOutput {
  result: {
    coordinates: {
      lat: number;
      lon: number;
    };
    zoom: number;
    result: {
      placeId: number;
      displayName: string;
      coordinates: {
        lat: number;
        lon: number;
      };
      /**
       * Bounding box in [west, south, east, north] order
       */
      boundingbox: [number, number, number, number] | null;
      type: string;
      class: string;
      importance?: number;
      address?: {
        [k: string]: string;
      };
      geojson?: unknown;
    } | null;
  };
}

export interface QueryOsmByIdInput {
  /**
   * OSM element type
   */
  osmType: "node" | "way" | "relation";
  /**
   * OSM element ID
   */
  osmId: number;
}

export interface QueryOsmByIdOutput {
  result: {
    feature?: unknown;
    osmType: "node" | "way" | "relation";
    osmId: number;
  };
}

export interface QueryOsmNearbyInput {
  /**
   * Latitude coordinate
   */
  lat: number;
  /**
   * Longitude coordinate
   */
  lon: number;
  /**
   * Search radius in meters (1-5000)
   */
  radius?: number;
  /**
   * OSM tag filters
   */
  filters?: {
    [k: string]: string;
  };
  /**
   * Maximum results to return
   */
  limit?: number;
}

export interface QueryOsmNearbyOutput {
  result: {
    /**
     * Array of GeoJSON Features
     */
    features: unknown[];
    /**
     * Number of features returned
     */
    count: number;
  };
}

export interface QueryOsmBboxInput {
  /**
   * Western longitude
   */
  west: number;
  /**
   * Southern latitude
   */
  south: number;
  /**
   * Eastern longitude
   */
  east: number;
  /**
   * Northern latitude
   */
  north: number;
  /**
   * OSM tag filters
   */
  filters?: {
    [k: string]: string;
  };
  /**
   * Maximum results to return
   */
  limit?: number;
}

export interface QueryOsmBboxOutput {
  result: {
    /**
     * Array of GeoJSON Features
     */
    features: unknown[];
    /**
     * Number of features returned
     */
    count: number;
  };
}

export type EarthlyGeoServer = {
  SearchLocation: (query: string, limit?: number) => Promise<SearchLocationOutput>;
  ReverseLookup: (lat: number, lon: number, zoom?: number) => Promise<ReverseLookupOutput>;
  QueryOsmById: (osmType: string, osmId: number) => Promise<QueryOsmByIdOutput>;
  QueryOsmNearby: (lat: number, lon: number, radius?: number, filters?: object, limit?: number) => Promise<QueryOsmNearbyOutput>;
  QueryOsmBbox: (west: number, south: number, east: number, north: number, filters?: object, limit?: number) => Promise<QueryOsmBboxOutput>;
};

export class EarthlyGeoServerClient implements EarthlyGeoServer {
  static readonly SERVER_PUBKEY = "ceadb7d5b739189fb3ecb7023a0c3f55d8995404d7750f5068865decf8b304cc";
  static readonly DEFAULT_RELAYS = ["wss://relay.contextvm.org/"];
  private client: Client;
  private transport: Transport;

  constructor(
    options: Partial<NostrTransportOptions> & { privateKey?: string; relays?: string[] } = {}
  ) {
    this.client = new Client({
      name: "EarthlyGeoServerClient",
      version: "1.0.0",
    });

    // Private key precedence: constructor options > config file
    const resolvedPrivateKey = options.privateKey ||
      "";

    // Use options.signer if provided, otherwise create from resolved private key
    const signer = options.signer || new PrivateKeySigner(resolvedPrivateKey);
    // Use options.relays if provided, otherwise use class DEFAULT_RELAYS
    const relays = options.relays || EarthlyGeoServerClient.DEFAULT_RELAYS;
    // Use options.relayHandler if provided, otherwise create from relays
    const relayHandler = options.relayHandler || new ApplesauceRelayPool(relays);
    const serverPubkey = options.serverPubkey;
    const { privateKey: _, ...rest } = options;

    this.transport = new NostrClientTransport({
      serverPubkey: serverPubkey || EarthlyGeoServerClient.SERVER_PUBKEY,
      signer,
      relayHandler,
      isStateless: true,
      ...rest,
    });

    // Auto-connect in constructor
    this.client.connect(this.transport).catch((error) => {
      console.error(`Failed to connect to server: ${error}`);
    });
  }

  async disconnect(): Promise<void> {
    await this.transport.close();
  }

  private async call<T = unknown>(
    name: string,
    args: Record<string, unknown>
  ): Promise<T> {
    const result = await this.client.callTool({
      name,
      arguments: { ...args },
    });
    return result.structuredContent as T;
  }

    /**
   * Search for locations using OpenStreetMap Nominatim API. Returns coordinates, bounding boxes, and geojson outlines.
   * @param {string} query The location query (e.g., "New York City")
   * @param {number} limit [optional] Maximum number of results (default: 10, max: 50)
   * @returns {Promise<SearchLocationOutput>} The result of the search_location operation
   */
  async SearchLocation(
    query: string, limit?: number
  ): Promise<SearchLocationOutput> {
    return this.call("search_location", { query, limit });
  }

    /**
   * Reverse geocode coordinates using OpenStreetMap Nominatim API. Returns address information for a point.
   * @param {number} lat Latitude coordinate in WGS84
   * @param {number} lon Longitude coordinate in WGS84
   * @param {number} zoom [optional] Level of detail required (0-18, default 18)
   * @returns {Promise<ReverseLookupOutput>} The result of the reverse_lookup operation
   */
  async ReverseLookup(
    lat: number, lon: number, zoom?: number
  ): Promise<ReverseLookupOutput> {
    return this.call("reverse_lookup", { lat, lon, zoom });
  }

    /**
   * Query a single OpenStreetMap element by type and ID. Returns full geometry as GeoJSON.
   * @param {string} osmType OSM element type
   * @param {number} osmId OSM element ID
   * @returns {Promise<QueryOsmByIdOutput>} The result of the query_osm_by_id operation
   */
  async QueryOsmById(
    osmType: string, osmId: number
  ): Promise<QueryOsmByIdOutput> {
    return this.call("query_osm_by_id", { osmType, osmId });
  }

    /**
   * Query OpenStreetMap elements near a point. Supports filtering by OSM tags. Returns GeoJSON features.
   * @param {number} lat Latitude coordinate
   * @param {number} lon Longitude coordinate
   * @param {number} radius [optional] Search radius in meters (1-5000)
   * @param {object} filters [optional] OSM tag filters
   * @param {number} limit [optional] Maximum results to return
   * @returns {Promise<QueryOsmNearbyOutput>} The result of the query_osm_nearby operation
   */
  async QueryOsmNearby(
    lat: number, lon: number, radius?: number, filters?: object, limit?: number
  ): Promise<QueryOsmNearbyOutput> {
    return this.call("query_osm_nearby", { lat, lon, radius, filters, limit });
  }

    /**
   * Query OpenStreetMap elements within a bounding box. Supports filtering by OSM tags. Returns GeoJSON features.
   * @param {number} west Western longitude
   * @param {number} south Southern latitude
   * @param {number} east Eastern longitude
   * @param {number} north Northern latitude
   * @param {object} filters [optional] OSM tag filters
   * @param {number} limit [optional] Maximum results to return
   * @returns {Promise<QueryOsmBboxOutput>} The result of the query_osm_bbox operation
   */
  async QueryOsmBbox(
    west: number, south: number, east: number, north: number, filters?: object, limit?: number
  ): Promise<QueryOsmBboxOutput> {
    return this.call("query_osm_bbox", { west, south, east, north, filters, limit });
  }
}

import type { Feature, FeatureCollection, LineString } from "geojson";
import { serverConfig } from "../../src/config/env.server";

type ValhallaProfile = "auto" | "bicycle" | "pedestrian" | "bus" | "truck";

type ValhallaLocation = {
  lat: number;
  lon: number;
};

const DEFAULT_TIMEOUT_MS = 25_000;

function resolveValhallaBaseUrl(baseUrl?: string): string {
  const candidate = baseUrl?.trim() || serverConfig.valhallaUrl?.trim();
  if (!candidate) {
    throw new Error(
      "No Valhalla base URL configured. Set VALHALLA_URL in environment or pass baseUrl.",
    );
  }
  // Accept accidental endpoint URLs and normalize to a base URL.
  return candidate
    .replace(
      /\/(locate|route|isochrone|sources_to_targets|optimized_route|trace_route|trace_attributes|status|height|expansion|tile)\/?$/i,
      "",
    )
    .replace(/\/+$/, "");
}

async function postValhalla<T>(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Valhalla ${path} failed (${response.status}): ${text.slice(0, 200)}`,
      );
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

type ValhallaRouteResponse = {
  trip?: {
    summary?: {
      length?: number;
      time?: number;
    };
    legs?: {
      shape?: unknown;
      summary?: {
        length?: number;
        time?: number;
      };
    }[];
  };
};

function asLineCoordinates(value: unknown): [number, number][] {
  if (typeof value === "string") {
    return decodePolyline(value, 6);
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      if (!Array.isArray(point) || point.length < 2) return null;
      const lon = Number(point[0]);
      const lat = Number(point[1]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return [lon, lat] as [number, number];
    })
    .filter((point): point is [number, number] => Boolean(point));
}

function decodePolyline(
  encoded: string,
  precision = 6,
): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const factor = 10 ** precision;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      if (index >= encoded.length) return coordinates;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;
    do {
      if (index >= encoded.length) return coordinates;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLon = result & 1 ? ~(result >> 1) : result >> 1;
    lon += deltaLon;

    coordinates.push([lon / factor, lat / factor]);
  }

  return coordinates;
}

export async function valhallaRoute(params: {
  locations: ValhallaLocation[];
  profile?: ValhallaProfile;
  units?: "kilometers" | "miles";
  baseUrl?: string;
}): Promise<{
  feature: Feature<LineString> | null;
  summary: { lengthKm: number; durationMin: number; profile: ValhallaProfile };
}> {
  const profile = params.profile ?? "auto";
  const units = params.units ?? "kilometers";
  const baseUrl = resolveValhallaBaseUrl(params.baseUrl);

  const payload = {
    locations: params.locations,
    costing: profile,
    units,
    directions_options: { units },
    shape_format: "geojson",
    narrative: false,
  };

  const response = await postValhalla<ValhallaRouteResponse>(
    baseUrl,
    "/route",
    payload,
  );
  const legs = Array.isArray(response.trip?.legs) ? response.trip.legs : [];
  const coordinates = legs.reduce<[number, number][]>((acc, leg) => {
    const segment = asLineCoordinates(leg?.shape);
    if (segment.length === 0) return acc;
    if (acc.length > 0) {
      const [lastLon, lastLat] = acc[acc.length - 1];
      const [firstLon, firstLat] = segment[0];
      if (lastLon === firstLon && lastLat === firstLat) {
        acc.push(...segment.slice(1));
        return acc;
      }
    }
    acc.push(...segment);
    return acc;
  }, []);
  const firstLeg = legs[0];
  const lengthKm = Number(
    response.trip?.summary?.length ?? firstLeg?.summary?.length ?? 0,
  );
  const durationMin =
    Number(response.trip?.summary?.time ?? firstLeg?.summary?.time ?? 0) / 60;

  const feature: Feature<LineString> | null =
    coordinates.length >= 2
      ? {
          type: "Feature",
          properties: {
            source: "valhalla",
            profile,
            lengthKm,
            durationMin,
          },
          geometry: {
            type: "LineString",
            coordinates,
          },
        }
      : null;

  return {
    feature,
    summary: {
      lengthKm,
      durationMin,
      profile,
    },
  };
}

type ValhallaIsochroneResponse = {
  features?: unknown[];
  type?: string;
};

export async function valhallaIsochrone(params: {
  location: ValhallaLocation;
  contoursMinutes?: number[];
  profile?: "auto" | "bicycle" | "pedestrian";
  polygons?: boolean;
  baseUrl?: string;
}): Promise<{
  featureCollection: FeatureCollection;
  count: number;
  profile: "auto" | "bicycle" | "pedestrian";
  contoursMinutes: number[];
}> {
  const profile = params.profile ?? "auto";
  const contoursMinutes = params.contoursMinutes?.length
    ? [...new Set(params.contoursMinutes)].sort((a, b) => a - b)
    : [10, 20, 30];
  const baseUrl = resolveValhallaBaseUrl(params.baseUrl);
  const polygons = params.polygons !== false;

  const payload = {
    locations: [params.location],
    costing: profile,
    contours: contoursMinutes.map((time) => ({ time })),
    polygons,
  };

  const response = await postValhalla<ValhallaIsochroneResponse>(
    baseUrl,
    "/isochrone",
    payload,
  );

  const features = Array.isArray(response.features)
    ? (response.features as Feature[])
    : [];

  return {
    featureCollection: {
      type: "FeatureCollection",
      features,
    },
    count: features.length,
    profile,
    contoursMinutes,
  };
}

import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeoBlobReference, NDKGeoEvent } from "../ndk/NDKGeoEvent";
import {
  isGeoJsonFeature,
  isGeoJsonFeatureCollection,
  isGeoJsonGeometry,
  normalizeGeoJsonToFeatureCollection,
} from "./normalizeGeoJSON";

type BlobPayload = FeatureCollection | Feature | Geometry;

const blobCache = new Map<string, BlobPayload>();

function cloneFeature(feature: Feature): Feature {
  return JSON.parse(JSON.stringify(feature));
}

function normalizeToFeatureArray(payload: BlobPayload): Feature[] {
  const normalized = normalizeGeoJsonToFeatureCollection(payload);
  return (normalized.features ?? []).filter((feature) =>
    Boolean(feature.geometry),
  ) as Feature[];
}

// Track failed URLs to avoid repeated requests
const failedUrls = new Set<string>();

async function fetchWithRetry(
  url: string,
  maxRetries = 3,
  timeoutMs = 30000,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error as Error;

      // Don't retry on abort or if it's the last attempt
      if (controller.signal.aborted || attempt === maxRetries - 1) {
        throw lastError;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = 1000 * 2 ** attempt;
      console.warn(
        `Blob fetch attempt ${attempt + 1} failed, retrying in ${delay}ms...`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}

async function fetchBlobReference(
  reference: GeoBlobReference,
): Promise<BlobPayload | null> {
  const cached = blobCache.get(reference.url);
  if (cached) return cached;

  // Skip URLs that have previously failed (after all retries)
  if (failedUrls.has(reference.url)) {
    return null;
  }

  if (!globalThis.fetch) {
    throw new Error("fetch API is not available in this environment.");
  }

  try {
    const response = await fetchWithRetry(reference.url);
    if (!response.ok) {
      // Mark as failed and log warning (don't throw)
      failedUrls.add(reference.url);
      console.warn(
        `Failed to resolve blob reference ${reference.url}: ${response.status}`,
      );
      return null;
    }
    const json = await response.json();
    if (
      !isGeoJsonFeatureCollection(json) &&
      !isGeoJsonFeature(json) &&
      !isGeoJsonGeometry(json)
    ) {
      console.warn(
        `Blob payload at ${reference.url} is not a valid GeoJSON Feature, FeatureCollection, or Geometry.`,
      );
      failedUrls.add(reference.url);
      return null;
    }
    blobCache.set(reference.url, json);
    return json;
  } catch (error) {
    // Network error or other fetch failure (after retries)
    failedUrls.add(reference.url);
    console.warn(`Failed to fetch blob reference ${reference.url}:`, error);
    return null;
  }
}

export async function resolveGeoEventFeatureCollection(
  event: NDKGeoEvent,
): Promise<FeatureCollection> {
  const baseCollection = event.featureCollection;
  if (event.blobReferences.length === 0) {
    return baseCollection;
  }

  let features = normalizeGeoJsonToFeatureCollection(baseCollection)
    .features.filter((feature) => Boolean(feature.geometry))
    .map((feature) => cloneFeature(feature as Feature));

  for (const reference of event.blobReferences) {
    const payload = await fetchBlobReference(reference);

    // Skip if blob couldn't be resolved (already logged in fetchBlobReference)
    if (!payload) continue;

    const resolvedFeatures = normalizeToFeatureArray(payload).map(cloneFeature);
    if (resolvedFeatures.length === 0) continue;

    if (reference.scope === "collection") {
      features = [...features, ...resolvedFeatures];
      continue;
    }

    if (reference.scope === "feature") {
      const featureId = reference.featureId;
      if (featureId) {
        features = features.filter((feature) => {
          const currentId =
            typeof feature.id === "string"
              ? feature.id
              : typeof feature.id === "number"
                ? String(feature.id)
                : undefined;
          return currentId !== featureId;
        });
      }
      features = [...features, ...resolvedFeatures];
    }
  }

  return normalizeGeoJsonToFeatureCollection({
    ...baseCollection,
    type: "FeatureCollection",
    features,
  });
}

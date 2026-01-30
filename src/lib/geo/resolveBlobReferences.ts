import type { Feature, FeatureCollection } from 'geojson'
import type { GeoBlobReference, NDKGeoEvent } from '../ndk/NDKGeoEvent'

type BlobPayload = FeatureCollection | Feature

const blobCache = new Map<string, BlobPayload>()

function isFeatureCollection(payload: unknown): payload is FeatureCollection {
	return (
		typeof payload === 'object' &&
		payload !== null &&
		(payload as FeatureCollection).type === 'FeatureCollection' &&
		Array.isArray((payload as FeatureCollection).features)
	)
}

function isFeature(payload: unknown): payload is Feature {
	return (
		typeof payload === 'object' &&
		payload !== null &&
		(payload as Feature).type === 'Feature' &&
		'geometry' in (payload as Feature)
	)
}

function cloneFeature(feature: Feature): Feature {
	return JSON.parse(JSON.stringify(feature))
}

function normalizeToFeatureArray(payload: BlobPayload): Feature[] {
	if (isFeature(payload)) {
		return payload.geometry ? [payload] : []
	}
	if (isFeatureCollection(payload)) {
		return (payload.features ?? []).filter((feature) => Boolean(feature.geometry))
	}
	return []
}

// Track failed URLs to avoid repeated requests
const failedUrls = new Set<string>()

async function fetchBlobReference(reference: GeoBlobReference): Promise<BlobPayload | null> {
	const cached = blobCache.get(reference.url)
	if (cached) return cached
	
	// Skip URLs that have previously failed
	if (failedUrls.has(reference.url)) {
		return null
	}
	
	if (!globalThis.fetch) {
		throw new Error('fetch API is not available in this environment.')
	}
	
	try {
		const response = await fetch(reference.url)
		if (!response.ok) {
			// Mark as failed and log warning (don't throw)
			failedUrls.add(reference.url)
			console.warn(`Failed to resolve blob reference ${reference.url}: ${response.status}`)
			return null
		}
		const json = await response.json()
		if (!isFeatureCollection(json) && !isFeature(json)) {
			console.warn(`Blob payload at ${reference.url} is not a valid GeoJSON Feature or FeatureCollection.`)
			failedUrls.add(reference.url)
			return null
		}
		blobCache.set(reference.url, json)
		return json
	} catch (error) {
		// Network error or other fetch failure
		failedUrls.add(reference.url)
		console.warn(`Failed to fetch blob reference ${reference.url}:`, error)
		return null
	}
}

export async function resolveGeoEventFeatureCollection(
	event: NDKGeoEvent,
): Promise<FeatureCollection> {
	const baseCollection = event.featureCollection
	if (event.blobReferences.length === 0) {
		return baseCollection
	}

	let features = baseCollection.features
		.filter((feature) => Boolean(feature.geometry))
		.map((feature) => cloneFeature(feature))

	for (const reference of event.blobReferences) {
		const payload = await fetchBlobReference(reference)
		
		// Skip if blob couldn't be resolved (already logged in fetchBlobReference)
		if (!payload) continue
		
		const resolvedFeatures = normalizeToFeatureArray(payload).map(cloneFeature)
		if (resolvedFeatures.length === 0) continue

		if (reference.scope === 'collection') {
			features = [...features, ...resolvedFeatures]
			continue
		}

		if (reference.scope === 'feature') {
			const featureId = reference.featureId
			if (featureId) {
				features = features.filter((feature) => {
					const currentId =
						typeof feature.id === 'string'
							? feature.id
							: typeof feature.id === 'number'
								? String(feature.id)
								: undefined
					return currentId !== featureId
				})
			}
			features = [...features, ...resolvedFeatures]
		}
	}

	return {
		...baseCollection,
		features,
	}
}

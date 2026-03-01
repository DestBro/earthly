/**
 * Blossom Upload Utility
 *
 * Uploads GeoJSON FeatureCollections to the Blossom server for external storage.
 * Used when datasets exceed the Nostr event size threshold.
 *
 * Implements BUD-02 blob upload with Nostr authentication (kind 24242).
 */

import type { FeatureCollection } from 'geojson'
import type NDK from '@nostr-dev-kit/ndk'
import { NDKEvent } from '@nostr-dev-kit/ndk'
import { getBlossomServerUrl } from '@/features/geo-editor/constants'

export interface BlossomUploadResult {
	/** SHA-256 hash of the uploaded content */
	sha256: string
	/** Public URL to access the blob */
	url: string
	/** Size in bytes */
	size: number
}

export interface BlossomUploadOptions {
	/** Override the default blossom server URL */
	blossomServer?: string
	/** Optional progress callback (0-100) */
	onProgress?: (percent: number) => void
	/** NDK instance for signing the auth event (required for authenticated uploads) */
	ndk?: NDK | null
}

/**
 * Compute SHA-256 hash of data.
 */
async function computeSha256(data: ArrayBuffer): Promise<string> {
	const hashBuffer = await crypto.subtle.digest('SHA-256', data)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Create a BUD-02 authorization event for upload (kind 24242).
 * Returns base64-encoded signed event for the Authorization header.
 */
async function createUploadAuthEvent(ndk: NDK, sha256: string, size: number): Promise<string> {
	const event = new NDKEvent(ndk)
	event.kind = 24242
	event.content = `Upload GeoJSON (${size} bytes)`

	// Expiration: 5 minutes from now
	const expiration = Math.floor(Date.now() / 1000) + 300

	event.tags = [
		['t', 'upload'],
		['x', sha256],
		['expiration', expiration.toString()],
	]

	await event.sign()

	// Get the raw signed event and encode as base64
	// Use TextEncoder for proper UTF-8 handling before base64 encoding
	const rawEvent = event.rawEvent()
	const jsonString = JSON.stringify(rawEvent)
	const bytes = new TextEncoder().encode(jsonString)
	const base64 = btoa(String.fromCharCode(...bytes))

	return base64
}

/**
 * Upload a GeoJSON FeatureCollection to the Blossom server.
 *
 * @param geojson - The FeatureCollection to upload
 * @param options - Upload options
 * @returns The upload result with sha256, url, and size
 */
export async function uploadGeoJsonToBlossom(
	geojson: FeatureCollection,
	options: BlossomUploadOptions = {},
): Promise<BlossomUploadResult> {
	const { blossomServer = getBlossomServerUrl(), onProgress, ndk } = options

	// Serialize the GeoJSON
	const jsonString = JSON.stringify(geojson)
	const encoder = new TextEncoder()
	const data = encoder.encode(jsonString)
	const blob = new Blob([data], { type: 'application/geo+json' })
	const size = data.length

	// Report initial progress
	onProgress?.(10)

	// Compute SHA-256 hash of the data
	const sha256 = await computeSha256(data.buffer as ArrayBuffer)
	onProgress?.(20)

	// Build headers (aligned with backend implementation)
	const headers: Record<string, string> = {
		'Content-Type': 'application/geo+json',
		'Content-Length': String(size),
		'X-SHA-256': sha256, // Some servers use this for pre-verification
	}

	// Add authorization if NDK is available and has a signer
	if (ndk?.signer) {
		try {
			const authToken = await createUploadAuthEvent(ndk, sha256, size)
			headers['Authorization'] = `Nostr ${authToken}`
			onProgress?.(30)
		} catch (error) {
			console.warn('Failed to create auth event, trying unauthenticated upload:', error)
		}
	}

	try {
		const response = await fetch(`${blossomServer}/upload`, {
			method: 'PUT',
			headers,
			body: blob,
		})

		// Report upload complete
		onProgress?.(100)

		if (!response.ok) {
			// Check X-Reason header first (Blossom standard), then body
			const reason =
				response.headers.get('X-Reason') || (await response.text().catch(() => 'Unknown error'))

			// Provide helpful error messages
			if (response.status === 401 || response.status === 403) {
				throw new Error(`Authentication failed: ${reason}`)
			}
			if (response.status === 404) {
				throw new Error(`Blossom server not found at ${blossomServer}`)
			}
			if (response.status === 413) {
				throw new Error(`File too large: ${reason}`)
			}

			throw new Error(`Upload failed: ${reason} (${response.status})`)
		}

		const result = await response.json()

		if (!result.sha256 || !result.url) {
			throw new Error('Invalid response from Blossom server')
		}

		return {
			sha256: result.sha256,
			url: result.url,
			size: result.size ?? size,
		}
	} catch (error) {
		if (error instanceof Error) {
			throw error
		}
		throw new Error('Failed to upload to Blossom server')
	}
}

/**
 * Check if a blossom server is reachable.
 */
export async function checkBlossomServer(blossomServer?: string): Promise<boolean> {
	const server = blossomServer ?? getBlossomServerUrl()

	try {
		const response = await fetch(server, { method: 'GET' })
		return response.ok
	} catch {
		return false
	}
}

/**
 * Format bytes to human-readable string.
 */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

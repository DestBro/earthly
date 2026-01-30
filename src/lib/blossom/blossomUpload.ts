/**
 * Blossom Upload Utility
 * 
 * Uploads GeoJSON FeatureCollections to the Blossom server for external storage.
 * Used when datasets exceed the Nostr event size threshold.
 */

import type { FeatureCollection } from 'geojson'
import { getBlossomServerUrl } from '../../features/geo-editor/constants'

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
	options: BlossomUploadOptions = {}
): Promise<BlossomUploadResult> {
	const { blossomServer = getBlossomServerUrl(), onProgress } = options

	// Serialize the GeoJSON
	const jsonString = JSON.stringify(geojson)
	const blob = new Blob([jsonString], { type: 'application/geo+json' })
	const size = blob.size

	// Report initial progress
	onProgress?.(0)

	try {
		const response = await fetch(`${blossomServer}/upload`, {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/geo+json',
			},
			body: blob,
		})

		// Report upload complete
		onProgress?.(100)

		if (!response.ok) {
			const errorText = await response.text().catch(() => 'Unknown error')
			throw new Error(`Blossom upload failed: ${response.status} ${errorText}`)
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

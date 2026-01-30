/** Maximum content size before suggesting blossom upload (1MB) */
export const BLOSSOM_UPLOAD_THRESHOLD_BYTES = 1024 * 1024

/** Blossom server URL - always use production server for blob storage */
export const BLOSSOM_SERVER_URL = 'https://blossom.earthly.city'

/** Get blossom server URL */
export function getBlossomServerUrl(): string {
	return BLOSSOM_SERVER_URL
}

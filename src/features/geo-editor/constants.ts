/** Maximum content size before suggesting blossom upload (1MB) */
export const BLOSSOM_UPLOAD_THRESHOLD_BYTES = 1024 * 1024

/** Get blossom server URL based on environment */
export function getBlossomServerUrl(): string {
	// Check if we're in development mode
	const isDev = typeof window !== 'undefined' 
		? window.location.hostname === 'localhost' 
		: false
	
	return isDev 
		? 'http://localhost:3001' 
		: 'https://blossom.earthly.city'
}

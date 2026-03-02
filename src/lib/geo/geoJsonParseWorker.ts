/**
 * Web Worker for parsing large GeoJSON blobs off the main thread.
 * This prevents UI freezing during JSON.parse() of multi-MB files.
 */

export interface ParseRequest {
	id: string
	text: string
}

export interface ParseResponse {
	id: string
	success: boolean
	data?: unknown
	error?: string
}

// Worker message handler
self.onmessage = (event: MessageEvent<ParseRequest>) => {
	const { id, text } = event.data

	try {
		const data = JSON.parse(text)
		const response: ParseResponse = { id, success: true, data }
		self.postMessage(response)
	} catch (error) {
		const response: ParseResponse = {
			id,
			success: false,
			error: error instanceof Error ? error.message : 'JSON parse failed',
		}
		self.postMessage(response)
	}
}

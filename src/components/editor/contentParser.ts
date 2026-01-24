/**
 * Content Parser - Converts plain text with URLs into TipTap-compatible JSON
 * Detects and embeds images, videos, YouTube links, and preserves text formatting
 */

/** TipTap JSON node structure */
interface TipTapNode {
	type: string
	content?: TipTapNode[]
	text?: string
	attrs?: Record<string, unknown>
}

/** Media type detection result */
interface MediaMatch {
	type: 'image' | 'video' | 'youtube' | 'link'
	url: string
	start: number
	end: number
}

/** Image file extensions */
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|avif)(\?.*)?$/i

/** Video file extensions */
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v)(\?.*)?$/i

/** Video hosting patterns */
const VIDEO_HOSTS = [
	/video\.nostr\.build/i,
	/v\.nostr\.build/i,
	/cdn\.satellite\.earth.*\.(mp4|webm)/i,
]

/** YouTube URL patterns */
const YOUTUBE_PATTERNS = [
	/(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}/i,
	/(?:https?:\/\/)?(?:www\.)?youtu\.be\/[a-zA-Z0-9_-]{11}/i,
	/(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/[a-zA-Z0-9_-]{11}/i,
	/(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/[a-zA-Z0-9_-]{11}/i,
]

/** General URL pattern for detection */
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi

/**
 * Detect the media type of a URL
 */
function detectMediaType(url: string): 'image' | 'video' | 'youtube' | 'link' {
	// Check YouTube first
	for (const pattern of YOUTUBE_PATTERNS) {
		if (pattern.test(url)) {
			return 'youtube'
		}
	}

	// Check if it's a known video host
	for (const pattern of VIDEO_HOSTS) {
		if (pattern.test(url)) {
			return 'video'
		}
	}

	// Check file extensions
	if (IMAGE_EXTENSIONS.test(url)) {
		return 'image'
	}

	if (VIDEO_EXTENSIONS.test(url)) {
		return 'video'
	}

	return 'link'
}

/**
 * Find all media URLs in text
 */
function findMediaUrls(text: string): MediaMatch[] {
	const matches: MediaMatch[] = []

	// Reset the regex
	URL_PATTERN.lastIndex = 0

	let match = URL_PATTERN.exec(text)
	while (match !== null) {
		const url = match[0]
		// Clean up trailing punctuation that might be part of text
		const cleanUrl = url.replace(/[.,;:!?)]+$/, '')
		const type = detectMediaType(cleanUrl)

		matches.push({
			type,
			url: cleanUrl,
			start: match.index,
			end: match.index + cleanUrl.length,
		})

		match = URL_PATTERN.exec(text)
	}

	return matches
}

/**
 * Parse plain text content into TipTap JSON with embedded media
 * Handles line breaks, URLs, and creates proper paragraph structure
 */
export function parseContentToTipTap(text: string): TipTapNode {
	const lines = text.split('\n')
	const paragraphs: TipTapNode[] = []

	for (const line of lines) {
		const trimmedLine = line.trim()

		// Empty line = empty paragraph
		if (!trimmedLine) {
			paragraphs.push({ type: 'paragraph' })
			continue
		}

		const mediaMatches = findMediaUrls(trimmedLine)

		// If no media, just add as text paragraph
		if (mediaMatches.length === 0) {
			paragraphs.push({
				type: 'paragraph',
				content: [{ type: 'text', text: trimmedLine }],
			})
			continue
		}

		// Check if the entire line is just a single media URL (block embed)
		const firstMatch = mediaMatches[0]
		const isStandaloneMedia =
			mediaMatches.length === 1 &&
			firstMatch !== undefined &&
			firstMatch.type !== 'link' &&
			trimmedLine.trim() === firstMatch.url

		if (isStandaloneMedia && firstMatch) {
			if (firstMatch.type === 'image') {
				paragraphs.push({
					type: 'image',
					attrs: { src: firstMatch.url },
				})
			} else if (firstMatch.type === 'video') {
				paragraphs.push({
					type: 'video',
					attrs: { src: firstMatch.url },
				})
			} else if (firstMatch.type === 'youtube') {
				paragraphs.push({
					type: 'youtube',
					attrs: { src: firstMatch.url },
				})
			}
			continue
		}

		// Mixed content: text with inline URLs
		// For now, keep URLs as text but extract standalone media after text
		const content: TipTapNode[] = []
		let lastIndex = 0

		// First pass: collect text segments and media for block embedding
		const blockMedia: MediaMatch[] = []

		for (const media of mediaMatches) {
			// Add text before this URL
			if (media.start > lastIndex) {
				const textBefore = trimmedLine.slice(lastIndex, media.start)
				if (textBefore) {
					content.push({ type: 'text', text: textBefore })
				}
			}

			// For images/videos/youtube, we'll embed them after the text paragraph
			if (media.type !== 'link') {
				blockMedia.push(media)
				// Don't include the URL in the text
			} else {
				// Regular links stay as text
				content.push({ type: 'text', text: media.url })
			}

			lastIndex = media.end
		}

		// Add remaining text
		if (lastIndex < trimmedLine.length) {
			const remaining = trimmedLine.slice(lastIndex)
			if (remaining) {
				content.push({ type: 'text', text: remaining })
			}
		}

		// Add text paragraph if there's content
		if (content.length > 0) {
			// Clean up: merge adjacent text nodes and trim
			const mergedContent = mergeTextNodes(content)
			if (mergedContent.length > 0) {
				paragraphs.push({
					type: 'paragraph',
					content: mergedContent,
				})
			}
		}

		// Add block media elements
		for (const media of blockMedia) {
			if (media.type === 'image') {
				paragraphs.push({
					type: 'image',
					attrs: { src: media.url },
				})
			} else if (media.type === 'video') {
				paragraphs.push({
					type: 'video',
					attrs: { src: media.url },
				})
			} else if (media.type === 'youtube') {
				paragraphs.push({
					type: 'youtube',
					attrs: { src: media.url },
				})
			}
		}
	}

	return {
		type: 'doc',
		content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
	}
}

/**
 * Merge adjacent text nodes and clean up whitespace
 */
function mergeTextNodes(nodes: TipTapNode[]): TipTapNode[] {
	const result: TipTapNode[] = []

	for (const node of nodes) {
		if (node.type === 'text' && node.text) {
			const lastNode = result[result.length - 1]
			if (lastNode?.type === 'text' && lastNode.text) {
				lastNode.text += node.text
			} else {
				result.push({ ...node })
			}
		} else {
			result.push(node)
		}
	}

	// Clean up empty or whitespace-only text nodes at edges
	return result.filter((node) => {
		if (node.type === 'text') {
			const trimmed = node.text?.trim()
			return trimmed && trimmed.length > 0
		}
		return true
	})
}

/**
 * Check if content contains any media that needs embedding
 */
export function hasEmbeddableMedia(text: string): boolean {
	const matches = findMediaUrls(text)
	return matches.some((m) => m.type !== 'link')
}

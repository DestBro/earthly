import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { MapPin } from 'lucide-react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export interface GeoMentionAttrs {
	/** The naddr1... address of the dataset */
	address: string
	/** Optional feature ID within the dataset */
	featureId?: string
	/** Display name for the mention */
	displayName: string
}

/**
 * React component for rendering geo mentions in the TipTap editor.
 */
function GeoMentionNodeView({ node, deleteNode }: NodeViewProps) {
	const attrs = node.attrs as GeoMentionAttrs
	const { address, featureId, displayName } = attrs

	return (
		<NodeViewWrapper as="span" className="inline">
			<span
				className="inline-flex items-center gap-0.5 rounded-md bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-xs font-medium text-sky-700 mx-0.5"
				contentEditable={false}
			>
				<MapPin className="h-3 w-3 flex-shrink-0" />
				<span
					className="truncate max-w-[120px]"
					title={featureId ? `${address}#${featureId}` : address}
				>
					{displayName}
				</span>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={deleteNode}
							className="h-4 w-4 p-0 text-gray-400 hover:text-red-500"
						>
							<span className="text-xs">×</span>
						</Button>
					</TooltipTrigger>
					<TooltipContent>Remove mention</TooltipContent>
				</Tooltip>
			</span>
		</NodeViewWrapper>
	)
}

/**
 * TipTap extension for geo mentions.
 * Renders as inline chips with the dataset/feature name.
 */
export const GeoMentionNode = Node.create({
	name: 'geoMention',
	group: 'inline',
	inline: true,
	selectable: true,
	atom: true,

	addAttributes() {
		return {
			address: {
				default: null,
			},
			featureId: {
				default: null,
			},
			displayName: {
				default: 'Unknown',
			},
		}
	},

	parseHTML() {
		return [
			{
				tag: 'span[data-geo-mention]',
			},
		]
	},

	renderHTML({ HTMLAttributes }) {
		return [
			'span',
			mergeAttributes(HTMLAttributes, { 'data-geo-mention': '' }),
			HTMLAttributes.displayName || 'Unknown',
		]
	},

	addNodeView() {
		return ReactNodeViewRenderer(GeoMentionNodeView)
	},
})

/** TipTap JSON node structure */
interface TipTapNode {
	type: string
	content?: TipTapNode[]
	text?: string
	attrs?: Record<string, unknown>
}

/**
 * Converts editor content to plain text with nostr: mentions.
 * Following NIP-27 format: nostr:naddr1...#featureId
 */
export function serializeToText(json: TipTapNode | null): string {
	if (!json?.content) return ''

	const processNode = (node: TipTapNode): string => {
		if (node.type === 'text') {
			return node.text || ''
		}

		if (node.type === 'geoMention') {
			const address = node.attrs?.address as string
			const featureId = node.attrs?.featureId as string | undefined
			if (featureId) {
				return `nostr:${address}#${featureId}`
			}
			return `nostr:${address}`
		}

		if (node.type === 'paragraph') {
			const content = node.content?.map(processNode).join('') || ''
			return content
		}

		if (node.type === 'doc') {
			return node.content?.map(processNode).join('\n') || ''
		}

		// Handle other nodes by processing their content
		if (node.content) {
			return node.content.map(processNode).join('')
		}

		return ''
	}

	return processNode(json)
}

/**
 * Parses plain text with nostr: mentions back to TipTap JSON.
 */
export function parseFromText(text: string): TipTapNode {
	const pattern = /nostr:(naddr1[a-z0-9]+)(#([a-zA-Z0-9_-]+))?/g
	const content: TipTapNode[] = []
	let lastIndex = 0
	let match = pattern.exec(text)

	while (match !== null) {
		const matchIndex = match.index

		// Add text before the match
		if (matchIndex > lastIndex) {
			content.push({
				type: 'text',
				text: text.slice(lastIndex, matchIndex),
			})
		}

		// Add the geo mention node
		content.push({
			type: 'geoMention',
			attrs: {
				address: match[1],
				featureId: match[3] || null,
				displayName: match[3] ? `Feature: ${match[3]}` : `Dataset`,
			},
		})

		lastIndex = matchIndex + match[0].length
		match = pattern.exec(text)
	}

	// Add remaining text
	if (lastIndex < text.length) {
		content.push({
			type: 'text',
			text: text.slice(lastIndex),
		})
	}

	return {
		type: 'doc',
		content: [
			{
				type: 'paragraph',
				content: content.length > 0 ? content : undefined,
			},
		],
	}
}

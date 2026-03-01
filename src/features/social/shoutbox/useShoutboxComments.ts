import { useNDK, useSubscribe } from '@nostr-dev-kit/react'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { NDKEvent as NDKEventClass } from '@nostr-dev-kit/ndk'
import { useMemo, useCallback, useState } from 'react'
import type { CommentNode } from './types'

interface UseShoutboxCommentsOptions {
	/** The root event to fetch comments for */
	rootEvent: NDKEvent | null
	/** Maximum depth for nested replies */
	maxDepth?: number
}

interface UseShoutboxCommentsResult {
	/** Threaded comment tree */
	comments: CommentNode[]
	/** Flat list of all comments */
	allComments: NDKEvent[]
	/** Total comment count */
	count: number
	/** Loading state */
	isLoading: boolean
	/** Post a new top-level comment */
	postComment: (content: string) => Promise<void>
	/** Post a reply to an existing comment */
	postReply: (parentComment: NDKEvent, content: string) => Promise<void>
	/** React to an event */
	react: (target: NDKEvent) => Promise<void>
}

/**
 * Hook for fetching and managing NIP-22 comments (kind 1111) on kind 1 posts.
 */
export function useShoutboxComments({
	rootEvent,
	maxDepth = 10,
}: UseShoutboxCommentsOptions): UseShoutboxCommentsResult {
	const { ndk } = useNDK()
	const [isPosting, setIsPosting] = useState(false)

	// Build the filter for NIP-22 comments on this root event
	const filters = useMemo<NDKFilter[] | false>(() => {
		if (!rootEvent?.id) return false

		return [
			{
				kinds: [1111],
				'#E': [rootEvent.id],
				limit: 100,
			},
		]
	}, [rootEvent?.id])

	const { events, eose } = useSubscribe(filters)
	const subscriptionLoading = !eose

	// Sort comments by created_at
	const allComments = useMemo(() => {
		return [...events].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0))
	}, [events])

	// Build threaded tree
	const comments = useMemo(() => {
		const nodeMap = new Map<string, CommentNode>()
		const roots: CommentNode[] = []

		// Create nodes for all comments
		for (const comment of allComments) {
			const nodeId = comment.id
			nodeMap.set(nodeId, {
				event: comment,
				children: [],
				depth: 0,
			})
		}

		// Build tree structure
		for (const comment of allComments) {
			const nodeId = comment.id
			const node = nodeMap.get(nodeId)
			if (!node) continue

			// Check if this is a reply to another comment (has lowercase 'e' tag pointing to a 1111 event)
			const parentTag = comment.tags.find(
				(t) => t[0] === 'e' && t[3] !== 'root', // Exclude root markers
			)
			const parentKindTag = comment.tags.find((t) => t[0] === 'k')
			const parentKind = parentKindTag?.[1]

			if (parentTag && parentKind === '1111') {
				const parentId = parentTag[1]
				const parentNode = parentId ? nodeMap.get(parentId) : null

				if (parentNode) {
					node.depth = Math.min(parentNode.depth + 1, maxDepth)
					parentNode.children.push(node)
				} else {
					// Orphaned reply - treat as root
					roots.push(node)
				}
			} else {
				// Top-level comment on the root post
				roots.push(node)
			}
		}

		// Sort children by timestamp
		const sortChildren = (nodes: CommentNode[]) => {
			nodes.sort((a, b) => (a.event.created_at ?? 0) - (b.event.created_at ?? 0))
			for (const n of nodes) {
				sortChildren(n.children)
			}
		}

		sortChildren(roots)

		return roots
	}, [allComments, maxDepth])

	// Post a top-level comment (NIP-22 format)
	const postComment = useCallback(
		async (content: string) => {
			if (!ndk || !rootEvent) {
				throw new Error('NDK or root event not available')
			}

			setIsPosting(true)
			try {
				const comment = new NDKEventClass(ndk)
				comment.kind = 1111
				comment.content = content
				comment.tags = [
					// Root scope (uppercase)
					['E', rootEvent.id, '', rootEvent.pubkey],
					['K', '1'],
					['P', rootEvent.pubkey],
					// Parent (same as root for top-level comments)
					['e', rootEvent.id, '', rootEvent.pubkey],
					['k', '1'],
					['p', rootEvent.pubkey],
				]

				await comment.publish()
			} finally {
				setIsPosting(false)
			}
		},
		[ndk, rootEvent],
	)

	// Post a reply to another comment
	const postReply = useCallback(
		async (parentComment: NDKEvent, content: string) => {
			if (!ndk || !rootEvent) {
				throw new Error('NDK or root event not available')
			}

			setIsPosting(true)
			try {
				const reply = new NDKEventClass(ndk)
				reply.kind = 1111
				reply.content = content
				reply.tags = [
					// Root scope (uppercase) - always points to the original post
					['E', rootEvent.id, '', rootEvent.pubkey],
					['K', '1'],
					['P', rootEvent.pubkey],
					// Parent (lowercase) - points to the comment we're replying to
					['e', parentComment.id, '', parentComment.pubkey],
					['k', '1111'],
					['p', parentComment.pubkey],
				]

				await reply.publish()
			} finally {
				setIsPosting(false)
			}
		},
		[ndk, rootEvent],
	)

	// React to an event
	const react = useCallback(
		async (target: NDKEvent) => {
			if (!ndk) {
				throw new Error('NDK not available')
			}
			await target.react('❤️', true)
		},
		[ndk],
	)

	return {
		comments,
		allComments,
		count: allComments.length,
		isLoading: subscriptionLoading || isPosting,
		postComment,
		postReply,
		react,
	}
}

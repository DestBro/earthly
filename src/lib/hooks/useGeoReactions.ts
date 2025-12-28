import { useNDK, useNDKCurrentUser, useSubscribe, NDKEvent } from '@nostr-dev-kit/react'
import { useMemo, useCallback, useState } from 'react'
import type { NDKGeoEvent } from '../ndk/NDKGeoEvent'
import type { NDKGeoCollectionEvent } from '../ndk/NDKGeoCollectionEvent'
import type { NDKGeoCommentEvent } from '../ndk/NDKGeoCommentEvent'

export interface UseGeoReactionsOptions {
	/** The event to fetch reactions for */
	target: NDKGeoEvent | NDKGeoCollectionEvent | NDKGeoCommentEvent | null
}

export interface UseGeoReactionsResult {
	/** Total reaction count */
	reactionCount: number
	/** Total zap count */
	zapCount: number
	/** Total zap amount in sats */
	zapAmount: number
	/** Whether the current user has reacted */
	userHasReacted: boolean
	/** Whether the current user has zapped */
	userHasZapped: boolean
	/** Loading state */
	isLoading: boolean
	/** Toggle reaction (add if not reacted, would need delete support for removal) */
	toggleReaction: () => Promise<void>
	/** Open zap dialog (mock for now) */
	openZapDialog: () => void
	/** Zap dialog open state */
	zapDialogOpen: boolean
	/** Close zap dialog */
	closeZapDialog: () => void
}

/**
 * Hook for fetching and managing reactions and zaps on geo events.
 */
export function useGeoReactions({ target }: UseGeoReactionsOptions): UseGeoReactionsResult {
	const { ndk } = useNDK()
	const currentUser = useNDKCurrentUser()
	const [zapDialogOpen, setZapDialogOpen] = useState(false)
	const [isReacting, setIsReacting] = useState(false)

	// Build the address for this target
	const targetAddress = useMemo(() => {
		if (!target) return null

		const targetKind = target.kind
		const targetPubkey = target.pubkey
		const targetDTag = target.dTag

		if (!targetKind || !targetPubkey || !targetDTag) return null

		return `${targetKind}:${targetPubkey}:${targetDTag}`
	}, [target])

	// Build filter for reactions (kind 7)
	const reactionFilters = useMemo(() => {
		if (!targetAddress) return []

		return [
			{
				kinds: [7 as number],
				'#a': [targetAddress],
			},
		]
	}, [targetAddress])

	// Build filter for zaps (kind 9735)
	const zapFilters = useMemo(() => {
		if (!targetAddress) return []

		return [
			{
				kinds: [9735 as number],
				'#a': [targetAddress],
			},
		]
	}, [targetAddress])

	const { events: reactionEvents, eose: reactionsEose } = useSubscribe(reactionFilters)
	const { events: zapEvents, eose: zapsEose } = useSubscribe(zapFilters)
	const reactionsLoading = !reactionsEose
	const zapsLoading = !zapsEose

	// Count reactions
	const reactionCount = reactionEvents.length

	// Check if current user has reacted
	const userHasReacted = useMemo(() => {
		if (!currentUser?.pubkey) return false
		return reactionEvents.some((e: NDKEvent) => e.pubkey === currentUser.pubkey)
	}, [reactionEvents, currentUser?.pubkey])

	// Count zaps and calculate total amount
	const { zapCount, zapAmount, userHasZapped } = useMemo(() => {
		let total = 0
		let hasZapped = false

		for (const zap of zapEvents) {
			// Parse bolt11 tag or description to get amount (simplified)
			const bolt11 = zap.tagValue('bolt11')
			if (bolt11) {
				// In a real implementation, decode the bolt11 invoice
				// For now, we'll just count the zap
				total += 1000 // Placeholder amount
			}

			// Check if this zap is from current user (via the 'P' tag in description)
			const descTag = zap.tagValue('description')
			if (descTag && currentUser?.pubkey) {
				try {
					const desc = JSON.parse(descTag)
					if (desc.pubkey === currentUser.pubkey) {
						hasZapped = true
					}
				} catch {
					// Ignore parse errors
				}
			}
		}

		return {
			zapCount: zapEvents.length,
			zapAmount: total,
			userHasZapped: hasZapped,
		}
	}, [zapEvents, currentUser?.pubkey])

	const toggleReaction = useCallback(async () => {
		if (!ndk || !target || !currentUser) {
			throw new Error('NDK, target, or user not available')
		}

		if (userHasReacted) {
			// Would need to find and delete the reaction event
			// For now, just skip (reactions are typically not toggleable in Nostr)
			console.log('Already reacted')
			return
		}

		setIsReacting(true)
		try {
			const reaction = new NDKEvent(ndk)
			reaction.kind = 7
			reaction.content = '❤️'

			// Add 'a' tag for addressable events
			if (targetAddress) {
				reaction.tags.push(['a', targetAddress])
			}

			// Add 'e' tag for event ID
			if (target.id) {
				reaction.tags.push(['e', target.id])
			}

			// Add 'p' tag for author
			reaction.tags.push(['p', target.pubkey])

			await reaction.sign()
			await reaction.publish()
		} finally {
			setIsReacting(false)
		}
	}, [ndk, target, targetAddress, currentUser, userHasReacted])

	const openZapDialog = useCallback(() => {
		setZapDialogOpen(true)
	}, [])

	const closeZapDialog = useCallback(() => {
		setZapDialogOpen(false)
	}, [])

	return {
		reactionCount,
		zapCount,
		zapAmount,
		userHasReacted,
		userHasZapped,
		isLoading: reactionsLoading || zapsLoading || isReacting,
		toggleReaction,
		openZapDialog,
		zapDialogOpen,
		closeZapDialog,
	}
}

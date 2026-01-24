import { useNDK, useNDKCurrentUser, useSubscribe } from '@nostr-dev-kit/react'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { useState, useMemo, useCallback } from 'react'
import { Heart, MessageCircle } from 'lucide-react'
import { Button } from '../ui/button'

interface SocialActionsProps {
	/** The event to show actions for */
	event: NDKEvent
	/** Callback when comment button is clicked */
	onCommentClick?: () => void
	/** Current comment count (if known) */
	commentCount?: number
	/** Additional class names */
	className?: string
}

/**
 * Social actions for posts: react and comment buttons.
 * Shows counts and user interaction state.
 */
export function SocialActions({
	event,
	onCommentClick,
	commentCount = 0,
	className = '',
}: SocialActionsProps) {
	const { ndk } = useNDK()
	const currentUser = useNDKCurrentUser()
	const [isReacting, setIsReacting] = useState(false)
	const [optimisticReacted, setOptimisticReacted] = useState(false)

	// Subscribe to reactions on this event
	const reactionFilters = useMemo<NDKFilter[] | false>(() => {
		if (!event?.id) return false
		return [
			{
				kinds: [7],
				'#e': [event.id],
				limit: 100,
			},
		]
	}, [event?.id])

	const { events: reactionEvents } = useSubscribe(reactionFilters)

	// Check if current user has reacted
	const userHasReacted = useMemo(() => {
		if (!currentUser?.pubkey) return false
		return reactionEvents.some((r) => r.pubkey === currentUser.pubkey) || optimisticReacted
	}, [reactionEvents, currentUser?.pubkey, optimisticReacted])

	const reactionCount =
		reactionEvents.length +
		(optimisticReacted && !reactionEvents.some((r) => r.pubkey === currentUser?.pubkey) ? 1 : 0)

	const handleReact = useCallback(async () => {
		if (!ndk || !currentUser || isReacting || userHasReacted) return

		setIsReacting(true)
		setOptimisticReacted(true)
		try {
			await event.react('❤️', true)
		} catch (error) {
			console.error('Failed to react:', error)
			setOptimisticReacted(false)
		} finally {
			setIsReacting(false)
		}
	}, [ndk, currentUser, event, isReacting, userHasReacted])

	const formatCount = (count: number): string => {
		if (count === 0) return ''
		if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
		return count.toString()
	}

	return (
		<div className={`flex items-center gap-1 ${className}`}>
			{/* React Button */}
			<Button
				variant="ghost"
				size="sm"
				onClick={handleReact}
				disabled={isReacting || !currentUser}
				className={`gap-1.5 h-8 px-2 ${
					userHasReacted
						? 'text-red-500 hover:text-red-600'
						: 'text-muted-foreground hover:text-red-500'
				}`}
				title={userHasReacted ? 'You reacted to this' : 'React with a heart'}
			>
				<Heart className={`h-4 w-4 ${userHasReacted ? 'fill-current' : ''}`} />
				{reactionCount > 0 && (
					<span className="text-xs font-medium">{formatCount(reactionCount)}</span>
				)}
			</Button>

			{/* Comment Button */}
			<Button
				variant="ghost"
				size="sm"
				onClick={onCommentClick}
				className="gap-1.5 h-8 px-2 text-muted-foreground hover:text-primary"
				title="View comments"
			>
				<MessageCircle className="h-4 w-4" />
				{commentCount > 0 && (
					<span className="text-xs font-medium">{formatCount(commentCount)}</span>
				)}
			</Button>
		</div>
	)
}

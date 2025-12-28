import { Heart, MessageCircle, Zap } from 'lucide-react'
import { useNDKCurrentUser } from '@nostr-dev-kit/react'
import { Button } from '../ui/button'
import { useGeoReactions } from '../../lib/hooks/useGeoReactions'
import type { NDKGeoEvent } from '../../lib/ndk/NDKGeoEvent'
import type { NDKGeoCollectionEvent } from '../../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoCommentEvent } from '../../lib/ndk/NDKGeoCommentEvent'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

interface GeoSocialActionsProps {
	target: NDKGeoEvent | NDKGeoCollectionEvent | NDKGeoCommentEvent
	onReplyClick?: () => void
	commentCount?: number
	showCommentButton?: boolean
	className?: string
	compact?: boolean
}

/**
 * Social actions bar for geo events: reactions, zaps, and comments.
 */
export function GeoSocialActions({
	target,
	onReplyClick,
	commentCount = 0,
	showCommentButton = true,
	className = '',
	compact = false,
}: GeoSocialActionsProps) {
	const currentUser = useNDKCurrentUser()
	const {
		reactionCount,
		zapCount,
		userHasReacted,
		userHasZapped,
		isLoading,
		toggleReaction,
		openZapDialog,
	} = useGeoReactions({ target })

	const formatCount = (count: number): string => {
		if (count === 0) return ''
		if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
		return count.toString()
	}

	const handleReaction = async () => {
		if (!currentUser) {
			// Could show a login prompt here
			console.log('Please log in to react')
			return
		}
		try {
			await toggleReaction()
		} catch (error) {
			console.error('Failed to react:', error)
		}
	}

	const handleZap = () => {
		if (!currentUser) {
			console.log('Please log in to zap')
			return
		}
		openZapDialog()
		// TODO: Implement actual zap dialog
		console.log('Zap dialog would open here')
	}

	const buttonSize = compact ? 'xs' : 'sm'
	const iconSize = compact ? 'h-3.5 w-3.5' : 'h-4 w-4'

	return (
		<div className={`flex items-center gap-1 ${className}`}>
			{/* Heart/Reaction Button */}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size={buttonSize}
						onClick={handleReaction}
						disabled={isLoading}
						className={`gap-1 ${
							userHasReacted
								? 'text-rose-500 hover:text-rose-600'
								: 'text-gray-500 hover:text-rose-500'
						}`}
					>
						<Heart className={`${iconSize} ${userHasReacted ? 'fill-current' : ''}`} />
						{reactionCount > 0 && (
							<span className="text-xs font-medium">{formatCount(reactionCount)}</span>
						)}
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					{userHasReacted ? 'You liked this' : currentUser ? 'Like' : 'Log in to like'}
				</TooltipContent>
			</Tooltip>

			{/* Lightning/Zap Button */}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size={buttonSize}
						onClick={handleZap}
						disabled={isLoading || !currentUser}
						className={`gap-1 ${
							userHasZapped
								? 'text-amber-500 hover:text-amber-600'
								: 'text-gray-500 hover:text-amber-500'
						}`}
					>
						<Zap className={`${iconSize} ${userHasZapped ? 'fill-current' : ''}`} />
						{zapCount > 0 && <span className="text-xs font-medium">{formatCount(zapCount)}</span>}
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					{userHasZapped ? 'You zapped this' : currentUser ? 'Zap' : 'Log in to zap'}
				</TooltipContent>
			</Tooltip>

			{/* Comment/Reply Button */}
			{showCommentButton && onReplyClick && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size={buttonSize}
							onClick={onReplyClick}
							className="gap-1 text-gray-500 hover:text-emerald-500"
						>
							<MessageCircle className={iconSize} />
							{commentCount > 0 && (
								<span className="text-xs font-medium">{formatCount(commentCount)}</span>
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>Reply</TooltipContent>
				</Tooltip>
			)}
		</div>
	)
}

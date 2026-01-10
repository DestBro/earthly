import { MapPin, Send, X } from 'lucide-react'
import { forwardRef, useState, useRef, useCallback } from 'react'
import { useNDKCurrentUser } from '@nostr-dev-kit/react'
import type { FeatureCollection } from 'geojson'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import {
	GeoRichTextEditor,
	type GeoRichTextEditorRef,
	type GeoFeatureItem,
} from '../editor/GeoRichTextEditor'

interface GeoCommentFormProps {
	onSubmit: (text: string, geojson?: FeatureCollection) => Promise<void>
	onCancel?: () => void
	placeholder?: string
	isReply?: boolean
	autoFocus?: boolean
	/** Optional attached GeoJSON (from editor selection) */
	attachedGeojson?: FeatureCollection | null
	onClearAttachment?: () => void
	/** Available features for $ mentions */
	availableFeatures?: GeoFeatureItem[]
	className?: string
}

/**
 * Form for posting geo comments with optional GeoJSON attachments.
 * Supports rich text editing with geo mentions when availableFeatures is provided.
 */
export const GeoCommentForm = forwardRef<HTMLTextAreaElement, GeoCommentFormProps>(
	(
		{
			onSubmit,
			onCancel,
			placeholder = 'Add a comment...',
			isReply = false,
			autoFocus: _autoFocus = false,
			attachedGeojson,
			onClearAttachment,
			availableFeatures = [],
			className = '',
		},
		_ref,
	) => {
		const currentUser = useNDKCurrentUser()
		const [text, setText] = useState('')
		const [isSubmitting, setIsSubmitting] = useState(false)
		const richEditorRef = useRef<GeoRichTextEditorRef>(null)

		// Always use the rich editor so `$` mentions can work in comments.
		// If there are no available features yet, the editor will still open the menu (showing "No matches").
		const useRichEditor = true

		const hasAttachment = attachedGeojson && attachedGeojson.features.length > 0
		const featureCount = attachedGeojson?.features.length ?? 0

		const handleSubmit = async (e: React.FormEvent) => {
			e.preventDefault()

			// Get text from rich editor or plain textarea
			const submitText = useRichEditor ? (richEditorRef.current?.getText() ?? '') : text

			if (!submitText.trim() && !hasAttachment) return

			setIsSubmitting(true)
			try {
				await onSubmit(submitText, hasAttachment ? attachedGeojson : undefined)
				if (useRichEditor) {
					richEditorRef.current?.clear()
				} else {
					setText('')
				}
				onClearAttachment?.()
				onCancel?.()
			} catch (error) {
				console.error('Error submitting comment:', error)
			} finally {
				setIsSubmitting(false)
			}
		}

		const handleRichEditorChange = useCallback((newText: string) => {
			setText(newText)
		}, [])

		const canSubmit = (text.trim().length > 0 || hasAttachment) && !isSubmitting && !!currentUser

		const effectivePlaceholder = currentUser
			? useRichEditor
				? 'Type here... Use $ to reference features'
				: placeholder
			: 'Log in to comment...'

		return (
			<form onSubmit={handleSubmit} className={`space-y-2 ${className}`}>
				{/* Editor */}
				<div className="relative">
					<GeoRichTextEditor
						ref={richEditorRef}
						placeholder={effectivePlaceholder}
						availableFeatures={availableFeatures}
						onChange={handleRichEditorChange}
						disabled={isSubmitting || !currentUser}
						rows={isReply ? 2 : 3}
					/>
				</div>

				{/* Attachment indicator */}
				{hasAttachment && (
					<div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-1.5 text-xs text-emerald-700">
						<MapPin className="h-3.5 w-3.5" />
						<span>
							{featureCount} geometry{featureCount === 1 ? '' : 'ies'} attached
						</span>
						{onClearAttachment && (
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								onClick={onClearAttachment}
								className="ml-auto h-4 w-4 p-0 text-emerald-600 hover:text-emerald-800"
							>
								<X className="h-3 w-3" />
							</Button>
						)}
					</div>
				)}

				{/* Action buttons */}
				<div className="flex items-center justify-between gap-2">
					{!currentUser && <p className="text-[10px] text-gray-500">Log in to comment</p>}

					<div className="flex items-center gap-2 ml-auto">
						{onCancel && (
							<Button
								type="button"
								variant="ghost"
								size="xs"
								onClick={onCancel}
								disabled={isSubmitting}
							>
								Cancel
							</Button>
						)}

						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="submit"
									size="xs"
									disabled={!canSubmit}
									className="gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
								>
									<Send className="h-3 w-3" />
									{isReply ? 'Reply' : 'Post'}
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								{!currentUser
									? 'Log in to comment'
									: !text.trim() && !hasAttachment
										? 'Write something or attach geometry'
										: isReply
											? 'Post reply'
											: 'Post comment'}
							</TooltipContent>
						</Tooltip>
					</div>
				</div>
			</form>
		)
	},
)

GeoCommentForm.displayName = 'GeoCommentForm'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useMemo, useEffect } from 'react'
import { ImageNode, VideoNode, YouTubeNode } from './MediaExtensions'
import { parseContentToTipTap } from './contentParser'

export interface ContentViewerProps {
	/** The raw text content to display (with URLs that will be embedded) */
	content: string
	/** Additional class names */
	className?: string
}

/**
 * Read-only content viewer that renders text with embedded media.
 * Automatically detects and embeds images, videos, and YouTube links.
 *
 * Uses TipTap in read-only mode for consistent rendering.
 */
export function ContentViewer({ content, className = '' }: ContentViewerProps) {
	// Parse content into TipTap JSON with embedded media
	const parsedContent = useMemo(() => parseContentToTipTap(content), [content])

	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				// Disable features we don't need for viewing
				heading: false,
				bulletList: false,
				orderedList: false,
				blockquote: false,
				codeBlock: false,
				horizontalRule: false,
			}),
			ImageNode,
			VideoNode,
			YouTubeNode,
		],
		content: parsedContent,
		editable: false,
	})

	// Update content when it changes
	useEffect(() => {
		if (editor && content) {
			const newParsedContent = parseContentToTipTap(content)
			editor.commands.setContent(newParsedContent)
		}
	}, [editor, content])

	return (
		<div
			className={`content-viewer w-full min-w-0 overflow-hidden ${className}`}
			style={{ contain: 'inline-size' }}
		>
			<EditorContent
				editor={editor}
				className="
					prose prose-sm max-w-full w-full min-w-0
					[&_.ProseMirror]:outline-none
					[&_.ProseMirror]:p-0
					[&_.ProseMirror]:overflow-hidden
					[&_.ProseMirror]:w-full
					[&_.ProseMirror]:min-w-0
					[&_.ProseMirror]:max-w-full
					[&_.ProseMirror_p]:my-1
					[&_.ProseMirror_p]:break-words
					[&_.ProseMirror_p]:overflow-wrap-anywhere
					[&_.ProseMirror_p:first-child]:mt-0
					[&_.ProseMirror_p:last-child]:mb-0
					[&_.tiptap]:w-full
					[&_.tiptap]:min-w-0
					[&_.tiptap]:max-w-full
					[&_.tiptap]:overflow-hidden
					[&_[data-node-view-wrapper]]:w-full
					[&_[data-node-view-wrapper]]:min-w-0
					[&_[data-node-view-wrapper]]:max-w-full
					[&_[data-node-view-wrapper]]:block
					text-sm leading-relaxed
				"
			/>
		</div>
	)
}

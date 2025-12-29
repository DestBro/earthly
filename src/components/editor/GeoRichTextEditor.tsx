import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react'
import { MapPin } from 'lucide-react'
import { GeoMentionNode, serializeToText, parseFromText } from './GeoMentionExtension'

export interface GeoFeatureItem {
	/** Unique identifier */
	id: string
	/** Display name */
	name: string
	/** The naddr1... address */
	address: string
	/** Feature ID within the dataset (optional for dataset-level refs) */
	featureId?: string
	/** Geometry type for icon */
	geometryType?: string
	/** Source dataset name */
	datasetName?: string
}

export interface GeoRichTextEditorProps {
	/** Initial text content (with nostr: mentions) */
	initialValue?: string
	/** Placeholder text */
	placeholder?: string
	/** Available features for $ mentions */
	availableFeatures?: GeoFeatureItem[]
	/** Called when content changes */
	onChange?: (text: string) => void
	/** Called when a feature is dropped */
	onFeatureDrop?: (feature: GeoFeatureItem) => void
	/** Whether the editor is disabled */
	disabled?: boolean
	/** Minimum height in rows */
	rows?: number
	/** Additional class names */
	className?: string
}

export interface GeoRichTextEditorRef {
	/** Get plain text with nostr: mentions */
	getText: () => string
	/** Clear the editor */
	clear: () => void
	/** Focus the editor */
	focus: () => void
	/** Insert a geo mention at cursor */
	insertMention: (item: GeoFeatureItem) => void
}

interface SuggestionState {
	isOpen: boolean
	query: string
	items: GeoFeatureItem[]
	selectedIndex: number
	clientRect: DOMRect | null
}

/**
 * Rich text editor with inline geo mention support.
 * - Type `$` to trigger feature suggestions
 * - Drag & drop features to insert mentions
 * - Renders mentions as interactive chips
 */
export const GeoRichTextEditor = forwardRef<GeoRichTextEditorRef, GeoRichTextEditorProps>(
	(
		{
			initialValue = '',
			placeholder = 'Type here... Use $ to mention features',
			availableFeatures = [],
			onChange,
			onFeatureDrop,
			disabled = false,
			rows = 3,
			className = '',
		},
		ref,
	) => {
		const [suggestion, setSuggestion] = useState<SuggestionState>({
			isOpen: false,
			query: '',
			items: [],
			selectedIndex: 0,
			clientRect: null,
		})
		const [isDragOver, setIsDragOver] = useState(false)
		const suggestionRef = useRef<HTMLDivElement>(null)
		const editorContainerRef = useRef<HTMLDivElement>(null)

		// Filter features based on query
		const filterFeatures = useCallback(
			(query: string): GeoFeatureItem[] => {
				if (!query) return availableFeatures.slice(0, 10)
				const lowerQuery = query.toLowerCase()
				return availableFeatures
					.filter(
						(f) =>
							f.name.toLowerCase().includes(lowerQuery) ||
							f.featureId?.toLowerCase().includes(lowerQuery) ||
							f.datasetName?.toLowerCase().includes(lowerQuery),
					)
					.slice(0, 10)
			},
			[availableFeatures],
		)

		// Create mention extension with $ trigger
		const mentionExtension = Mention.configure({
			HTMLAttributes: {
				class: 'geo-mention-trigger',
			},
			suggestion: {
				char: '$',
				allowSpaces: false,
				startOfLine: false,
				items: ({ query }) => filterFeatures(query),
				render: () => {
					return {
						onStart: (props) => {
							setSuggestion({
								isOpen: true,
								query: props.query,
								items: filterFeatures(props.query),
								selectedIndex: 0,
								clientRect: props.clientRect?.() ?? null,
							})
						},
						onUpdate: (props) => {
							setSuggestion((prev) => ({
								...prev,
								query: props.query,
								items: filterFeatures(props.query),
								clientRect: props.clientRect?.() ?? null,
							}))
						},
						onExit: () => {
							setSuggestion((prev) => ({ ...prev, isOpen: false }))
						},
						onKeyDown: (props) => {
							if (props.event.key === 'ArrowUp') {
								setSuggestion((prev) => ({
									...prev,
									selectedIndex: Math.max(0, prev.selectedIndex - 1),
								}))
								return true
							}
							if (props.event.key === 'ArrowDown') {
								setSuggestion((prev) => ({
									...prev,
									selectedIndex: Math.min(prev.items.length - 1, prev.selectedIndex + 1),
								}))
								return true
							}
							if (props.event.key === 'Enter') {
								const item = suggestion.items[suggestion.selectedIndex]
								if (item) {
									selectSuggestion(item)
								}
								return true
							}
							if (props.event.key === 'Escape') {
								setSuggestion((prev) => ({ ...prev, isOpen: false }))
								return true
							}
							return false
						},
					}
				},
				command: () => {
					// This is called when a suggestion is selected
					// We'll handle it via selectSuggestion
				},
			},
		})

		const editor = useEditor({
			extensions: [
				StarterKit.configure({
					// Disable features we don't need
					heading: false,
					bulletList: false,
					orderedList: false,
					blockquote: false,
					codeBlock: false,
					horizontalRule: false,
				}),
				Placeholder.configure({
					placeholder,
				}),
				GeoMentionNode,
				mentionExtension,
			],
			content: initialValue ? parseFromText(initialValue) : '',
			editable: !disabled,
			onUpdate: ({ editor }) => {
				const json = editor.getJSON()
				const text = serializeToText(json)
				onChange?.(text)
			},
		})

		// Handle suggestion selection
		const selectSuggestion = useCallback(
			(item: GeoFeatureItem) => {
				if (!editor) return

				// Delete the $ trigger and query
				const { from } = editor.state.selection
				const textBefore = editor.state.doc.textBetween(Math.max(0, from - 50), from)
				const dollarIndex = textBefore.lastIndexOf('$')
				if (dollarIndex >= 0) {
					const deleteFrom = from - (textBefore.length - dollarIndex)
					editor
						.chain()
						.focus()
						.deleteRange({ from: deleteFrom, to: from })
						.insertContent({
							type: 'geoMention',
							attrs: {
								address: item.address,
								featureId: item.featureId,
								displayName: item.name,
							},
						})
						.insertContent(' ')
						.run()
				}

				setSuggestion((prev) => ({ ...prev, isOpen: false }))
			},
			[editor],
		)

		// Expose methods via ref
		useImperativeHandle(
			ref,
			() => ({
				getText: () => {
					if (!editor) return ''
					return serializeToText(editor.getJSON())
				},
				clear: () => {
					editor?.commands.clearContent()
				},
				focus: () => {
					editor?.commands.focus()
				},
				insertMention: (item: GeoFeatureItem) => {
					if (!editor) return
					editor
						.chain()
						.focus()
						.insertContent({
							type: 'geoMention',
							attrs: {
								address: item.address,
								featureId: item.featureId,
								displayName: item.name,
							},
						})
						.insertContent(' ')
						.run()
				},
			}),
			[editor],
		)

		// Drag & drop handlers
		const handleDragOver = useCallback((e: React.DragEvent) => {
			e.preventDefault()
			e.dataTransfer.dropEffect = 'copy'
			setIsDragOver(true)
		}, [])

		const handleDragLeave = useCallback((e: React.DragEvent) => {
			// Only set false if we're leaving the container entirely
			if (!editorContainerRef.current?.contains(e.relatedTarget as Node)) {
				setIsDragOver(false)
			}
		}, [])

		const handleDrop = useCallback(
			(e: React.DragEvent) => {
				e.preventDefault()
				setIsDragOver(false)

				const data = e.dataTransfer.getData('application/geo-feature')
				if (!data) return

				try {
					const item: GeoFeatureItem = JSON.parse(data)
					if (!editor) return

					// Insert at cursor position (or end if no focus)
					editor
						.chain()
						.focus()
						.insertContent({
							type: 'geoMention',
							attrs: {
								address: item.address,
								featureId: item.featureId,
								displayName: item.name,
							},
						})
						.insertContent(' ')
						.run()

					onFeatureDrop?.(item)
				} catch (error) {
					console.error('Failed to parse dropped feature:', error)
				}
			},
			[editor, onFeatureDrop],
		)

		// Calculate suggestion popup position
		const suggestionStyle = suggestion.clientRect
			? {
					position: 'fixed' as const,
					top: suggestion.clientRect.bottom + 4,
					left: suggestion.clientRect.left,
				}
			: {}

		return (
			<div className={`relative ${className}`}>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: container needs drag & drop handlers */}
				<div
					ref={editorContainerRef}
					className={`
						rounded-md border transition-colors
						${isDragOver ? 'border-sky-400 bg-sky-50/50 ring-2 ring-sky-200' : 'border-gray-200'}
						${disabled ? 'bg-gray-50 cursor-not-allowed' : 'bg-white'}
					`}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
				>
					<EditorContent
						editor={editor}
						className={`
							prose prose-sm max-w-none
							[&_.ProseMirror]:outline-none
							[&_.ProseMirror]:px-3 [&_.ProseMirror]:py-2
							[&_.ProseMirror]:min-h-[${rows * 1.5}rem]
							[&_.ProseMirror_p]:my-0
							[&_.ProseMirror_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]
							[&_.ProseMirror_.is-editor-empty:first-child::before]:text-gray-400
							[&_.ProseMirror_.is-editor-empty:first-child::before]:float-left
							[&_.ProseMirror_.is-editor-empty:first-child::before]:h-0
							[&_.ProseMirror_.is-editor-empty:first-child::before]:pointer-events-none
							text-sm
						`}
					/>

					{/* Drop zone indicator */}
					{isDragOver && (
						<div className="absolute inset-0 flex items-center justify-center rounded-md bg-sky-100/80 pointer-events-none">
							<div className="flex items-center gap-2 text-sky-700 font-medium">
								<MapPin className="h-5 w-5" />
								Drop to insert mention
							</div>
						</div>
					)}
				</div>

				{/* Suggestion popup */}
				{suggestion.isOpen && suggestion.items.length > 0 && (
					<div
						ref={suggestionRef}
						className="absolute z-50 w-64 max-h-48 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg"
						style={suggestionStyle}
					>
						{suggestion.items.map((item, index) => (
							<button
								key={item.id}
								type="button"
								className={`
									w-full flex items-center gap-2 px-3 py-2 text-left text-sm
									${index === suggestion.selectedIndex ? 'bg-sky-50 text-sky-700' : 'hover:bg-gray-50'}
								`}
								onClick={() => selectSuggestion(item)}
							>
								<MapPin className="h-4 w-4 text-gray-400 flex-shrink-0" />
								<div className="flex-1 min-w-0">
									<div className="font-medium truncate">{item.name}</div>
									{item.datasetName && (
										<div className="text-xs text-gray-500 truncate">{item.datasetName}</div>
									)}
								</div>
								{item.geometryType && (
									<span className="text-xs text-gray-400 flex-shrink-0">{item.geometryType}</span>
								)}
							</button>
						))}
					</div>
				)}
			</div>
		)
	},
)

GeoRichTextEditor.displayName = 'GeoRichTextEditor'

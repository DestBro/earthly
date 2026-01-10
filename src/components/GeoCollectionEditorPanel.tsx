import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useNDK, useNDKCurrentUser } from '@nostr-dev-kit/react'
import type { FeatureCollection } from 'geojson'
import { X, Save, MapPin, Trash2, FileText, MessageCircle, Eye, EyeOff, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'
import {
	GeoRichTextEditor,
	type GeoRichTextEditorRef,
	type GeoFeatureItem,
} from './editor/GeoRichTextEditor'
import { CommentsPanel } from './comments'
import { serializeToText, parseFromText } from './editor/GeoMentionExtension'
import { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoCommentEvent } from '../lib/ndk/NDKGeoCommentEvent'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import { useEditorStore } from '../features/geo-editor/store'
import { nip19 } from 'nostr-tools'

type EditorTab = 'details' | 'comments'

interface GeoCollectionEditorPanelProps {
	initialCollection?: NDKGeoCollectionEvent | null
	onClose: () => void
	onSave: (collection: NDKGeoCollectionEvent) => void
	availableFeatures?: GeoFeatureItem[]
	className?: string
	/** Callback to add/remove comment GeoJSON overlay on map */
	onCommentGeometryVisibility?: (commentId: string, geojson: FeatureCollection | null) => void
	/** Callback to zoom to a bounding box */
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	/** Callback when a geo mention's visibility is toggled */
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	/** Callback to zoom to a mentioned geometry */
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
}

export function GeoCollectionEditorPanel({
	initialCollection,
	onClose,
	onSave,
	availableFeatures = [],
	className,
	onCommentGeometryVisibility,
	onZoomToBounds,
	onMentionVisibilityToggle,
	onMentionZoomTo,
}: GeoCollectionEditorPanelProps) {
	const { ndk } = useNDK()
	const currentUser = useNDKCurrentUser()
	const editorRef = useRef<GeoRichTextEditorRef>(null)

	// Tabs
	const [activeTab, setActiveTab] = useState<EditorTab>('details')
	const [visibleGeojsonCommentIds, setVisibleGeojsonCommentIds] = useState<Set<string>>(new Set())
	const [attachedGeojson, setAttachedGeojson] = useState<FeatureCollection | null>(null)
	const [visibleReferenceAddrs, setVisibleReferenceAddrs] = useState<Set<string>>(new Set())

	// Form state
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const features = useEditorStore((state) => state.features)

	const selectedFeatures = useMemo(() => {
		if (selectedFeatureIds.length === 0) return []
		return features.filter((f) => selectedFeatureIds.includes(f.id))
	}, [features, selectedFeatureIds])

	const canAttachGeometry = selectedFeatures.length > 0 && !attachedGeojson
	
	// Initialize form state directly from collection to avoid timing issues
	const initialName = initialCollection?.metadata.name || ''
	const initialDescription = initialCollection?.metadata.description || ''
	
	const [name, setName] = useState(initialName)
	const [description, setDescription] = useState(initialDescription)
	const [isSaving, setIsSaving] = useState(false)

	// Sync state when initialCollection changes
	useEffect(() => {
		const newName = initialCollection?.metadata.name || ''
		const newDesc = initialCollection?.metadata.description || ''
		setName(newName)
		setDescription(newDesc)
		// Also reset editor content if it exists
		if (initialCollection) {
			editorRef.current?.setContent(newDesc)
		} else {
			editorRef.current?.clear()
		}
	}, [initialCollection?.id, initialCollection?.dTag])

	// Extract references from description
	const referencedAddresses = useMemo(() => {
		const refs = new Set<string>()
		const pattern = /nostr:(naddr1[a-z0-9]+)(#([a-zA-Z0-9_-]+))?/g
		let match = pattern.exec(description)
		while (match !== null) {
			if (match[1]) {
				refs.add(match[1])
			}
			match = pattern.exec(description)
		}
		return Array.from(refs)
	}, [description])

	const handleSave = async () => {
		if (!ndk || !currentUser) return
		setIsSaving(true)

		try {
			const event = initialCollection
				? NDKGeoCollectionEvent.from(initialCollection)
				: new NDKGeoCollectionEvent(ndk)

			// Update metadata
			event.metadata = {
				...event.metadata,
				name,
				description,
				ownerPk: currentUser.pubkey,
			}

			// Update references
			// We only use references explicitly found in the description for now
			// as per the "textual way" requirement.
			// Format for 'a' tag: "kind:pubkey:d-tag"
			const aTags: string[] = []

			for (const addr of referencedAddresses) {
				try {
					const decoded = nip19.decode(addr)
					if (decoded.type === 'naddr') {
						const { kind, pubkey, identifier } = decoded.data
						aTags.push(`${kind}:${pubkey}:${identifier}`)
					}
				} catch (e) {
					console.warn('Invalid naddr in description:', addr)
				}
			}

			event.datasetReferences = aTags

			await event.publishNew()
			onSave(event)
			onClose()
		} catch (error) {
			console.error('Failed to save collection:', error)
		} finally {
			setIsSaving(false)
		}
	}

	const handleDescriptionChange = useCallback((text: string) => {
		setDescription(text)
	}, [])

	const resolvedReferences = useMemo(() => {
		return referencedAddresses.map((addr) => {
			const feature = availableFeatures.find((f) => f.address === addr)
			return {
				address: addr,
				name: feature?.datasetName || feature?.name || 'Unknown Dataset',
			}
		})
	}, [referencedAddresses, availableFeatures])

	// Comment handlers
	const handleAttachGeometry = useCallback(() => {
		if (selectedFeatures.length === 0) return
		const collection: FeatureCollection = {
			type: 'FeatureCollection',
			features: selectedFeatures.map((f) => ({
				type: 'Feature' as const,
				id: f.id,
				geometry: f.geometry,
				properties: f.properties ?? {},
			})),
		}
		setAttachedGeojson(collection)
	}, [selectedFeatures])

	const handleClearAttachment = useCallback(() => {
		setAttachedGeojson(null)
	}, [])

	const handleCommentGeojsonVisibilityChange = useCallback(
		(comment: NDKGeoCommentEvent, visible: boolean) => {
			const id = comment.id ?? comment.commentId ?? ''
			setVisibleGeojsonCommentIds((prev) => {
				const next = new Set(prev)
				if (visible) {
					next.add(id)
				} else {
					next.delete(id)
				}
				return next
			})
			if (onCommentGeometryVisibility) {
				onCommentGeometryVisibility(id, visible ? (comment.geojson ?? null) : null)
			}
		},
		[onCommentGeometryVisibility],
	)

	const handleZoomToCommentGeojson = useCallback(
		(comment: NDKGeoCommentEvent) => {
			if (comment.boundingBox && onZoomToBounds) {
				onZoomToBounds(comment.boundingBox)
			} else if (comment.geojson && onZoomToBounds) {
				import('@turf/turf')
					.then((turf) => {
						const bbox = turf.bbox(comment.geojson!) as [number, number, number, number]
						if (bbox.every((v) => Number.isFinite(v))) {
							onZoomToBounds(bbox)
						}
					})
					.catch(() => {})
			}
		},
		[onZoomToBounds],
	)

	return (
		<div className={cn('flex flex-col h-full overflow-hidden', className)}>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
				<h2 className="text-base font-semibold text-gray-900">
					{initialCollection ? 'Edit Collection' : 'New Collection'}
				</h2>
				<Button size="icon-xs" variant="ghost" onClick={onClose}>
					<X className="h-4 w-4" />
				</Button>
			</div>

			{/* Tab buttons - only show for existing collections */}
			{initialCollection && (
				<div className="flex-shrink-0 flex items-center gap-1 px-4 pt-3 border-b border-gray-100 pb-2">
					<Button
						variant={activeTab === 'details' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => setActiveTab('details')}
						className="gap-1.5"
					>
						<FileText className="h-3.5 w-3.5" />
						Edit
					</Button>
					<Button
						variant={activeTab === 'comments' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => setActiveTab('comments')}
						className="gap-1.5"
					>
						<MessageCircle className="h-3.5 w-3.5" />
						Comments
					</Button>

					{/* Attach geometry button */}
					{activeTab === 'comments' && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant={attachedGeojson ? 'default' : 'outline'}
									size="sm"
									onClick={attachedGeojson ? handleClearAttachment : handleAttachGeometry}
									disabled={!canAttachGeometry && !attachedGeojson}
									className="ml-auto gap-1.5"
								>
									<MapPin className="h-3.5 w-3.5" />
									{attachedGeojson
										? `${attachedGeojson.features.length} attached`
										: selectedFeatures.length > 0
											? `Attach ${selectedFeatures.length}`
											: 'Select geometry'}
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								{attachedGeojson
									? 'Click to clear attached geometry'
									: 'Select geometries on the map, then click to attach to your comment'}
							</TooltipContent>
						</Tooltip>
					)}
				</div>
			)}

			<div className="flex-1 overflow-y-auto">
				{activeTab === 'details' ? (
					<div className="p-4 space-y-4">
						<div className="space-y-2">
							<Label htmlFor="collection-name">Name</Label>
							<Input
								id="collection-name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								placeholder="My Awesome Collection"
							/>
						</div>

						<div className="space-y-2">
							<Label>Description</Label>
							<div className="text-xs text-gray-500 mb-1">
								Describe your collection. Mention datasets using $ or drag them here.
							</div>
							<GeoRichTextEditor
								key={initialCollection?.id ?? initialCollection?.dTag ?? 'new'}
								ref={editorRef}
								initialValue={description}
								onChange={handleDescriptionChange}
								placeholder="This collection contains..."
								availableFeatures={availableFeatures}
								onMentionVisibilityToggle={onMentionVisibilityToggle}
								onMentionZoomTo={onMentionZoomTo}
								className="min-h-[150px]"
								rows={6}
							/>
						</div>

						{referencedAddresses.length > 0 && (
							<div className="space-y-2">
								<Label>Referenced Datasets ({referencedAddresses.length})</Label>
								<div className="bg-gray-50 rounded-md p-2 space-y-1">
									{resolvedReferences.map((ref) => {
										const isVisible = visibleReferenceAddrs.has(ref.address)
										return (
											<div
												key={ref.address}
												className="flex items-center gap-2 text-sm text-gray-700 bg-white border border-gray-200 rounded px-2 py-1"
											>
												<MapPin className="h-3 w-3 text-gray-400 flex-shrink-0" />
												<span className="truncate flex-1">{ref.name}</span>
												<Button
													size="icon-xs"
													variant="ghost"
													onClick={() => {
														setVisibleReferenceAddrs((prev) => {
															const next = new Set(prev)
															if (isVisible) {
																next.delete(ref.address)
															} else {
																next.add(ref.address)
															}
															return next
														})
														onMentionVisibilityToggle?.(ref.address, undefined, !isVisible)
													}}
													title={isVisible ? 'Hide on map' : 'Show on map'}
												>
													{isVisible ? (
														<Eye className="h-3 w-3 text-blue-600" />
													) : (
														<EyeOff className="h-3 w-3 text-gray-400" />
													)}
												</Button>
												<Button
													size="icon-xs"
													variant="ghost"
													onClick={() => onMentionZoomTo?.(ref.address, undefined)}
													title="Zoom to dataset"
												>
													<Maximize2 className="h-3 w-3" />
												</Button>
											</div>
										)
									})}
								</div>
							</div>
						)}
					</div>
				) : (
					<CommentsPanel
						key={initialCollection?.id ?? initialCollection?.dTag ?? 'no-target'}
						target={initialCollection ?? null}
						onCommentGeojsonVisibilityChange={handleCommentGeojsonVisibilityChange}
						onZoomToCommentGeojson={handleZoomToCommentGeojson}
						visibleGeojsonCommentIds={visibleGeojsonCommentIds}
						attachedGeojson={attachedGeojson}
						onClearAttachment={handleClearAttachment}
						availableFeatures={availableFeatures}
						onMentionVisibilityToggle={onMentionVisibilityToggle}
						onMentionZoomTo={onMentionZoomTo}
					/>
				)}
			</div>

			{/* Footer - only show on details tab */}
			{activeTab === 'details' && (
				<div className="p-4 border-t border-gray-100 flex justify-end gap-2">
					<Button variant="ghost" onClick={onClose} disabled={isSaving}>
						Cancel
					</Button>
					<Button
						onClick={handleSave}
						disabled={isSaving || !name.trim()}
						className="bg-emerald-600 hover:bg-emerald-700"
					>
						{isSaving ? 'Saving...' : 'Save Collection'}
					</Button>
				</div>
			)}
		</div>
	)
}

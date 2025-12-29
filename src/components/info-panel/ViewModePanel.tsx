import { Maximize2, X, FileText, MessageCircle, MapPin, Pencil } from 'lucide-react'
import { useState, useCallback, useMemo, useEffect } from 'react'
import type { FeatureCollection } from 'geojson'
import { useEditorStore } from '../../features/geo-editor/store'
import type { NDKGeoCollectionEvent } from '../../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../../lib/ndk/NDKGeoEvent'
import type { NDKGeoCommentEvent } from '../../lib/ndk/NDKGeoCommentEvent'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { DatasetActionCard } from './DatasetActionCard'
import { CommentsPanel } from '../comments'
import type { GeoFeatureItem } from '../editor/GeoRichTextEditor'

export interface ViewModePanelProps {
	currentUserPubkey?: string
	onLoadDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	deletingKey: string | null
	onExitViewMode?: () => void
	onClose?: () => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	/** Callback to add/remove comment GeoJSON overlay on map */
	onCommentGeometryVisibility?: (commentId: string, geojson: FeatureCollection | null) => void
	/** Callback to zoom to a bounding box */
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	/** Available features for $ mentions in comments */
	availableFeatures?: GeoFeatureItem[]
	/** Callback when a geo mention's visibility is toggled */
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	/** Callback to zoom to a mentioned geometry */
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
}

type ViewTab = 'details' | 'comments'

export interface ViewModePanelCallbacks {
	onCommentGeojsonVisibilityChange?: (comment: NDKGeoCommentEvent, visible: boolean) => void
	onZoomToCommentGeojson?: (comment: NDKGeoCommentEvent) => void
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
}

/**
 * Panel displayed when viewing a dataset or collection (not editing).
 * Shows metadata and actions for the viewed item with tabs for Details and Comments.
 */
export function ViewModePanel({
	currentUserPubkey,
	onLoadDataset,
	onToggleVisibility,
	onZoomToDataset,
	onDeleteDataset,
	onZoomToCollection,
	deletingKey,
	onExitViewMode,
	onClose,
	getDatasetKey,
	getDatasetName,
	onCommentGeometryVisibility,
	onZoomToBounds,
	availableFeatures = [],
	onMentionVisibilityToggle,
	onMentionZoomTo,
}: ViewModePanelProps) {
	const [activeTab, setActiveTab] = useState<ViewTab>('details')
	const [visibleGeojsonCommentIds, setVisibleGeojsonCommentIds] = useState<Set<string>>(new Set())
	const [attachedGeojson, setAttachedGeojson] = useState<FeatureCollection | null>(null)

	const isPublishing = useEditorStore((state) => state.isPublishing)
	const datasetVisibility = useEditorStore((state) => state.datasetVisibility)
	const viewCollection = useEditorStore((state) => state.viewCollection)
	const viewDataset = useEditorStore((state) => state.viewDataset)
	const viewCollectionEvents = useEditorStore((state) => state.viewCollectionEvents)
	const features = useEditorStore((state) => state.features)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const setViewMode = useEditorStore((state) => state.setViewMode)
	const setViewDataset = useEditorStore((state) => state.setViewDataset)
	const setViewCollection = useEditorStore((state) => state.setViewCollection)

	const headerTitle = viewCollection ? 'Collection overview' : 'Dataset overview'

	// Get the target for comments (either dataset or collection)
	const commentTarget = viewDataset ?? viewCollection

	// Switch to edit mode
	const handleSwitchToEdit = useCallback(() => {
		setViewMode('edit')
		setViewDataset(null)
		setViewCollection(null)
	}, [setViewMode, setViewDataset, setViewCollection])

	// Reset comment-related state when target changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on target change
	useEffect(() => {
		setVisibleGeojsonCommentIds(new Set())
		setAttachedGeojson(null)
	}, [viewDataset, viewCollection])

	// Get selected features for attachment
	const selectedFeatures = useMemo(() => {
		if (selectedFeatureIds.length === 0) return []
		return features.filter((f) => selectedFeatureIds.includes(f.id))
	}, [features, selectedFeatureIds])

	const canAttachGeometry = selectedFeatures.length > 0 && !attachedGeojson

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
			// Add/remove comment's GeoJSON from map layers
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
				// Calculate bounds from GeoJSON if no bbox tag
				const geojsonData = comment.geojson
				import('@turf/turf')
					.then((turf) => {
						const bbox = turf.bbox(geojsonData) as [number, number, number, number]
						if (bbox.every((v) => Number.isFinite(v))) {
							onZoomToBounds(bbox)
						}
					})
					.catch(() => {
						console.warn('Could not calculate bounds for comment GeoJSON')
					})
			}
		},
		[onZoomToBounds],
	)

	const renderDatasetCard = (event: NDKGeoEvent) => {
		const datasetKey = getDatasetKey(event)
		const datasetName = getDatasetName(event)
		const isVisible = datasetVisibility[datasetKey] !== false
		const isOwned = currentUserPubkey === event.pubkey

		return (
			<DatasetActionCard
				key={`${event.id}-${datasetKey}`}
				event={event}
				datasetKey={datasetKey}
				datasetName={datasetName}
				isVisible={isVisible}
				isOwned={isOwned}
				isPublishing={isPublishing}
				deletingKey={deletingKey}
				onLoadDataset={onLoadDataset}
				onToggleVisibility={onToggleVisibility}
				onZoomToDataset={onZoomToDataset}
				onDeleteDataset={onDeleteDataset}
			/>
		)
	}

	return (
		<div className="flex flex-col h-full text-sm">
			{/* Header */}
			<div className="flex-shrink-0 flex items-center justify-between gap-2 mb-3">
				<div className="flex items-center gap-2">
					<h2 className="text-lg font-bold text-gray-900">{headerTitle}</h2>
					<Button
						size="xs"
						variant="ghost"
						onClick={handleSwitchToEdit}
						title="Switch to edit mode"
						className="h-6 px-2 text-xs text-gray-500 hover:text-gray-700"
					>
						<Pencil className="h-3 w-3 mr-1" />
						Edit
					</Button>
				</div>
				<div className="flex gap-2">
					{onClose && (
						<Button
							size="icon"
							variant="ghost"
							onClick={onClose}
							aria-label="Close properties panel"
						>
							<X className="h-4 w-4" />
						</Button>
					)}
				</div>
			</div>

			{/* Tab buttons */}
			<div className="flex-shrink-0 flex items-center gap-1 mb-3 border-b border-gray-100 pb-2">
				<Button
					variant={activeTab === 'details' ? 'default' : 'ghost'}
					size="sm"
					onClick={() => setActiveTab('details')}
					className="gap-1.5"
				>
					<FileText className="h-3.5 w-3.5" />
					Details
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

				{/* Attach geometry button - only show when on comments tab */}
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
								? 'Click to clear attachment'
								: selectedFeatures.length > 0
									? 'Attach selected geometry to your comment'
									: 'Select geometry in the editor first, then attach it here'}
						</TooltipContent>
					</Tooltip>
				)}
			</div>

			{/* Tab content */}
			<div className="flex-1 overflow-y-auto min-h-0">
				{activeTab === 'details' ? (
					<div className="space-y-4">
						{/* Collection View */}
						{viewCollection && (
							<>
								<section className="rounded-lg border border-gray-200 p-3 space-y-2">
									<div className="flex items-center justify-between gap-2">
										<h3 className="text-base font-semibold text-gray-900">
											{viewCollection.metadata.name ?? viewCollection.collectionId}
										</h3>
										{onZoomToCollection && (
											<Button
												size="sm"
												variant="outline"
												onClick={() => onZoomToCollection(viewCollection, viewCollectionEvents)}
											>
												<Maximize2 className="h-3 w-3" />
												Zoom bounds
											</Button>
										)}
									</div>
									{viewCollection.metadata.description && (
										<p className="text-sm text-gray-600 whitespace-pre-line">
											{viewCollection.metadata.description}
										</p>
									)}
									<div className="text-[11px] text-gray-500">
										Maintainer: {viewCollection.pubkey.slice(0, 8)}…
										{viewCollection.pubkey.slice(-4)}
									</div>
									<div className="text-[11px] text-gray-500">
										{viewCollection.datasetReferences.length} linked dataset
										{viewCollection.datasetReferences.length === 1 ? '' : 's'}
									</div>
									{viewCollection.metadata.tags && viewCollection.metadata.tags.length > 0 && (
										<div className="flex flex-wrap gap-1">
											{viewCollection.metadata.tags.slice(0, 5).map((tag) => (
												<span
													key={tag}
													className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700"
												>
													#{tag}
												</span>
											))}
										</div>
									)}
								</section>

								<section className="space-y-2">
									<h4 className="text-sm font-semibold text-gray-800">Linked geo events</h4>
									{viewCollectionEvents.length === 0 ? (
										<p className="text-xs text-gray-500">
											No linked geo events are currently loaded. Listen for their coordinates or
											load datasets first.
										</p>
									) : (
										<div className="space-y-2">
											{viewCollectionEvents.map((event) => renderDatasetCard(event))}
										</div>
									)}
								</section>
							</>
						)}

						{/* Dataset View (without collection) */}
						{viewDataset && !viewCollection && (
							<>
								<section className="rounded-lg border border-gray-200 p-3 space-y-2">
									<div className="text-base font-semibold text-gray-900">
										{getDatasetName(viewDataset)}
									</div>
									<div className="text-[11px] text-gray-500">
										Owner: {viewDataset.pubkey.slice(0, 8)}…{viewDataset.pubkey.slice(-4)}
									</div>
									{viewDataset.hashtags.length > 0 && (
										<div className="flex flex-wrap gap-1">
											{viewDataset.hashtags.slice(0, 5).map((tag) => (
												<span
													key={tag}
													className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700"
												>
													#{tag}
												</span>
											))}
										</div>
									)}
									<div className="text-xs text-gray-600 space-y-1">
										<div>
											Bounding box:{' '}
											{viewDataset.boundingBox
												? viewDataset.boundingBox.join(', ')
												: 'Not provided'}
										</div>
										<div>Geohash: {viewDataset.geohash ?? '—'}</div>
										<div>Collections referenced: {viewDataset.collectionReferences.length}</div>
									</div>
								</section>

								<section className="space-y-2">
									<h4 className="text-sm font-semibold text-gray-800">Dataset controls</h4>
									{renderDatasetCard(viewDataset)}
								</section>
							</>
						)}
					</div>
				) : (
					<CommentsPanel
						key={commentTarget?.id ?? commentTarget?.dTag ?? 'no-target'}
						target={commentTarget}
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
		</div>
	)
}

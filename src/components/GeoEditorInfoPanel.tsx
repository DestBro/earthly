import { X } from 'lucide-react'
import type { FeatureCollection } from 'geojson'
import { cn } from '@/lib/utils'
import { useEditorStore } from '../features/geo-editor/store'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import {
	BlobReferencesSection,
	DatasetMetadataSection,
	GeometriesTable,
	ViewModePanel,
} from './info-panel'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'

export interface GeoEditorInfoPanelProps {
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

export function GeoEditorInfoPanelContent(props: GeoEditorInfoPanelProps) {
	const {
		onLoadDataset,
		onToggleVisibility,
		onZoomToDataset,
		onDeleteDataset,
		onZoomToCollection,
		currentUserPubkey,
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
	} = props

	// Store state
	const stats = useEditorStore((state) => state.stats)
	const features = useEditorStore((state) => state.features)
	const activeDataset = useEditorStore((state) => state.activeDataset)
	const publishMessage = useEditorStore((state) => state.publishMessage)
	const publishError = useEditorStore((state) => state.publishError)
	const viewMode = useEditorStore((state) => state.viewMode)

	const activeDatasetInfo = activeDataset
		? {
				name: getDatasetName(activeDataset),
				isOwner: currentUserPubkey === activeDataset.pubkey,
			}
		: null

	// View mode - delegate to ViewModePanel
	if (viewMode === 'view') {
		return (
			<ViewModePanel
				currentUserPubkey={currentUserPubkey}
				onLoadDataset={onLoadDataset}
				onToggleVisibility={onToggleVisibility}
				onZoomToDataset={onZoomToDataset}
				onDeleteDataset={onDeleteDataset}
				onZoomToCollection={onZoomToCollection}
				deletingKey={deletingKey}
				onExitViewMode={onExitViewMode}
				onClose={onClose}
				getDatasetKey={getDatasetKey}
				getDatasetName={getDatasetName}
				onCommentGeometryVisibility={onCommentGeometryVisibility}
				onZoomToBounds={onZoomToBounds}
				availableFeatures={availableFeatures}
				onMentionVisibilityToggle={onMentionVisibilityToggle}
				onMentionZoomTo={onMentionZoomTo}
			/>
		)
	}

	// Edit mode - compact layout
	return (
		<div className="space-y-2 text-sm">
			{/* Header */}
			<div className="flex items-center justify-between gap-2 pb-1 border-b border-gray-100">
				<div>
					<h2 className="text-base font-semibold text-gray-900">Editor</h2>
					{activeDatasetInfo && (
						<p className="text-[10px] text-gray-500">
							{activeDatasetInfo.name} {activeDatasetInfo.isOwner ? '' : '(copy)'}
						</p>
					)}
				</div>
				{onClose && (
					<Button size="icon-xs" variant="ghost" onClick={onClose} aria-label="Close">
						<X className="h-3 w-3" />
					</Button>
				)}
			</div>

			{/* Stats row - inline */}
			<div className="flex items-center gap-3 text-[10px] text-gray-500">
				<span>{stats.points} pts</span>
				<span>{stats.lines} lines</span>
				<span>{stats.polygons} polys</span>
			</div>

			{/* Dataset Metadata - collapsible */}
			<Collapsible defaultOpen>
				<CollapsibleTrigger className="text-xs font-medium text-gray-700 hover:text-gray-900 w-full text-left py-1">
					Dataset info
				</CollapsibleTrigger>
				<CollapsibleContent>
					<DatasetMetadataSection />
				</CollapsibleContent>
			</Collapsible>

			{/* Blob References - collapsible */}
			<Collapsible defaultOpen={false}>
				<CollapsibleTrigger className="text-xs font-medium text-gray-700 hover:text-gray-900 w-full text-left py-1">
					External references
				</CollapsibleTrigger>
				<CollapsibleContent>
					<BlobReferencesSection />
				</CollapsibleContent>
			</Collapsible>

			{/* Geometries table */}
			<div className="flex flex-col min-h-0">
				<div className="text-xs font-medium text-gray-700 py-1">Geometries ({features.length})</div>
				<GeometriesTable className="max-h-[50vh] overflow-y-auto" />
			</div>

			{/* Publishing Status */}
			{(publishMessage || publishError) && (
				<div className="text-[10px] pt-1">
					{publishMessage && <p className="text-green-600">{publishMessage}</p>}
					{publishError && <p className="text-red-600">{publishError}</p>}
				</div>
			)}
		</div>
	)
}

export function GeoEditorInfoPanel({
	className,
	...props
}: GeoEditorInfoPanelProps & { className?: string }) {
	return (
		<div className={cn('w-80 rounded-xl bg-white p-3 shadow-lg', className)}>
			<GeoEditorInfoPanelContent {...props} />
		</div>
	)
}

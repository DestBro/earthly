import { Maximize2, X } from 'lucide-react'
import { useEditorStore } from '../../features/geo-editor/store'
import type { NDKGeoCollectionEvent } from '../../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../../lib/ndk/NDKGeoEvent'
import { Button } from '../ui/button'
import { DatasetActionCard } from './DatasetActionCard'

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
}

/**
 * Panel displayed when viewing a dataset or collection (not editing).
 * Shows metadata and actions for the viewed item.
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
}: ViewModePanelProps) {
	const isPublishing = useEditorStore((state) => state.isPublishing)
	const datasetVisibility = useEditorStore((state) => state.datasetVisibility)
	const viewCollection = useEditorStore((state) => state.viewCollection)
	const viewDataset = useEditorStore((state) => state.viewDataset)
	const viewCollectionEvents = useEditorStore((state) => state.viewCollectionEvents)

	const headerTitle = viewCollection ? 'Collection overview' : 'Dataset overview'
	const subtitle = viewCollection
		? 'Inspect linked datasets and metadata'
		: 'Inspect dataset metadata without editing'

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
		<div className="space-y-4 text-sm">
			{/* Header */}
			<div className="flex items-center justify-between gap-2">
				<div>
					<h2 className="text-lg font-bold text-gray-900">{headerTitle}</h2>
					<p className="text-xs text-gray-500">{subtitle}</p>
				</div>
				<div className="flex gap-2">
					{onExitViewMode && (
						<Button variant="outline" size="sm" onClick={onExitViewMode}>
							Back to editing
						</Button>
					)}
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
							Maintainer: {viewCollection.pubkey.slice(0, 8)}…{viewCollection.pubkey.slice(-4)}
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
								No linked geo events are currently loaded. Listen for their coordinates or load
								datasets first.
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
								{viewDataset.boundingBox ? viewDataset.boundingBox.join(', ') : 'Not provided'}
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
	)
}

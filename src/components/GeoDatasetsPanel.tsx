import { Plus, Eye } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import {
	type CollectionColumnsContext,
	type CollectionRowData,
	createCollectionColumns,
} from './collections-columns'
import {
	DatasetFilterToolbar,
	useFilterState,
	useSortedFilteredItems,
	type FilterConfig,
} from './data-filter'
import {
	createDatasetColumns,
	type DatasetColumnsContext,
	type DatasetRowData,
} from './datasets-columns'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import { Button } from './ui/button'
import { DataTable } from './ui/data-table'

export interface GeoDatasetsPanelProps {
	/** Which content to display: 'datasets' or 'collections' */
	mode: 'datasets' | 'collections'
	geoEvents: NDKGeoEvent[]
	collectionEvents: NDKGeoCollectionEvent[]
	activeDataset: NDKGeoEvent | null
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	collectionVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	onClearEditing: () => void
	onLoadDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onToggleCollectionVisibility: (collection: NDKGeoCollectionEvent) => void
	onToggleAllCollectionVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectDataset?: (event: NDKGeoEvent) => void
	onInspectCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onOpenDebug?: (event: NDKGeoEvent | NDKGeoCollectionEvent) => void
	onCreateCollection?: () => void
	onEditCollection?: (collection: NDKGeoCollectionEvent) => void
	availableFeatures?: GeoFeatureItem[]
	/** Whether focus mode is active (viewing a single dataset/collection via route) */
	isFocused?: boolean
	/** Callback to exit focus mode */
	onExitFocus?: () => void
	/** Callback when filtered dataset keys change (for map visibility sync) */
	onFilteredDatasetKeysChange?: (keys: Set<string>) => void
	/** Set of dataset keys currently resolving blob references */
	resolvingDatasets?: Set<string>
}

const getDatasetDescriptionText = (event: NDKGeoEvent): string | undefined => {
	const featureCollection = event.featureCollection as Record<string, any>
	if (!featureCollection) return undefined
	const candidates = [
		featureCollection?.description,
		featureCollection?.summary,
		featureCollection?.properties?.description,
		featureCollection?.properties?.summary,
	]
	for (const value of candidates) {
		if (typeof value === 'string' && value.trim().length > 0) {
			return value
		}
	}
	return undefined
}

const getCollectionDisplayName = (collection: NDKGeoCollectionEvent): string => {
	const metadata = collection.metadata
	return metadata.name ?? collection.collectionId ?? collection.id ?? 'Untitled'
}

// Filter configs for the abstract filter system
const createDatasetFilterConfig = (
	getDatasetName: (event: NDKGeoEvent) => string,
): FilterConfig<NDKGeoEvent> => ({
	getSearchableText: (event) => [getDatasetName(event), getDatasetDescriptionText(event)],
	getName: (event) => getDatasetName(event),
})

const collectionFilterConfig: FilterConfig<NDKGeoCollectionEvent> = {
	getSearchableText: (collection) => {
		const metadata = collection.metadata
		return [metadata.name, metadata.description, collection.collectionId, collection.id]
	},
	getName: (collection) => getCollectionDisplayName(collection),
}

export function GeoDatasetsPanelContent({
	mode,
	geoEvents,
	collectionEvents,
	activeDataset,
	currentUserPubkey,
	datasetVisibility,
	collectionVisibility,
	isPublishing,
	deletingKey,
	onClearEditing,
	onLoadDataset,
	onToggleVisibility,
	onToggleAllVisibility,
	onToggleCollectionVisibility,
	onToggleAllCollectionVisibility,
	onZoomToDataset,
	onDeleteDataset,
	getDatasetKey,
	getDatasetName,
	onZoomToCollection,
	onInspectDataset,
	onInspectCollection,
	onOpenDebug,
	onCreateCollection,
	onEditCollection,
	availableFeatures = [],
	isFocused = false,
	onExitFocus,
	onFilteredDatasetKeysChange,
	resolvingDatasets = new Set<string>(),
}: GeoDatasetsPanelProps) {
	// Filter state and hooks
	const filterState = useFilterState()

	const datasetFilterConfig = useMemo(
		() => createDatasetFilterConfig(getDatasetName),
		[getDatasetName],
	)

	const datasetResult = useSortedFilteredItems(geoEvents, datasetFilterConfig, filterState)

	const collectionResult = useSortedFilteredItems(
		collectionEvents,
		collectionFilterConfig,
		filterState,
	)

	const filteredGeoEvents = datasetResult.items
	const filteredCollections = collectionResult.items

	// Track previous keys to avoid infinite update loops
	const prevFilteredKeysRef = useRef<Set<string> | null>(null)

	// Report filtered dataset keys to parent for map visibility sync
	useEffect(() => {
		if (!onFilteredDatasetKeysChange) return
		// Only sync dataset filters to the map when the dataset list is active.
		// (Collections view shouldn't implicitly hide datasets on the map.)
		if (mode !== 'datasets') return
		const keys = new Set(filteredGeoEvents.map((event) => getDatasetKey(event)))

		// Only update if keys actually changed
		const prevKeys = prevFilteredKeysRef.current
		if (prevKeys && keys.size === prevKeys.size) {
			let same = true
			for (const k of keys) {
				if (!prevKeys.has(k)) {
					same = false
					break
				}
			}
			if (same) return
		}

		prevFilteredKeysRef.current = keys
		onFilteredDatasetKeysChange(keys)
	}, [filteredGeoEvents, getDatasetKey, mode, onFilteredDatasetKeysChange])

	const datasetReferenceMap = useMemo(() => {
		const map = new Map<string, NDKGeoEvent>()
		geoEvents.forEach((event) => {
			const datasetId = event.datasetId ?? event.dTag ?? event.id
			if (!datasetId) return
			const kind = event.kind ?? NDKGeoEvent.kinds[0]
			map.set(`${kind}:${event.pubkey}:${datasetId}`, event)
		})
		return map
	}, [geoEvents])

	// Prepare dataset table data
	const datasetTableData: DatasetRowData[] = useMemo(() => {
		return filteredGeoEvents.map((event) => {
			const datasetKey = getDatasetKey(event)
			const isActive = activeDataset && getDatasetKey(activeDataset) === datasetKey
			const isOwned = currentUserPubkey === event.pubkey
			const primaryLabel = isActive ? 'Loaded in editor' : isOwned ? 'Edit dataset' : 'Load copy'
			const datasetName = getDatasetName(event)
			const isVisible = datasetVisibility[datasetKey] !== false

			return {
				event,
				datasetKey,
				datasetName,
				isActive: !!isActive,
				isOwned,
				isVisible,
				primaryLabel,
			}
		})
	}, [
		filteredGeoEvents,
		activeDataset,
		currentUserPubkey,
		datasetVisibility,
		getDatasetKey,
		getDatasetName,
	])

	// Compute visibility state for all filtered datasets (for header checkbox)
	const allVisibleState = useMemo((): 'all' | 'none' | 'some' => {
		if (datasetTableData.length === 0) return 'none'
		const visibleCount = datasetTableData.filter((row) => row.isVisible).length
		if (visibleCount === 0) return 'none'
		if (visibleCount === datasetTableData.length) return 'all'
		return 'some'
	}, [datasetTableData])

	// Get collection key for visibility
	const getCollectionKey = (collection: NDKGeoCollectionEvent): string => {
		return collection.dTag ?? collection.id ?? collection.collectionId ?? ''
	}

	// Prepare collection table data
	const collectionTableData: CollectionRowData[] = useMemo(() => {
		return filteredCollections.map((collection) => {
			const collectionName = getCollectionDisplayName(collection)
			const datasetCount = collection.datasetReferences.length
			const referencedEvents = collection.datasetReferences
				.map((reference) => datasetReferenceMap.get(reference))
				.filter((event): event is NDKGeoEvent => Boolean(event))
			const zoomDisabled =
				!onZoomToCollection || (!collection.boundingBox && referencedEvents.length === 0)
			const collectionKey = getCollectionKey(collection)
			const isVisible = collectionVisibility[collectionKey] !== false

			return {
				collection,
				collectionName,
				datasetCount,
				referencedEvents,
				zoomDisabled,
				isVisible,
			}
		})
	}, [filteredCollections, datasetReferenceMap, onZoomToCollection, collectionVisibility])

	// Compute visibility state for all filtered collections (for header checkbox)
	const allCollectionVisibleState = useMemo((): 'all' | 'none' | 'some' => {
		if (collectionTableData.length === 0) return 'none'
		const visibleCount = collectionTableData.filter((row) => row.isVisible).length
		if (visibleCount === 0) return 'none'
		if (visibleCount === collectionTableData.length) return 'all'
		return 'some'
	}, [collectionTableData])

	// Dataset columns context
	const datasetColumnsContext: DatasetColumnsContext = useMemo(
		() => ({
			onLoadDataset,
			onDeleteDataset,
			onToggleVisibility,
			onToggleAllVisibility,
			onZoomToDataset,
			onInspectDataset,
			onOpenDebug,
			isPublishing,
			deletingKey,
			allVisibleState,
			resolvingDatasets,
		}),
		[
			onLoadDataset,
			onDeleteDataset,
			onToggleVisibility,
			onToggleAllVisibility,
			onZoomToDataset,
			onInspectDataset,
			onOpenDebug,
			resolvingDatasets,
			isPublishing,
			deletingKey,
			allVisibleState,
		],
	)

	// Collection columns context
	const collectionColumnsContext: CollectionColumnsContext = useMemo(
		() => ({
			onZoomToCollection,
			onInspectCollection,
			onOpenDebug,
			getDatasetName,
			onEditCollection,
			onToggleVisibility: onToggleCollectionVisibility,
			onToggleAllVisibility: onToggleAllCollectionVisibility,
			currentUserPubkey,
			allVisibleState: allCollectionVisibleState,
		}),
		[
			onZoomToCollection,
			onInspectCollection,
			onOpenDebug,
			getDatasetName,
			onEditCollection,
			onToggleCollectionVisibility,
			onToggleAllCollectionVisibility,
			currentUserPubkey,
			allCollectionVisibleState,
		],
	)

	const datasetColumns = useMemo(
		() => createDatasetColumns(datasetColumnsContext),
		[datasetColumnsContext],
	)

	const collectionColumns = useMemo(
		() => createCollectionColumns(collectionColumnsContext),
		[collectionColumnsContext],
	)

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<div>
					<h3 className="text-base font-semibold text-gray-800">
						{mode === 'datasets' ? 'Datasets' : 'Collections'}
					</h3>
					{isFocused ? (
						<p className="text-xs text-amber-600">Focused view — others hidden</p>
					) : (
						<p className="text-xs text-gray-500">
							{mode === 'datasets'
								? 'Remote GeoJSON datasets available to load.'
								: 'Curated collections of datasets.'}
						</p>
					)}
				</div>
				<div className="flex items-center gap-1">
					{isFocused && onExitFocus && (
						<Button size="sm" variant="outline" onClick={onExitFocus} className="text-xs">
							<Eye className="h-3.5 w-3.5 mr-1" />
							Show all
						</Button>
					)}
					{mode === 'collections' && onCreateCollection && (
						<Button
							size="icon"
							variant="outline"
							onClick={onCreateCollection}
							aria-label="Create new collection"
							title="Create new collection"
						>
							<Plus className="h-4 w-4" />
						</Button>
					)}
				</div>
			</div>

			<DatasetFilterToolbar
				{...filterState}
				totalCount={mode === 'datasets' ? datasetResult.totalCount : collectionResult.totalCount}
				filteredCount={
					mode === 'datasets' ? datasetResult.filteredCount : collectionResult.filteredCount
				}
				displayedCount={
					mode === 'datasets' ? datasetResult.displayedCount : collectionResult.displayedCount
				}
				hasMore={mode === 'datasets' ? datasetResult.hasMore : collectionResult.hasMore}
			/>

			{mode === 'datasets' ? (
				geoEvents.length === 0 ? (
					<p className="text-xs text-gray-500">Listening for GeoJSON datasets…</p>
				) : filteredGeoEvents.length === 0 ? (
					<p className="text-xs text-gray-500">No datasets match your filters.</p>
				) : (
					<DataTable
						columns={datasetColumns}
						data={datasetTableData}
						getRowClassName={(row) => (!row.isVisible ? 'opacity-60' : undefined)}
					/>
				)
			) : collectionEvents.length === 0 ? (
				<p className="text-xs text-gray-500">Listening for GeoJSON collections…</p>
			) : filteredCollections.length === 0 ? (
				<p className="text-xs text-gray-500">No collections match your filters.</p>
			) : (
				<DataTable
					columns={collectionColumns}
					data={collectionTableData}
					getRowClassName={(row) => (!row.isVisible ? 'opacity-60' : undefined)}
				/>
			)}
		</div>
	)
}

export function GeoDatasetsSidebar({
	className,
	...props
}: GeoDatasetsPanelProps & { className?: string }) {
	return (
		<div className={cn('glass-panel w-80 rounded-lg p-3', className)}>
			<GeoDatasetsPanelContent {...props} />
		</div>
	)
}

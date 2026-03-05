import { useCallback, useMemo, useState } from 'react'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import {
	type CollectionColumnsContext,
	type CollectionRowData,
	createCollectionColumns,
} from '../features/collections/collections-columns'
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
import { Button } from './ui/button'
import { DataTable } from './ui/data-table'
import { UserProfile } from './user-profile/UserProfile'

export interface UserProfilePanelProps {
	/** The pubkey of the user to display */
	pubkey: string
	/** All available geo events */
	geoEvents: NDKGeoEvent[]
	/** All available collection events */
	collectionEvents: NDKGeoCollectionEvent[]
	/** Current logged-in user's pubkey */
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	collectionVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	// Dataset callbacks
	onLoadDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onInspectDataset?: (event: NDKGeoEvent) => void
	// Collection callbacks
	onToggleCollectionVisibility: (collection: NDKGeoCollectionEvent) => void
	onToggleAllCollectionVisibility: (visible: boolean) => void
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onEditCollection?: (collection: NDKGeoCollectionEvent) => void
	onOpenDebug?: (event: NDKGeoEvent | NDKGeoCollectionEvent) => void
}

type TabMode = 'datasets' | 'collections'

const getDatasetDescriptionText = (event: NDKGeoEvent): string | undefined => {
	const featureCollection = event.featureCollection as Record<string, unknown>
	if (!featureCollection) return undefined
	const candidates = [
		featureCollection?.description,
		featureCollection?.summary,
		(featureCollection?.properties as Record<string, unknown>)?.description,
		(featureCollection?.properties as Record<string, unknown>)?.summary,
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

export function UserProfilePanel({
	pubkey,
	geoEvents,
	collectionEvents,
	currentUserPubkey,
	datasetVisibility,
	collectionVisibility,
	isPublishing,
	deletingKey,
	onLoadDataset,
	onToggleVisibility,
	onToggleAllVisibility,
	onZoomToDataset,
	onDeleteDataset,
	getDatasetKey,
	getDatasetName,
	onInspectDataset,
	onToggleCollectionVisibility,
	onToggleAllCollectionVisibility,
	onZoomToCollection,
	onInspectCollection,
	onEditCollection,
	onOpenDebug,
}: UserProfilePanelProps) {
	const [activeTab, setActiveTab] = useState<TabMode>('datasets')
	const filterState = useFilterState()

	const isOwnProfile = currentUserPubkey === pubkey

	// Filter events to only show items owned by this user
	const userGeoEvents = useMemo(
		() => geoEvents.filter((event) => event.pubkey === pubkey),
		[geoEvents, pubkey],
	)

	const userCollectionEvents = useMemo(
		() => collectionEvents.filter((event) => event.pubkey === pubkey),
		[collectionEvents, pubkey],
	)

	// Build reference map for collections
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

	// Filter configs
	const datasetFilterConfig = useMemo(
		() => createDatasetFilterConfig(getDatasetName),
		[getDatasetName],
	)

	// Apply sorting/filtering to user's items
	const datasetResult = useSortedFilteredItems(userGeoEvents, datasetFilterConfig, filterState)
	const collectionResult = useSortedFilteredItems(
		userCollectionEvents,
		collectionFilterConfig,
		filterState,
	)

	const filteredGeoEvents = datasetResult.items
	const filteredCollections = collectionResult.items

	// Dataset table data
	const datasetTableData: DatasetRowData[] = useMemo(() => {
		return filteredGeoEvents.map((event) => {
			const datasetKey = getDatasetKey(event)
			const isVisible = datasetVisibility[datasetKey] !== false
			const datasetName = getDatasetName(event)

			return {
				event,
				datasetKey,
				datasetName,
				isActive: false,
				isOwned: true, // All items in this panel are owned by the profile user
				isVisible,
				primaryLabel: isOwnProfile ? 'Edit dataset' : 'Load copy',
			}
		})
	}, [filteredGeoEvents, datasetVisibility, getDatasetKey, getDatasetName, isOwnProfile])

	// Visibility state for datasets
	const allVisibleState = useMemo((): 'all' | 'none' | 'some' => {
		if (datasetTableData.length === 0) return 'none'
		const visibleCount = datasetTableData.filter((row) => row.isVisible).length
		if (visibleCount === 0) return 'none'
		if (visibleCount === datasetTableData.length) return 'all'
		return 'some'
	}, [datasetTableData])

	// Collection key helper
	const getCollectionKey = useCallback((collection: NDKGeoCollectionEvent): string => {
		return collection.dTag ?? collection.id ?? collection.collectionId ?? ''
	}, [])

	// Collection table data
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
	}, [
		filteredCollections,
		datasetReferenceMap,
		onZoomToCollection,
		collectionVisibility,
		getCollectionKey,
	])

	// Visibility state for collections
	const allCollectionVisibleState = useMemo((): 'all' | 'none' | 'some' => {
		if (collectionTableData.length === 0) return 'none'
		const visibleCount = collectionTableData.filter((row) => row.isVisible).length
		if (visibleCount === 0) return 'none'
		if (visibleCount === collectionTableData.length) return 'all'
		return 'some'
	}, [collectionTableData])

	// Dataset columns context
	// Note: resolvingDatasets/resolvingProgress not included - DatasetLoadButton subscribes directly to store
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
		}),
		[
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

	const activeResult = activeTab === 'datasets' ? datasetResult : collectionResult

	return (
		<div className="space-y-4">
			{/* User Profile Header */}
			<div className="px-1">
				<UserProfile
					pubkey={pubkey}
					mode="avatar-name-bio"
					size="lg"
					showNip05Badge={true}
					showBio={true}
				/>
				{isOwnProfile && <p className="text-xs text-emerald-600 mt-2">This is your profile</p>}
			</div>

			{/* Tabs */}
			<div className="flex gap-1 border-b border-gray-200">
				<Button
					variant={activeTab === 'datasets' ? 'default' : 'ghost'}
					size="sm"
					onClick={() => setActiveTab('datasets')}
					className="rounded-b-none"
				>
					Datasets ({userGeoEvents.length})
				</Button>
				<Button
					variant={activeTab === 'collections' ? 'default' : 'ghost'}
					size="sm"
					onClick={() => setActiveTab('collections')}
					className="rounded-b-none"
				>
					Collections ({userCollectionEvents.length})
				</Button>
			</div>

			{/* Filter toolbar */}
			<DatasetFilterToolbar
				{...filterState}
				totalCount={activeResult.totalCount}
				filteredCount={activeResult.filteredCount}
				displayedCount={activeResult.displayedCount}
				hasMore={activeResult.hasMore}
			/>

			{/* Content */}
			{activeTab === 'datasets' ? (
				userGeoEvents.length === 0 ? (
					<p className="text-xs text-gray-500">No datasets published by this user.</p>
				) : filteredGeoEvents.length === 0 ? (
					<p className="text-xs text-gray-500">No datasets match your filters.</p>
				) : (
					<DataTable
						columns={datasetColumns}
						data={datasetTableData}
						getRowId={(row) => row.datasetKey}
						getRowClassName={(row) => (!row.isVisible ? 'opacity-60' : undefined)}
					/>
				)
			) : userCollectionEvents.length === 0 ? (
				<p className="text-xs text-gray-500">No collections created by this user.</p>
			) : filteredCollections.length === 0 ? (
				<p className="text-xs text-gray-500">No collections match your filters.</p>
			) : (
				<DataTable
					columns={collectionColumns}
					data={collectionTableData}
					getRowId={(row) =>
						row.collection.dTag ??
						row.collection.collectionId ??
						row.collection.id ??
						row.collection.pubkey
					}
					getRowClassName={(row) => (!row.isVisible ? 'opacity-60' : undefined)}
				/>
			)}
		</div>
	)
}

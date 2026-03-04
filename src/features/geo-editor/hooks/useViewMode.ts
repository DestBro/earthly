import { useCallback, useState } from 'react'
import { nip19 } from 'nostr-tools'
import type { NDKGeoCollectionEvent } from '@/lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import type { NDKMapContextEvent } from '@/lib/ndk/NDKMapContextEvent'
import { GEO_EVENT_KIND } from '@/lib/ndk/kinds'
import { useEditorStore } from '../store'

interface UseViewModeOptions {
	geoEvents: NDKGeoEvent[]
	onEnsureInfoPanelVisible: () => void
	onNavigateToFocus?: (
		focusType: 'geoevent' | 'collection' | 'mapcontext',
		naddr: string,
		sidebarView?: 'datasets' | 'collections' | 'contexts',
	) => void
	onClearRouteFocus?: () => void
	/** Callback to zoom/fly to a dataset's bounds */
	onZoomToDataset?: (event: NDKGeoEvent) => void
	/** Callback to zoom/fly to a collection's bounds */
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
}

/**
 * Generate naddr for a geo event
 */
function encodeGeoEventNaddr(event: NDKGeoEvent): string | null {
	const identifier = event.datasetId ?? event.dTag
	if (!identifier || !event.kind) return null

	try {
		return nip19.naddrEncode({
			kind: event.kind,
			pubkey: event.pubkey,
			identifier,
		})
	} catch {
		return null
	}
}

/**
 * Generate naddr for a collection
 */
function encodeCollectionNaddr(event: NDKGeoCollectionEvent): string | null {
	const identifier = event.dTag
	if (!identifier || !event.kind) return null

	try {
		return nip19.naddrEncode({
			kind: event.kind,
			pubkey: event.pubkey,
			identifier,
		})
	} catch {
		return null
	}
}

export function useViewMode({
	geoEvents,
	onEnsureInfoPanelVisible,
	onNavigateToFocus,
	onClearRouteFocus,
	onZoomToDataset,
	onZoomToCollection,
}: UseViewModeOptions) {
	const [infoMode, setInfoMode] = useState<'properties' | 'json' | 'edit' | 'view'>('properties')
	const [sidebarMode, setSidebarMode] = useState<
		'datasets' | 'info' | 'editor' | 'dataset' | 'inspector'
	>('datasets')
	const [debugEvent, setDebugEvent] = useState<
		NDKGeoEvent | NDKGeoCollectionEvent | NDKMapContextEvent | null
	>(null)
	const [debugDialogOpen, setDebugDialogOpen] = useState(false)

	// Store state
	const viewingDataset = useEditorStore((state) => state.viewDataset)
	const viewingCollection = useEditorStore((state) => state.viewCollection)

	// Store actions
	const setViewingDataset = useEditorStore((state) => state.setViewDataset)
	const setViewingCollection = useEditorStore((state) => state.setViewCollection)
	const setViewingCollectionEvents = useEditorStore((state) => state.setViewCollectionEvents)
	const setViewingContext = useEditorStore((state) => state.setViewContext)
	const setViewingContextDatasets = useEditorStore((state) => state.setViewContextDatasets)
	const setViewingContextCollections = useEditorStore((state) => state.setViewContextCollections)
	const setViewMode = useEditorStore((state) => state.setViewMode)
	const clearFocused = useEditorStore((state) => state.clearFocused)

	const resolveEventsForCollection = useCallback(
		(collection: NDKGeoCollectionEvent): NDKGeoEvent[] => {
			const references = new Set(collection.datasetReferences)
			if (references.size === 0) return []
			return geoEvents.filter((event) => {
				const datasetId = event.datasetId ?? event.dTag ?? event.id
				if (!datasetId) return false
				const coordinate = `${event.kind ?? GEO_EVENT_KIND}:${event.pubkey}:${datasetId}`
				return references.has(coordinate)
			})
		},
		[geoEvents],
	)

	const exitViewMode = useCallback(() => {
		setInfoMode('edit')
		setViewMode('edit')
		setViewingDataset(null)
		setViewingCollection(null)
		setViewingCollectionEvents([])
		setViewingContext(null)
		setViewingContextDatasets([])
		setViewingContextCollections([])
		setSidebarMode('editor')
		// Clear URL and focus state
		clearFocused()
		onClearRouteFocus?.()
	}, [
		setViewingDataset,
		setViewingCollection,
		setViewingCollectionEvents,
		setViewingContext,
		setViewingContextDatasets,
		setViewingContextCollections,
		setViewMode,
		clearFocused,
		onClearRouteFocus,
	])

	const handleInspectDataset = useCallback(
		(event: NDKGeoEvent) => {
			setViewingDataset(event)
			setViewingCollection(null)
			setViewingCollectionEvents([])
			setViewingContext(null)
			setViewingContextDatasets([])
			setViewingContextCollections([])
			setInfoMode('view')
			setViewMode('view')
			setSidebarMode('dataset')
			onEnsureInfoPanelVisible()

			// Update URL with naddr
			const naddr = encodeGeoEventNaddr(event)
			if (naddr) {
				onNavigateToFocus?.('geoevent', naddr, 'datasets')
			}

			// Fly to the dataset bounds
			onZoomToDataset?.(event)
		},
		[
			setViewingDataset,
			setViewingCollection,
			setViewingCollectionEvents,
			setViewingContext,
			setViewingContextDatasets,
			setViewingContextCollections,
			setViewMode,
			onEnsureInfoPanelVisible,
			onNavigateToFocus,
			onZoomToDataset,
		],
	)

	/**
	 * Inspect a dataset without triggering focus mode (no URL update).
	 * Used when clicking on a geometry on the map.
	 */
	const handleInspectDatasetWithoutFocus = useCallback(
		(event: NDKGeoEvent) => {
			setViewingDataset(event)
			setViewingCollection(null)
			setViewingCollectionEvents([])
			setViewingContext(null)
			setViewingContextDatasets([])
			setViewingContextCollections([])
			setInfoMode('view')
			setViewMode('view')
			setSidebarMode('dataset')
			onEnsureInfoPanelVisible()
			// Do NOT update URL - this prevents focus mode from being triggered
		},
		[
			setViewingDataset,
			setViewingCollection,
			setViewingCollectionEvents,
			setViewingContext,
			setViewingContextDatasets,
			setViewingContextCollections,
			setViewMode,
			onEnsureInfoPanelVisible,
		],
	)

	const handleInspectCollection = useCallback(
		(collection: NDKGeoCollectionEvent, eventsInCollection: NDKGeoEvent[]) => {
			const referencedEvents =
				eventsInCollection.length > 0 ? eventsInCollection : resolveEventsForCollection(collection)
			setViewingCollection(collection)
			setViewingCollectionEvents(referencedEvents)
			setViewingDataset(null)
			setViewingContext(null)
			setViewingContextDatasets([])
			setViewingContextCollections([])
			setInfoMode('view')
			setViewMode('view')
			setSidebarMode('dataset')
			onEnsureInfoPanelVisible()

			// Update URL with naddr
			const naddr = encodeCollectionNaddr(collection)
			if (naddr) {
				onNavigateToFocus?.('collection', naddr, 'collections')
			}

			// Fly to the collection bounds
			onZoomToCollection?.(collection, referencedEvents)
		},
		[
			resolveEventsForCollection,
			setViewingCollection,
			setViewingCollectionEvents,
			setViewingDataset,
			setViewingContext,
			setViewingContextDatasets,
			setViewingContextCollections,
			setViewMode,
			onEnsureInfoPanelVisible,
			onNavigateToFocus,
			onZoomToCollection,
		],
	)

	const handleOpenDebug = useCallback(
		(event: NDKGeoEvent | NDKGeoCollectionEvent | NDKMapContextEvent) => {
			setDebugEvent(event)
			setDebugDialogOpen(true)
		},
		[],
	)

	return {
		// State
		infoMode,
		setInfoMode,
		sidebarMode,
		setSidebarMode,
		debugEvent,
		debugDialogOpen,
		setDebugDialogOpen,
		viewingDataset,
		viewingCollection,
		// Actions
		exitViewMode,
		handleInspectDataset,
		handleInspectDatasetWithoutFocus,
		handleInspectCollection,
		handleOpenDebug,
		resolveEventsForCollection,
	}
}

import { useCallback, useState } from 'react'
import type { NDKGeoCollectionEvent } from '../../../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../../../lib/ndk/NDKGeoEvent'
import { useEditorStore } from '../store'

interface UseViewModeOptions {
	geoEvents: NDKGeoEvent[]
	onEnsureInfoPanelVisible: () => void
}

export function useViewMode({ geoEvents, onEnsureInfoPanelVisible }: UseViewModeOptions) {
	const [infoMode, setInfoMode] = useState<'properties' | 'json' | 'edit' | 'view'>('properties')
	const [sidebarMode, setSidebarMode] = useState<
		'datasets' | 'info' | 'editor' | 'dataset' | 'inspector'
	>('datasets')
	const [debugEvent, setDebugEvent] = useState<NDKGeoEvent | NDKGeoCollectionEvent | null>(null)
	const [debugDialogOpen, setDebugDialogOpen] = useState(false)

	// Store state
	const viewingDataset = useEditorStore((state) => state.viewDataset)
	const viewingCollection = useEditorStore((state) => state.viewCollection)

	// Store actions
	const setViewingDataset = useEditorStore((state) => state.setViewDataset)
	const setViewingCollection = useEditorStore((state) => state.setViewCollection)
	const setViewingCollectionEvents = useEditorStore((state) => state.setViewCollectionEvents)
	const setViewMode = useEditorStore((state) => state.setViewMode)

	const resolveEventsForCollection = useCallback(
		(collection: NDKGeoCollectionEvent): NDKGeoEvent[] => {
			const references = new Set(collection.datasetReferences)
			if (references.size === 0) return []
			return geoEvents.filter((event) => {
				const datasetId = event.datasetId ?? event.dTag ?? event.id
				if (!datasetId) return false
				const coordinate = `${event.kind ?? 31991}:${event.pubkey}:${datasetId}`
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
		setSidebarMode('editor')
	}, [setViewingDataset, setViewingCollection, setViewingCollectionEvents, setViewMode])

	const handleInspectDataset = useCallback(
		(event: NDKGeoEvent) => {
			setViewingDataset(event)
			setViewingCollection(null)
			setViewingCollectionEvents([])
			setInfoMode('view')
			setViewMode('view')
			setSidebarMode('dataset')
			onEnsureInfoPanelVisible()
		},
		[
			setViewingDataset,
			setViewingCollection,
			setViewingCollectionEvents,
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
			setInfoMode('view')
			setViewMode('view')
			setSidebarMode('dataset')
			onEnsureInfoPanelVisible()
		},
		[
			resolveEventsForCollection,
			setViewingCollection,
			setViewingCollectionEvents,
			setViewingDataset,
			setViewMode,
			onEnsureInfoPanelVisible,
		],
	)

	const handleOpenDebug = useCallback((event: NDKGeoEvent | NDKGeoCollectionEvent) => {
		setDebugEvent(event)
		setDebugDialogOpen(true)
	}, [])

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
		handleInspectCollection,
		handleOpenDebug,
		resolveEventsForCollection,
	}
}

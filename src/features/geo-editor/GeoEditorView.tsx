import { useNDK, useNDKCurrentUser } from '@nostr-dev-kit/react'
import type { FeatureCollection } from 'geojson'
import { Edit3, Layers, Lock, LockOpen, Search, UploadCloud } from 'lucide-react'
import type maplibregl from 'maplibre-gl'
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
} from 'react'
import { AppSidebar } from '../../components/AppSidebar'
import { BlossomUploadDialog } from '../../components/BlossomUploadDialog'
import { DebugDialog } from '../../components/DebugDialog'
import { Button } from '../../components/ui/button'
import { SidebarInset, SidebarProvider } from '../../components/ui/sidebar'
import { earthlyGeoServer, type ReverseLookupOutput } from '../../ctxcn'
import { useAvailableGeoFeatures } from '../../lib/hooks/useAvailableGeoFeatures'
import { useIsMobile } from '../../lib/hooks/useIsMobile'
import { useGeoCollections, useMapContexts, useStations } from '../../lib/hooks/useStations'
import type { NDKGeoCollectionEvent } from '../../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../../lib/ndk/NDKGeoEvent'
import type { NDKMapContextEvent } from '../../lib/ndk/NDKMapContextEvent'
import { GEO_EVENT_KIND } from '../../lib/ndk/kinds'
import {
	defaultContextFilterMode,
	getContextCoordinate,
	isDatasetAllowedByContextFilter,
	validateDatasetForContext,
} from '../../lib/context/validation'
import { Editor } from './components/Editor'
import { ImportOsmDialog } from './components/ImportOsmDialog'
import { LocateButton } from './components/LocateButton'
import { FeaturePopup, type FeaturePopupData } from './components/FeaturePopup'
import { LocationInspectorPopup } from './components/LocationInspectorPopup'
import { Magnifier } from './components/Magnifier'
import { MobilePanel } from './components/MobilePanel'
import { UserLocationMarker } from './components/UserLocationMarker'
import { GeoEditorMap as MapComponent } from './components/Map'
import { OsmResultsPanel } from './components/OsmResultsPanel'
import { Toolbar } from './components/Toolbar'
import type { EditorFeature, EditorMode } from './core'
import {
	CLUSTER_CIRCLE_LAYER,
	REMOTE_ANNOTATION_ANCHOR_LAYER,
	REMOTE_ANNOTATION_LAYER,
	REMOTE_FILL_LAYER,
	REMOTE_LINE_LAYER,
	REMOTE_POINT_LAYER,
	UNCLUSTERED_POINT_LAYER,
	useDatasetManagement,
	useMapLayers,
	usePublishing,
	useRouting,
	useViewMode,
} from './hooks'
import { useEditorStore } from './store'
import type { GeoSearchResult } from './types'
import { isStyleProperty } from './types/styleProperties'
import { ensureFeatureCollection, extractCollectionMeta } from './utils'

const MAGNIFIER_SIZE = 140
const MAGNIFIER_OFFSET = { x: 80, y: -80 }
const POINTER_OFFSET = { x: 0, y: -48 }
const NON_CUSTOM_EDITOR_PROPERTY_KEYS = new Set([
	'meta',
	'active',
	'mode',
	'parent',
	'coord_path',
	'featureId',
	'customProperties',
	'name',
	'description',
	'featureType',
	'text',
	'textFontSize',
	'textColor',
	'textHaloColor',
	'textHaloWidth',
])

type ReverseLookupResult = ReverseLookupOutput['result']

function bboxFromGeometry(geometry: any): [number, number, number, number] | null {
	let west = Infinity
	let south = Infinity
	let east = -Infinity
	let north = -Infinity

	const add = (coord: any) => {
		if (!Array.isArray(coord) || coord.length < 2) return
		const lon = Number(coord[0])
		const lat = Number(coord[1])
		if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
		if (lon < west) west = lon
		if (lon > east) east = lon
		if (lat < south) south = lat
		if (lat > north) north = lat
	}

	const walk = (g: any) => {
		if (!g) return
		switch (g.type) {
			case 'Point':
				add(g.coordinates)
				break
			case 'MultiPoint':
			case 'LineString':
				for (const c of g.coordinates ?? []) add(c)
				break
			case 'MultiLineString':
			case 'Polygon':
				for (const ring of g.coordinates ?? []) {
					for (const c of ring ?? []) add(c)
				}
				break
			case 'MultiPolygon':
				for (const poly of g.coordinates ?? []) {
					for (const ring of poly ?? []) {
						for (const c of ring ?? []) add(c)
					}
				}
				break
			case 'GeometryCollection':
				for (const geom of g.geometries ?? []) walk(geom)
				break
		}
	}

	walk(geometry)
	if (
		!Number.isFinite(west) ||
		!Number.isFinite(south) ||
		!Number.isFinite(east) ||
		!Number.isFinite(north)
	) {
		return null
	}
	return [west, south, east, north]
}

function toImportedEditorFeature(feature: GeoJSON.Feature): EditorFeature {
	const stableId = feature.id?.toString() || crypto.randomUUID()
	const sourceProps =
		feature.properties && typeof feature.properties === 'object' ? feature.properties : {}
	const baseProperties = sourceProps as Record<string, unknown>
	const existingCustomProperties =
		baseProperties.customProperties &&
		typeof baseProperties.customProperties === 'object' &&
		!Array.isArray(baseProperties.customProperties)
			? (baseProperties.customProperties as Record<string, unknown>)
			: {}
	const mirroredCustomProperties: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(baseProperties)) {
		if (NON_CUSTOM_EDITOR_PROPERTY_KEYS.has(key) || isStyleProperty(key)) continue
		mirroredCustomProperties[key] = value
	}

	const mergedCustomProperties = {
		...existingCustomProperties,
		...mirroredCustomProperties,
	}

	return {
		...feature,
		id: stableId,
		properties: {
			...baseProperties,
			...(Object.keys(mergedCustomProperties).length > 0
				? { customProperties: mergedCustomProperties }
				: {}),
			meta: 'feature',
			featureId: stableId,
		},
	} as EditorFeature
}

export function GeoEditorView() {
	const map = useRef<maplibregl.Map | null>(null)
	const [mounted, setMounted] = useState(false)
	const [mapError, setMapError] = useState<string | null>(null)
	const [deletingKey, setDeletingKey] = useState<string | null>(null)
	const [resolvedCollectionsVersion, setResolvedCollectionsVersion] = useState(0)

	// Comment geometry layers - track which comment geometries are visible on map
	const commentGeometryLayers = useRef<Map<string, { sourceId: string; layerIds: string[] }>>(
		new Map(),
	)

	// Drawing mode state
	const [isDrawingMode, setIsDrawingMode] = useState(false)
	const [magnifierEnabled, setMagnifierEnabled] = useState(false)
	const [magnifierVisible, setMagnifierVisible] = useState(false)
	const [magnifierPosition, setMagnifierPosition] = useState({ x: 0, y: 0 })
	const [magnifierCenter, setMagnifierCenter] = useState<[number, number]>([0, 0])
	const [magnifierZoomOffset, setMagnifierZoomOffset] = useState(1)
	const [magnifierMenuOpen, setMagnifierMenuOpen] = useState(false)
	const [previousMode, setPreviousMode] = useState<string | null>(null)
	const [showToolbar, setShowToolbar] = useState(true)
	const magnifierLongPressTimerRef = useRef<number | null>(null)
	const magnifierLongPressTriggeredRef = useRef(false)
	const magnifierButtonRef = useRef<HTMLButtonElement>(null)
	const magnifierMenuRef = useRef<HTMLDivElement>(null)

	// Inspector state
	const [reverseLookupResult, setReverseLookupResult] = useState<ReverseLookupResult | null>(null)
	const [reverseLookupStatus, setReverseLookupStatus] = useState<'idle' | 'loading' | 'error'>(
		'idle',
	)
	const [reverseLookupError, setReverseLookupError] = useState<string | null>(null)
	const [inspectorClickPosition, setInspectorClickPosition] = useState<{
		x: number
		y: number
	} | null>(null)
	const mapContainerRef = useRef<HTMLDivElement>(null)

	// Feature popup state (shown when clicking a feature on the map in view mode)
	const [featurePopupData, setFeaturePopupData] = useState<FeaturePopupData | null>(null)

	// Collection visibility state (local to view)
	const [collectionVisibility, setCollectionVisibility] = useState<Record<string, boolean>>({})

	// Import OSM dialog state
	const [importOsmDialogOpen, setImportOsmDialogOpen] = useState(false)

	// User location tracking state
	const [userLocation, setUserLocation] = useState<{
		lat: number
		lon: number
		accuracy?: number
	} | null>(null)
	const isFirstLocationUpdate = useRef(true)

	// Store state
	const editor = useEditorStore((state) => state.editor)
	const features = useEditorStore((state) => state.features)
	const featuresRef = useRef<EditorFeature[]>([])
	const stats = useEditorStore((state) => state.stats)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const selectionCount = selectedFeatureIds.length
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const setFocusedMapGeometry = useEditorStore((state) => state.setFocusedMapGeometry)
	const setViewModeState = useEditorStore((state) => state.setViewMode)
	const setViewDatasetState = useEditorStore((state) => state.setViewDataset)
	const setViewCollectionState = useEditorStore((state) => state.setViewCollection)
	const setViewContext = useEditorStore((state) => state.setViewContext)
	const setViewContextDatasets = useEditorStore((state) => state.setViewContextDatasets)
	const setViewContextCollections = useEditorStore((state) => state.setViewContextCollections)
	const contextFilterMode = useEditorStore((state) => state.contextFilterMode)
	const setContextFilterMode = useEditorStore((state) => state.setContextFilterMode)
	const activeDataset = useEditorStore((state) => state.activeDataset)
	const datasetVisibility = useEditorStore((state) => state.datasetVisibility)
	const setDatasetVisibility = useEditorStore((state) => state.setDatasetVisibility)
	const setCollectionMeta = useEditorStore((state) => state.setCollectionMeta)
	const isPublishing = useEditorStore((state) => state.isPublishing)
	const showDatasetsPanel = useEditorStore((state) => state.showDatasetsPanel)
	const setShowDatasetsPanel = useEditorStore((state) => state.setShowDatasetsPanel)
	const showInfoPanel = useEditorStore((state) => state.showInfoPanel)
	const setShowInfoPanel = useEditorStore((state) => state.setShowInfoPanel)
	const setShowTips = useEditorStore((state) => state.setShowTips)
	// Unified mobile panel state
	const mobilePanelOpen = useEditorStore((state) => state.mobilePanelOpen)
	const mobilePanelSnap = useEditorStore((state) => state.mobilePanelSnap)
	const setMobilePanelOpen = useEditorStore((state) => state.setMobilePanelOpen)
	// Mobile toolbar state (for upper toolbar sections)
	const mobileToolsOpen = useEditorStore((state) => state.mobileToolsOpen)
	const setMobileToolsOpen = useEditorStore((state) => state.setMobileToolsOpen)
	const mobileSearchOpen = useEditorStore((state) => state.mobileSearchOpen)
	const setMobileSearchOpen = useEditorStore((state) => state.setMobileSearchOpen)
	const mobileActionsOpen = useEditorStore((state) => state.mobileActionsOpen)
	const setMobileActionsOpen = useEditorStore((state) => state.setMobileActionsOpen)
	const panLocked = useEditorStore((state) => state.panLocked)
	const setPanLocked = useEditorStore((state) => state.setPanLocked)
	const canFinishDrawing = useEditorStore((state) => state.canFinishDrawing)
	const currentMode = useEditorStore((state) => state.mode)
	const setCurrentMode = useEditorStore((state) => state.setMode)
	const mapSource = useEditorStore((state) => state.mapSource)
	const inspectorActive = useEditorStore((state) => state.inspectorActive)
	const setInspectorActive = useEditorStore((state) => state.setInspectorActive)
	const mapSourceKey = useMemo(() => {
		const file = mapSource.file
		return [
			mapSource.type,
			mapSource.location,
			mapSource.url ?? '',
			mapSource.blossomServer ?? '',
			file ? `${file.name}:${file.size}:${file.lastModified}` : '',
		].join('|')
	}, [mapSource.type, mapSource.location, mapSource.url, mapSource.blossomServer, mapSource.file])

	// Collection Editor state
	const [collectionEditorMode, setCollectionEditorMode] = useState<'none' | 'create' | 'edit'>(
		'none',
	)
	const [editingCollection, setEditingCollection] = useState<NDKGeoCollectionEvent | null>(null)
	const [contextEditorMode, setContextEditorMode] = useState<'none' | 'create' | 'edit'>('none')
	const [editingContext, setEditingContext] = useState<NDKMapContextEvent | null>(null)

	// External data
	const { events: geoEvents } = useStations([{ limit: 50 }])
	const { events: collectionEvents } = useGeoCollections([{ limit: 50 }])
	const { events: mapContextEvents } = useMapContexts([{ limit: 100 }])
	const { ndk } = useNDK()
	const currentUser = useNDKCurrentUser()
	const isMobile = useIsMobile()

	// Callback for ensuring info panel is visible
	const openMobilePanel = useEditorStore((state) => state.openMobilePanel)
	const ensureInfoPanelVisible = useCallback(() => {
		if (isMobile) {
			openMobilePanel('edit')
		} else {
			setShowInfoPanel(true)
		}
	}, [isMobile, openMobilePanel, setShowInfoPanel])

	// Custom hooks
	const {
		geoEventsRef,
		isMountedRef,
		getDatasetKey,
		getDatasetName,
		resolvedCollectionResolver,
		ensureResolvedFeatureCollection,
		zoomToDataset,
		zoomToCollection,
		toggleDatasetVisibility,
		toggleAllDatasetVisibility,
		loadDatasetForEditing,
		clearEditingSession,
		startNewDataset,
		cancelEditing,
	} = useDatasetManagement(map, geoEvents)

	// Store state for viewMode
	const viewMode = useEditorStore((state) => state.viewMode)

	// Blossom upload dialog state
	const blossomUploadDialogOpen = useEditorStore((state) => state.blossomUploadDialogOpen)
	const setBlossomUploadDialogOpen = useEditorStore((state) => state.setBlossomUploadDialogOpen)
	const pendingPublishCollection = useEditorStore((state) => state.pendingPublishCollection)

	const {
		handlePublishNew,
		handlePublishUpdate,
		handlePublishCopy,
		handleDeleteDataset,
		handlePublishWithBlossomUpload,
		buildCollectionFromEditor,
		canPublishNew,
		canPublishUpdate,
		canPublishCopy,
	} = usePublishing({
		ndk: ndk ?? undefined,
		currentUserPubkey: currentUser?.pubkey,
		getDatasetName,
		getDatasetKey,
		mapContexts: mapContextEvents,
		resolvedCollectionResolver,
	})

	/**
	 * Callback for when a Blossom upload completes.
	 * Adds the blob reference to the store WITHOUT publishing.
	 * User must click "Publish" separately to publish the dataset.
	 */
	const handleBlobUploadComplete = useCallback(
		(result: { sha256: string; url: string; size: number }) => {
			const newRef = {
				id: crypto.randomUUID(),
				scope: 'collection' as const,
				url: result.url,
				sha256: result.sha256,
				size: result.size,
				mimeType: 'application/geo+json',
				status: 'ready' as const,
			}
			useEditorStore
				.getState()
				.setBlobReferences([...useEditorStore.getState().blobReferences, newRef])
		},
		[],
	)

	// Memoize the collection to prevent expensive recalculation on every render
	// Only compute when in edit mode to avoid unnecessary work
	const memoizedFeatureCollection = useMemo(() => {
		// Only compute when viewMode is 'edit' - this is when DatasetSizeIndicator is shown
		if (viewMode !== 'edit') return null
		return buildCollectionFromEditor()
	}, [buildCollectionFromEditor, viewMode, features])

	const {
		infoMode,
		setInfoMode,
		debugEvent,
		debugDialogOpen,
		setDebugDialogOpen,
		viewingDataset,
		viewingCollection,
		exitViewMode,
		handleInspectDataset,
		handleInspectDatasetWithoutFocus,
		handleInspectCollection,
		handleOpenDebug,
	} = useViewMode({
		geoEvents,
		onEnsureInfoPanelVisible: ensureInfoPanelVisible,
		onZoomToDataset: zoomToDataset,
		onZoomToCollection: zoomToCollection,
	})

	// Routing hook for URL-based focus mode
	const {
		route,
		navigateTo,
		navigateToView,
		clearFocus,
		navigateHome,
		encodeGeoEventNaddr,
		encodeCollectionNaddr,
		encodeContextNaddr,
		isFocused,
		userPubkey,
	} = useRouting()

	// Store focus state
	const focusedNaddr = useEditorStore((state) => state.focusedNaddr)
	const focusedType = useEditorStore((state) => state.focusedType)

	// Track filtered dataset keys from sidebar filter (for map visibility sync)
	const [filteredDatasetKeys, setFilteredDatasetKeys] = useState<Set<string> | null>(null)
	const handleFilteredDatasetKeysChange = useCallback((keys: Set<string>) => {
		setFilteredDatasetKeys(new Set(keys))
	}, [])

	// Mobile does not always render the datasets panel immediately; avoid getting stuck with stale/empty
	// filter state from a previous desktop session.
	useEffect(() => {
		if (isMobile) {
			setFilteredDatasetKeys(null)
		}
	}, [isMobile])

	const focusedContext = useMemo(() => {
		if (focusedType !== 'mapcontext' || !focusedNaddr) return null
		return (
			mapContextEvents.find((context) => {
				const contextNaddr = encodeContextNaddr(context)
				return contextNaddr === focusedNaddr
			}) ?? null
		)
	}, [focusedType, focusedNaddr, mapContextEvents, encodeContextNaddr])

	const focusedContextCoordinate = useMemo(() => {
		if (!focusedContext) return null
		return getContextCoordinate(focusedContext)
	}, [focusedContext])

	const focusedContextAttachedDatasets = useMemo(() => {
		if (!focusedContextCoordinate) return []
		return geoEvents.filter((event) => event.contextReferences.includes(focusedContextCoordinate))
	}, [geoEvents, focusedContextCoordinate])

	const focusedContextReferenceCollections = useMemo(() => {
		if (!focusedContextCoordinate) return []
		return collectionEvents.filter((collection) =>
			collection.contextReferences.includes(focusedContextCoordinate),
		)
	}, [collectionEvents, focusedContextCoordinate])

	// Visible geo events based on visibility toggle, focus mode, AND filter state
	const visibleGeoEvents = useMemo(() => {
		// Helper: check if event passes visibility + filter criteria
		const isEventVisible = (event: NDKGeoEvent, includeSidebarFilter = true) => {
			const key = getDatasetKey(event)
			// Must be marked visible
			if (datasetVisibility[key] === false) return false
			// Must pass filter (if filter is active)
			if (includeSidebarFilter && filteredDatasetKeys !== null && !filteredDatasetKeys.has(key)) {
				return false
			}
			return true
		}

		// If in focused mode, filter to show only the focused item(s)
		if (focusedNaddr && focusedType) {
			if (focusedType === 'geoevent') {
				// Find the single dataset that matches the naddr
				const dataset = geoEvents.find((event) => {
					const eventNaddr = encodeGeoEventNaddr(event)
					return eventNaddr === focusedNaddr
				})
				return dataset ? [dataset] : []
			} else if (focusedType === 'collection') {
				// Find the collection and return its referenced datasets
				const collection = collectionEvents.find((col) => {
					const colNaddr = encodeCollectionNaddr(col)
					return colNaddr === focusedNaddr
				})
				if (!collection) return []
				const references = new Set(collection.datasetReferences)
				return geoEvents.filter((event) => {
					const datasetId = event.datasetId ?? event.dTag ?? event.id
					if (!datasetId) return false
					const coordinate = `${event.kind ?? GEO_EVENT_KIND}:${event.pubkey}:${datasetId}`
					const inCollection = references.has(coordinate)
					if (!inCollection) return false

					// Also respect visibility toggle
					return datasetVisibility[getDatasetKey(event)] !== false
				})
			} else if (focusedType === 'mapcontext' && focusedContext) {
				const attachedVisible = focusedContextAttachedDatasets.filter((event) =>
					isEventVisible(event, false),
				)
				if (focusedContext.context.contextUse === 'taxonomy') {
					return attachedVisible
				}

				return attachedVisible.filter((event) => {
					const collection = resolvedCollectionResolver(event) ?? event.featureCollection
					const validationResult = validateDatasetForContext(
						event,
						focusedContext,
						collection,
						contextFilterMode === 'off' ? 'warn' : contextFilterMode,
					)
					return isDatasetAllowedByContextFilter(validationResult, contextFilterMode)
				})
			}
		}
		// Default: filter by visibility toggles AND sidebar filter
		return geoEvents.filter((event) => isEventVisible(event, true))
	}, [
		geoEvents,
		collectionEvents,
		datasetVisibility,
		getDatasetKey,
		focusedNaddr,
		focusedType,
		encodeGeoEventNaddr,
		encodeCollectionNaddr,
		focusedContext,
		focusedContextAttachedDatasets,
		resolvedCollectionResolver,
		contextFilterMode,
		filteredDatasetKeys,
	])

	const lastContextCoordinateRef = useRef<string | null>(null)
	useEffect(() => {
		if (!focusedContext) {
			lastContextCoordinateRef.current = null
			setViewContext(null)
			setViewContextDatasets([])
			setViewContextCollections([])
			return
		}

		const coordinate = getContextCoordinate(focusedContext)
		setViewContext(focusedContext)
		setViewContextDatasets(focusedContextAttachedDatasets)
		setViewContextCollections(focusedContextReferenceCollections)

		if (coordinate && lastContextCoordinateRef.current !== coordinate) {
			lastContextCoordinateRef.current = coordinate
			setContextFilterMode(defaultContextFilterMode(focusedContext))
		}
	}, [
		focusedContext,
		focusedContextAttachedDatasets,
		focusedContextReferenceCollections,
		setViewContext,
		setViewContextDatasets,
		setViewContextCollections,
		setContextFilterMode,
	])

	// Effective visibility for sidebar - shows actual visibility state including focus mode
	const effectiveVisibility = useMemo(() => {
		// When focused, only focused items are visible
		if (focusedNaddr && focusedType) {
			const effectiveMap: Record<string, boolean> = {}
			const visibleKeys = new Set(visibleGeoEvents.map((e) => getDatasetKey(e)))
			geoEvents.forEach((event) => {
				const key = getDatasetKey(event)
				effectiveMap[key] = visibleKeys.has(key)
			})
			return effectiveMap
		}
		// Default: use actual visibility state
		return datasetVisibility
	}, [geoEvents, visibleGeoEvents, datasetVisibility, getDatasetKey, focusedNaddr, focusedType])

	useEffect(() => {
		featuresRef.current = features
	}, [features])

	// Available features for $ mentions in comments
	// We want to allow mentioning any loaded dataset, not just visible ones
	const geoEventsForMentions = useMemo(() => {
		if (!viewingDataset) return geoEvents
		if (geoEvents.some((ev) => ev.id === viewingDataset.id)) return geoEvents
		return [...geoEvents, viewingDataset]
	}, [geoEvents, viewingDataset])

	const availableFeatures = useAvailableGeoFeatures(
		geoEventsForMentions,
		resolvedCollectionResolver,
	)

	// Map layers hook
	const { remoteLayersReady, CLUSTERED_SOURCE_ID } = useMapLayers({
		mapRef: map,
		mounted,
		visibleGeoEvents,
		resolvedCollectionResolver,
		resolvedCollectionsVersion,
	})

	// Keep the viewport focused on the most recently loaded geometry after map source swaps.
	// We wait for the style to load because setStyle clears sources/layers and they are re-added on events.
	useEffect(() => {
		if (!map.current) return
		const mapInstance = map.current
		void mapSourceKey

		let cancelled = false

		const zoomToCurrentGeometry = async () => {
			if (cancelled) return
			const currentFeatures = (featuresRef.current ?? []).filter(
				(
					feature,
				): feature is EditorFeature & { geometry: NonNullable<EditorFeature['geometry']> } =>
					feature.geometry !== null,
			)
			if (currentFeatures.length === 0) {
				if (activeDataset) zoomToDataset(activeDataset)
				return
			}

			try {
				const turf = await import('@turf/turf')
				const bbox = turf.bbox({
					type: 'FeatureCollection',
					features: currentFeatures,
				})
				if (!Array.isArray(bbox) || bbox.length !== 4) return
				const [west, south, east, north] = bbox
				if (![west, south, east, north].every((v) => Number.isFinite(v))) return
				mapInstance.fitBounds(
					[
						[west, south],
						[east, north],
					],
					{ padding: 60, duration: 450 },
				)
			} catch {
				// If bbox calc fails, keep current camera.
			}
		}

		const handleStyleLoad = () => {
			zoomToCurrentGeometry().catch(() => undefined)
		}

		mapInstance.once('style.load', handleStyleLoad)
		// Fallback: if style.load doesn't fire for a given change, still attempt once.
		const timeoutId = window.setTimeout(() => {
			zoomToCurrentGeometry().catch(() => undefined)
		}, 0)

		return () => {
			cancelled = true
			window.clearTimeout(timeoutId)
			try {
				mapInstance.off('style.load', handleStyleLoad)
			} catch {
				// Map may have been removed
			}
		}
	}, [mapSourceKey, activeDataset])

	// Initial zoom to latest geometry on app load
	const initialZoomPerformed = useRef(false)
	useEffect(() => {
		if (initialZoomPerformed.current || !map.current || !mounted) return

		// Only perform initial zoom if we're on the home route (no focus)
		if (route.focusType !== 'none') return

		if (geoEvents.length === 0) return

		// Sort events by creation time (descending)
		const sortedEvents = [...geoEvents].sort((a, b) => {
			return (b.created_at || 0) - (a.created_at || 0)
		})

		const latestEvent = sortedEvents[0]
		if (!latestEvent) return

		const performZoom = async () => {
			try {
				// Get collection or feature collection
				const dataset = resolveNaddrToDataset(
					latestEvent.datasetId || latestEvent.dTag || latestEvent.id,
				)
				const col = dataset?.featureCollection || latestEvent.featureCollection

				if (!col) return

				const turf = await import('@turf/turf')
				const bbox = turf.bbox(col as any)

				if (Array.isArray(bbox) && bbox.length === 4 && bbox.every((n) => Number.isFinite(n))) {
					map.current?.fitBounds(
						[
							[bbox[0], bbox[1]],
							[bbox[2], bbox[3]],
						],
						{ padding: 100, duration: 1500, maxZoom: 16 },
					)
					initialZoomPerformed.current = true
				}
			} catch (err) {
				console.warn('Failed to auto-zoom to latest event:', err)
			}
		}

		performZoom()
	}, [geoEvents, mounted, route])

	// Pan lock sync with drawing mode
	useEffect(() => {
		const shouldLock = isDrawingMode
		setPanLocked(shouldLock)
		if (editor) {
			editor.setPanLocked(shouldLock)
		}
	}, [isDrawingMode, editor, setPanLocked])

	// Sync default dataset visibility
	useEffect(() => {
		setDatasetVisibility((prev) => {
			const next: Record<string, boolean> = {}
			let changed = false

			geoEvents.forEach((event) => {
				const key = getDatasetKey(event)
				const value = prev[key] === undefined ? true : prev[key]
				next[key] = value
				if (prev[key] !== value) changed = true
			})

			if (Object.keys(prev).length !== Object.keys(next).length) changed = true
			return changed ? next : prev
		})
	}, [geoEvents, getDatasetKey, setDatasetVisibility])

	// Initialize mobile/desktop UI
	const closeMobilePanel = useEditorStore((state) => state.closeMobilePanel)
	useEffect(() => {
		if (isMobile) {
			closeMobilePanel()
			setShowToolbar(false)
			setShowTips(false)
		} else {
			setShowDatasetsPanel(true)
			setShowInfoPanel(true)
			setShowToolbar(true)
			setShowTips(true)
		}
	}, [isMobile, closeMobilePanel, setShowTips, setShowDatasetsPanel, setShowInfoPanel])

	// Handle pmtiles URL param on app load
	const setMapSource = useEditorStore((state) => state.setMapSource)
	useEffect(() => {
		const url = new URL(window.location.href)
		const pmtilesUrl = url.searchParams.get('pmtiles')
		if (pmtilesUrl) {
			setMapSource({
				type: 'pmtiles',
				location: 'remote',
				url: pmtilesUrl,
			})
		}
	}, [setMapSource])

	// Handle initial route on page load (direct URL navigation)
	useEffect(() => {
		// Skip if no focus route (just sidebar view change)
		// If there's a specific focus route (e.g. /datasets/geoevent/...), handle zoom
		if (route.focusType === 'none' || !route.naddr) return
		// Wait for data to be available
		if (geoEvents.length === 0 && collectionEvents.length === 0 && mapContextEvents.length === 0)
			return

		if (route.focusType === 'geoevent') {
			// Find the dataset matching the naddr
			const dataset = geoEvents.find((event) => {
				const eventNaddr = encodeGeoEventNaddr(event)
				return eventNaddr === route.naddr
			})
			if (dataset) {
				handleInspectDataset(dataset)
			}
		} else if (route.focusType === 'collection') {
			// Find the collection matching the naddr
			const collection = collectionEvents.find((col) => {
				const colNaddr = encodeCollectionNaddr(col)
				return colNaddr === route.naddr
			})
			if (collection) {
				handleInspectCollection(collection, [])
			}
		} else if (route.focusType === 'mapcontext') {
			const context = mapContextEvents.find((ctx) => encodeContextNaddr(ctx) === route.naddr)
			if (context) {
				handleInspectContext(context)
			}
		}
		// Only run once when data becomes available
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		route.focusType,
		route.naddr,
		geoEvents.length,
		collectionEvents.length,
		mapContextEvents.length,
	])

	// Lock document scrolling on mobile to prevent address bar jitter during map gestures.
	useEffect(() => {
		if (!isMobile) return
		const root = document.documentElement
		const body = document.body
		const previous = {
			rootOverflow: root.style.overflow,
			rootOverscroll: root.style.overscrollBehavior,
			bodyOverflow: body.style.overflow,
			bodyOverscroll: body.style.overscrollBehavior,
		}

		root.style.overflow = 'hidden'
		root.style.overscrollBehavior = 'none'
		body.style.overflow = 'hidden'
		body.style.overscrollBehavior = 'none'

		return () => {
			root.style.overflow = previous.rootOverflow
			root.style.overscrollBehavior = previous.rootOverscroll
			body.style.overflow = previous.bodyOverflow
			body.style.overscrollBehavior = previous.bodyOverscroll
		}
	}, [isMobile])

	// Track which events have been processed for blob resolution to avoid re-processing
	const processedBlobEventsRef = useRef<Set<string>>(new Set())

	// Preload blob references for datasets - only process new events once
	useEffect(() => {
		let cancelled = false
		const eventsToProcess = geoEvents.filter(
			(event) =>
				event.blobReferences.length > 0 &&
				event.id &&
				!processedBlobEventsRef.current.has(event.id),
		)

		if (eventsToProcess.length === 0) return

		;(async () => {
			let resolvedAny = false
			for (const event of eventsToProcess) {
				if (cancelled) break
				try {
					await ensureResolvedFeatureCollection(event)
					if (event.id) {
						processedBlobEventsRef.current.add(event.id)
					}
					resolvedAny = true
				} catch (error) {
					console.warn('Failed to resolve external blob for dataset', event.id, error)
					// Mark as processed even on error to avoid retry loops
					if (event.id) {
						processedBlobEventsRef.current.add(event.id)
					}
				}
			}
			// Only update version once after all events are processed
			if (resolvedAny && isMountedRef.current && !cancelled) {
				setResolvedCollectionsVersion((v) => v + 1)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [geoEvents, ensureResolvedFeatureCollection, isMountedRef])

	// Handle paste GeoJSON
	const handlePaste = useCallback(
		async (e: ClipboardEvent) => {
			if (!editor) return
			const text = e.clipboardData?.getData('text/plain')
			if (!text) return

			try {
				const json = JSON.parse(text)
				const collection = ensureFeatureCollection(json)
				const newFeatures = collection.features.map((f: any) => {
					// Ensure ID is a string
					const featureId = f.id != null ? String(f.id) : crypto.randomUUID()

					// Extract known properties, rest go to customProperties
					const { name, description, meta, featureId: _, ...restProperties } = f.properties || {}

					return {
						...f,
						id: featureId,
						properties: {
							name: name ?? f.properties?.name,
							description: description ?? f.properties?.description,
							meta: 'feature',
							featureId,
							customProperties: Object.keys(restProperties).length > 0 ? restProperties : undefined,
						},
					}
				})
				newFeatures.forEach((f) => editor.addFeature(f as EditorFeature))
			} catch (error) {
				console.error('Failed to paste GeoJSON:', error)
			}
		},
		[editor],
	)

	useEffect(() => {
		document.addEventListener('paste', handlePaste)
		return () => {
			document.removeEventListener('paste', handlePaste)
		}
	}, [handlePaste])

	// Dataset actions
	const handleDatasetSelect = (event: NDKGeoEvent) => {
		handleLoadDatasetForEditing(event)
	}

	const handleClear = useCallback(() => {
		if (!editor) return
		const all = editor.getAllFeatures()
		editor.deleteFeatures(all.map((f) => f.id))
		setSelectedFeatureIds([])
	}, [editor, setSelectedFeatureIds])

	const onDeleteDataset = useCallback(
		async (event: NDKGeoEvent) => {
			const key = getDatasetKey(event)
			setDeletingKey(key)
			try {
				await handleDeleteDataset(event, clearEditingSession)
			} finally {
				setDeletingKey(null)
			}
		},
		[getDatasetKey, handleDeleteDataset, clearEditingSession],
	)

	// Export/Import
	const exportGeoJSON = useCallback(() => {
		if (!editor) return

		const geojson = {
			type: 'FeatureCollection',
			features: editor.getAllFeatures(),
		}

		const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = 'features.geojson'
		a.click()
		URL.revokeObjectURL(url)
	}, [editor])

	const handleImport = useCallback(
		async (file: File) => {
			if (!editor) return
			const text = await file.text()
			try {
				const json = JSON.parse(text)
				const collection = ensureFeatureCollection(json)
				const newFeatures = collection.features.map((f: any) => {
					// Ensure ID is a string
					const featureId = f.id != null ? String(f.id) : crypto.randomUUID()

					// Extract known properties, rest go to customProperties
					const { name, description, meta, featureId: _, ...restProperties } = f.properties || {}

					return {
						...f,
						id: featureId,
						properties: {
							name: name ?? f.properties?.name,
							description: description ?? f.properties?.description,
							meta: 'feature',
							featureId,
							customProperties: Object.keys(restProperties).length > 0 ? restProperties : undefined,
						},
					}
				})

				newFeatures.forEach((f) => editor.addFeature(f as EditorFeature))

				const meta = extractCollectionMeta(collection)
				if (meta) setCollectionMeta(meta)
			} catch (e) {
				console.error('Failed to import GeoJSON:', e)
				alert('Failed to import GeoJSON')
			}
		},
		[editor, setCollectionMeta],
	)

	// OSM Query state from store
	const osmQueryMode = useEditorStore((state) => state.osmQueryMode)
	const osmQueryFilter = useEditorStore((state) => state.osmQueryFilter)
	const setOsmQueryMode = useEditorStore((state) => state.setOsmQueryMode)
	const setOsmQueryPosition = useEditorStore((state) => state.setOsmQueryPosition)
	const setOsmQueryResults = useEditorStore((state) => state.setOsmQueryResults)
	const setOsmQueryError = useEditorStore((state) => state.setOsmQueryError)
	const clearOsmQuery = useEditorStore((state) => state.clearOsmQuery)

	// OSM Query handlers
	const handleOsmQueryClick = useCallback(() => {
		// Enter click mode - next map click will query OSM
		setOsmQueryMode('click')
	}, [setOsmQueryMode])

	const executeOsmQuery = useCallback(
		async (lat: number, lon: number, screenX: number, screenY: number) => {
			setOsmQueryMode('loading')
			setOsmQueryPosition({ x: screenX, y: screenY, lat, lon })
			setOsmQueryError(null)
			setOsmQueryResults([])

			try {
				const filters = osmQueryFilter === 'all' ? undefined : { [osmQueryFilter]: '*' }
				const response = await earthlyGeoServer.QueryOsmNearby(lat, lon, 200, filters, 30)

				if (!response?.result) {
					setOsmQueryError('Failed to query OSM - no response')
					setOsmQueryMode('idle')
					return
				}

				setOsmQueryResults((response.result.features ?? []) as GeoJSON.Feature[])
				setOsmQueryMode('idle')
			} catch (err: any) {
				setOsmQueryError(err.message || 'Failed to query OSM')
				setOsmQueryMode('idle')
			}
		},
		[osmQueryFilter, setOsmQueryMode, setOsmQueryPosition, setOsmQueryError, setOsmQueryResults],
	)

	const handleOsmQueryView = useCallback(async () => {
		if (!map.current) return
		const bounds = map.current.getBounds()
		const center = map.current.getCenter()
		const container = map.current.getContainer()

		setOsmQueryMode('loading')
		setOsmQueryPosition({
			x: container.clientWidth / 2,
			y: container.clientHeight / 2,
			lat: center.lat,
			lon: center.lng,
		})
		setOsmQueryError(null)
		setOsmQueryResults([])

		try {
			const filters = osmQueryFilter === 'all' ? undefined : { [osmQueryFilter]: '*' }
			const response = await earthlyGeoServer.QueryOsmBbox(
				bounds.getWest(),
				bounds.getSouth(),
				bounds.getEast(),
				bounds.getNorth(),
				filters,
				30,
			)

			if (!response?.result) {
				setOsmQueryError('Failed to query OSM - no response')
				setOsmQueryMode('idle')
				return
			}

			setOsmQueryResults((response.result.features ?? []) as GeoJSON.Feature[])
			setOsmQueryMode('idle')
		} catch (err: any) {
			setOsmQueryError(err.message || 'Failed to query OSM')
			setOsmQueryMode('idle')
		}
	}, [osmQueryFilter, setOsmQueryMode, setOsmQueryPosition, setOsmQueryError, setOsmQueryResults])

	const handleOsmImport = useCallback(
		(features: GeoJSON.Feature[]) => {
			if (!editor) return
			features.forEach((feature) => {
				editor.addFeature(toImportedEditorFeature(feature))
			})
		},
		[editor],
	)

	// Handle map click for OSM query
	useEffect(() => {
		if (!map.current || osmQueryMode !== 'click') return
		const mapInstance = map.current

		const handleMapClick = (e: maplibregl.MapMouseEvent) => {
			const { lng, lat } = e.lngLat
			executeOsmQuery(lat, lng, e.point.x, e.point.y)
		}

		// Change cursor to crosshair when in click mode
		mapInstance.getCanvas().style.cursor = 'crosshair'
		mapInstance.once('click', handleMapClick)

		return () => {
			mapInstance.getCanvas().style.cursor = ''
			mapInstance.off('click', handleMapClick)
		}
	}, [osmQueryMode, executeOsmQuery])

	// Pan lock and magnifier
	const togglePanLock = useCallback(() => {
		if (!editor) return
		if (isDrawingMode) return
		const next = !panLocked
		editor.setPanLocked(next)
		setPanLocked(next)
	}, [editor, isDrawingMode, panLocked, setPanLocked])

	const toggleMagnifier = useCallback(() => {
		const next = !magnifierEnabled
		setMagnifierEnabled(next)
		if (!next) setMagnifierVisible(false)
	}, [magnifierEnabled])

	const clearMagnifierLongPress = useCallback(() => {
		if (magnifierLongPressTimerRef.current) {
			window.clearTimeout(magnifierLongPressTimerRef.current)
			magnifierLongPressTimerRef.current = null
		}
	}, [])

	const handleMagnifierPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			if (event.pointerType === 'mouse' && event.button !== 0) return
			event.preventDefault()
			magnifierLongPressTriggeredRef.current = false
			clearMagnifierLongPress()
			magnifierLongPressTimerRef.current = window.setTimeout(() => {
				magnifierLongPressTriggeredRef.current = true
				setMagnifierMenuOpen(true)
			}, 550)
		},
		[clearMagnifierLongPress],
	)

	const handleMagnifierPointerUp = useCallback(() => {
		const didLongPress = magnifierLongPressTriggeredRef.current
		clearMagnifierLongPress()
		if (!didLongPress) {
			toggleMagnifier()
		}
	}, [clearMagnifierLongPress, toggleMagnifier])

	useEffect(() => {
		if (!magnifierMenuOpen) return
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as Node
			if (magnifierMenuRef.current?.contains(target)) return
			if (magnifierButtonRef.current?.contains(target)) return
			setMagnifierMenuOpen(false)
		}
		document.addEventListener('pointerdown', handlePointerDown)
		return () => document.removeEventListener('pointerdown', handlePointerDown)
	}, [magnifierMenuOpen])

	// Magnifier update on touch
	useEffect(() => {
		if (!map.current) return
		const mapInstance = map.current

		const updateMagnifier = (event: maplibregl.MapTouchEvent) => {
			if (!magnifierEnabled) return
			const point = event.point
			const container = mapInstance.getContainer()
			const width = container.clientWidth
			const height = container.clientHeight
			const posX = Math.min(
				Math.max(point.x + MAGNIFIER_OFFSET.x, MAGNIFIER_SIZE / 2),
				width - MAGNIFIER_SIZE / 2,
			)
			const posY = Math.min(
				Math.max(point.y + MAGNIFIER_OFFSET.y, MAGNIFIER_SIZE / 2),
				height - MAGNIFIER_SIZE / 2,
			)
			const targetX = Math.min(Math.max(point.x + POINTER_OFFSET.x, 0), width)
			const targetY = Math.min(Math.max(point.y + POINTER_OFFSET.y, 0), height)
			const lngLat = mapInstance.unproject([targetX, targetY])

			setMagnifierPosition({ x: posX, y: posY })
			setMagnifierCenter([lngLat.lng, lngLat.lat])
			setMagnifierVisible(true)
		}

		const handleTouchStart = (e: maplibregl.MapTouchEvent) => updateMagnifier(e)
		const handleTouchMove = (e: maplibregl.MapTouchEvent) => updateMagnifier(e)
		const handleTouchEnd = () => setMagnifierVisible(false)

		mapInstance.on('touchstart', handleTouchStart)
		mapInstance.on('touchmove', handleTouchMove)
		mapInstance.on('touchend', handleTouchEnd)

		return () => {
			mapInstance.off('touchstart', handleTouchStart)
			mapInstance.off('touchmove', handleTouchMove)
			mapInstance.off('touchend', handleTouchEnd)
		}
	}, [magnifierEnabled])

	// Remote dataset click and hover handling
	useEffect(() => {
		if (!map.current || !remoteLayersReady) return
		const mapInstance = map.current

		// Check if we are in a drawing mode
		const isInDrawingMode = currentMode.startsWith('draw_')

		const remoteLayers = [
			REMOTE_FILL_LAYER,
			REMOTE_LINE_LAYER,
			REMOTE_POINT_LAYER,
			REMOTE_ANNOTATION_ANCHOR_LAYER,
			REMOTE_ANNOTATION_LAYER,
			UNCLUSTERED_POINT_LAYER,
		]

		// Cluster click handler - zoom to expand cluster
		const handleClusterClick = async (event: maplibregl.MapLayerMouseEvent) => {
			const features = mapInstance.queryRenderedFeatures(event.point, {
				layers: [CLUSTER_CIRCLE_LAYER],
			})
			if (!features.length) return

			const feature = features[0]
			if (!feature) return

			const clusterId = feature.properties?.cluster_id as number | undefined
			if (clusterId === undefined) return

			const source = mapInstance.getSource(CLUSTERED_SOURCE_ID) as maplibregl.GeoJSONSource
			if (!source) return

			try {
				const zoom = await source.getClusterExpansionZoom(clusterId)
				const geometry = feature.geometry
				if (geometry.type !== 'Point') return

				mapInstance.easeTo({
					center: geometry.coordinates as [number, number],
					zoom: zoom ?? mapInstance.getZoom() + 2,
					duration: 500,
				})
			} catch {
				// Cluster may have been removed
			}
		}

		const handleMapDatasetClick = (event: maplibregl.MapLayerMouseEvent & any) => {
			const feature = event.features?.[0]
			if (!feature) return

			const bbox = bboxFromGeometry(feature.geometry)
			if (bbox) {
				const props = (feature.properties ?? {}) as Record<string, unknown>
				const featureId = props.featureId ?? props.id ?? feature.id
				setFocusedMapGeometry({
					bbox,
					datasetId: props.datasetId != null ? String(props.datasetId) : undefined,
					sourceEventId: props.sourceEventId != null ? String(props.sourceEventId) : undefined,
					featureId: featureId != null ? String(featureId) : undefined,
				})
			}

			// Do not inspect other datasets while in edit mode
			if (viewMode === 'edit') {
				setFeaturePopupData(null)
				return
			}

			if (!feature?.properties) return
			const sourceEventId = feature.properties.sourceEventId as string | undefined
			const datasetId = feature.properties.datasetId as string | undefined

			const dataset =
				geoEventsRef.current.find((ev) => ev.id === sourceEventId) ??
				geoEventsRef.current.find((ev) => (ev.datasetId ?? ev.id) === datasetId)

			if (!dataset) return

			// Show feature popup with click position
			const isOwner = currentUser?.pubkey === dataset.pubkey
			const datasetName = getDatasetName(dataset)
			setFeaturePopupData({
				dataset,
				feature: feature as any,
				clickPosition: { x: event.point.x, y: event.point.y },
				isOwner,
				datasetName,
			})

			ensureResolvedFeatureCollection(dataset).catch(() => undefined)
			// Just inspect the dataset without triggering focus mode (no URL change)
			handleInspectDatasetWithoutFocus(dataset)
		}

		const handleMouseEnter = () => {
			// Keep default cursor in drawing mode
			if (isInDrawingMode) return
			mapInstance.getCanvas().style.cursor = 'pointer'
		}

		const handleMouseLeave = () => {
			if (isInDrawingMode) return
			mapInstance.getCanvas().style.cursor = ''
		}

		for (const layer of remoteLayers) {
			if (mapInstance.getLayer(layer)) {
				mapInstance.on('click', layer, handleMapDatasetClick)
				mapInstance.on('mouseenter', layer, handleMouseEnter)
				mapInstance.on('mouseleave', layer, handleMouseLeave)
			}
		}

		// Add cluster layer handlers
		if (mapInstance.getLayer(CLUSTER_CIRCLE_LAYER)) {
			mapInstance.on('click', CLUSTER_CIRCLE_LAYER, handleClusterClick)
			mapInstance.on('mouseenter', CLUSTER_CIRCLE_LAYER, handleMouseEnter)
			mapInstance.on('mouseleave', CLUSTER_CIRCLE_LAYER, handleMouseLeave)
		}

		return () => {
			for (const layer of remoteLayers) {
				try {
					mapInstance.off('click', layer, handleMapDatasetClick)
					mapInstance.off('mouseenter', layer, handleMouseEnter)
					mapInstance.off('mouseleave', layer, handleMouseLeave)
				} catch {
					// Layer may have been removed
				}
			}
			// Remove cluster layer handlers
			try {
				mapInstance.off('click', CLUSTER_CIRCLE_LAYER, handleClusterClick)
				mapInstance.off('mouseenter', CLUSTER_CIRCLE_LAYER, handleMouseEnter)
				mapInstance.off('mouseleave', CLUSTER_CIRCLE_LAYER, handleMouseLeave)
			} catch {
				// Layer may have been removed
			}
		}
	}, [
		handleInspectDatasetWithoutFocus,
		ensureResolvedFeatureCollection,
		geoEventsRef,
		remoteLayersReady,
		setFocusedMapGeometry,
		CLUSTERED_SOURCE_ID,
		viewMode,
		currentUser?.pubkey,
		getDatasetName,
	])

	// Inspector click handling
	useEffect(() => {
		if (!map.current) return
		const mapInstance = map.current

		const handleInspectorClick = async (event: maplibregl.MapMouseEvent & any) => {
			const { lng, lat } = event.lngLat
			// Capture click position for popup positioning
			setInspectorClickPosition({ x: event.point.x, y: event.point.y })
			setReverseLookupStatus('loading')
			setReverseLookupError(null)
			setReverseLookupResult(null)

			try {
				await new Promise((resolve) => setTimeout(resolve, 100))
				const response = await earthlyGeoServer.ReverseLookup(lat, lng)
				setReverseLookupResult(response.result)
			} catch (error) {
				const errorMessage =
					error instanceof Error && error.message === 'Not connected'
						? 'Cannot connect to geo server. Make sure the relay is running (bun relay).'
						: error instanceof Error
							? error.message
							: 'Reverse lookup failed'
				setReverseLookupError(errorMessage)
				setReverseLookupResult(null)
			} finally {
				setReverseLookupStatus('idle')
			}
		}

		if (inspectorActive) {
			mapInstance.getCanvas().style.cursor = 'crosshair'
			mapInstance.on('click', handleInspectorClick)
		}

		return () => {
			mapInstance.getCanvas().style.cursor = ''
			mapInstance.off('click', handleInspectorClick)
		}
	}, [inspectorActive])

	// Search result handling
	const zoomToSearchResult = useCallback((result: GeoSearchResult) => {
		if (!map.current) return
		if (result.boundingbox) {
			const [west, south, east, north] = result.boundingbox
			map.current.fitBounds(
				[
					[west, south],
					[east, north],
				],
				{ padding: 40, duration: 500 },
			)
			return
		}
		map.current.flyTo({
			center: [result.coordinates.lon, result.coordinates.lat],
			zoom: 14,
			duration: 500,
		})
	}, [])

	// Handle locate button - zoom to user's current location and show marker
	const handleLocate = useCallback(
		(coords: { lat: number; lon: number; accuracy?: number } | null) => {
			setUserLocation(coords)

			// Only fly to location on first update (when tracking starts)
			if (coords && isFirstLocationUpdate.current && map.current) {
				map.current.flyTo({
					center: [coords.lon, coords.lat],
					zoom: 15,
					duration: 1000,
				})
				isFirstLocationUpdate.current = false
			}

			// Reset flag when tracking stops
			if (!coords) {
				isFirstLocationUpdate.current = true
			}
		},
		[],
	)

	const handleSearchResultSelect = useCallback(
		(result: GeoSearchResult) => {
			zoomToSearchResult(result)
		},
		[zoomToSearchResult],
	)

	const disableInspector = useCallback(() => {
		setInspectorActive(false)
		if (editor) {
			editor.setMode((previousMode as EditorMode) || 'select')
			setCurrentMode((previousMode as EditorMode) || 'select')
		}
	}, [previousMode, editor, setCurrentMode, setInspectorActive])

	// Comment geometry visibility handler - adds/removes GeoJSON layers on map
	const handleCommentGeometryVisibility = useCallback(
		(commentId: string, geojson: FeatureCollection | null) => {
			if (!map.current) return

			const mapInstance = map.current
			const existing = commentGeometryLayers.current.get(commentId)

			// Remove existing layers for this comment
			if (existing) {
				for (const layerId of existing.layerIds) {
					if (mapInstance.getLayer(layerId)) {
						mapInstance.removeLayer(layerId)
					}
				}
				if (mapInstance.getSource(existing.sourceId)) {
					mapInstance.removeSource(existing.sourceId)
				}
				commentGeometryLayers.current.delete(commentId)
			}

			// If hiding, we're done
			if (!geojson) return

			// Add new layers
			const sourceId = `comment-geo-${commentId}`
			const fillLayerId = `comment-fill-${commentId}`
			const lineLayerId = `comment-line-${commentId}`
			const pointLayerId = `comment-point-${commentId}`

			mapInstance.addSource(sourceId, {
				type: 'geojson',
				data: geojson,
			})

			// Add fill layer for polygons
			mapInstance.addLayer({
				id: fillLayerId,
				type: 'fill',
				source: sourceId,
				filter: ['==', ['geometry-type'], 'Polygon'],
				paint: {
					'fill-color': '#f97316', // Orange for comments
					'fill-opacity': 0.3,
				},
			})

			// Add line layer
			mapInstance.addLayer({
				id: lineLayerId,
				type: 'line',
				source: sourceId,
				filter: [
					'any',
					['==', ['geometry-type'], 'LineString'],
					['==', ['geometry-type'], 'Polygon'],
				],
				paint: {
					'line-color': '#f97316',
					'line-width': 2,
					'line-dasharray': [2, 2], // Dashed line for comments
				},
			})

			// Add point layer
			mapInstance.addLayer({
				id: pointLayerId,
				type: 'circle',
				source: sourceId,
				filter: ['==', ['geometry-type'], 'Point'],
				paint: {
					'circle-color': '#f97316',
					'circle-radius': 6,
					'circle-stroke-color': '#fff',
					'circle-stroke-width': 2,
				},
			})

			commentGeometryLayers.current.set(commentId, {
				sourceId,
				layerIds: [fillLayerId, lineLayerId, pointLayerId],
			})
		},
		[],
	)

	// Zoom to bounds handler
	const handleZoomToBounds = useCallback((bounds: [number, number, number, number]) => {
		if (!map.current) return
		const [west, south, east, north] = bounds
		map.current.fitBounds(
			[
				[west, south],
				[east, north],
			],
			{ padding: 50, duration: 500 },
		)
	}, [])

	// Zoom to a single editor feature
	const handleZoomToFeature = useCallback(
		(feature: EditorFeature) => {
			if (!map.current || !feature.geometry) return
			import('@turf/turf')
				.then((turf) => {
					const bbox = turf.bbox(feature as GeoJSON.Feature) as [number, number, number, number]
					if (bbox.every((v) => Number.isFinite(v))) {
						handleZoomToBounds(bbox)
					}
				})
				.catch((err) => {
					console.warn('Failed to zoom to feature:', err)
				})
		},
		[handleZoomToBounds],
	)

	// Resolve naddr to dataset
	const resolveNaddrToDataset = useCallback(
		(address: string): NDKGeoEvent | null => {
			// Skip non-naddr addresses (e.g., legacy UUIDs or malformed data)
			if (!address || !address.startsWith('naddr1')) {
				return null
			}
			try {
				// Decode naddr to get kind, pubkey, identifier
				const { nip19 } = require('nostr-tools')
				const decoded = nip19.decode(address)
				if (decoded.type !== 'naddr') return null

				const { kind, pubkey, identifier } = decoded.data

				// Find matching dataset
				return (
					geoEvents.find(
						(ev) =>
							ev.kind === kind &&
							ev.pubkey === pubkey &&
							(ev.datasetId === identifier || ev.dTag === identifier || ev.id === identifier),
					) ?? null
				)
			} catch {
				console.warn('Failed to decode naddr:', address)
				return null
			}
		},
		[geoEvents],
	)

	// Handle mention zoom
	const handleMentionZoomTo = useCallback(
		(address: string, featureId: string | undefined) => {
			const dataset = resolveNaddrToDataset(address)
			if (!dataset) {
				console.warn('Could not find dataset for address:', address)
				return
			}

			// Get the feature collection
			const collection = resolvedCollectionResolver?.(dataset) ?? dataset.featureCollection

			if (featureId) {
				// Find specific feature and zoom to it
				const feature = collection?.features.find(
					(f) => f.id === featureId || String(f.id) === featureId || f.properties?.id === featureId,
				)
				if (feature?.geometry) {
					import('@turf/turf')
						.then((turf) => {
							const bbox = turf.bbox(feature) as [number, number, number, number]
							if (bbox.every((v) => Number.isFinite(v))) {
								handleZoomToBounds(bbox)
							}
						})
						.catch(() => {
							// Fallback to dataset zoom
							zoomToDataset(dataset)
						})
				} else {
					// Feature not found, zoom to whole dataset
					zoomToDataset(dataset)
				}
			} else {
				// Zoom to whole dataset
				zoomToDataset(dataset)
			}
		},
		[resolveNaddrToDataset, resolvedCollectionResolver, handleZoomToBounds, zoomToDataset],
	)

	// Handle mention visibility toggle
	const handleMentionVisibilityToggle = useCallback(
		(address: string, _featureId: string | undefined, visible: boolean) => {
			const dataset = resolveNaddrToDataset(address)
			if (!dataset) {
				console.warn('Could not find dataset for address:', address)
				return
			}
			// Set the dataset visibility explicitly based on the visible parameter
			// datasetVisibility semantics: false = hidden, true/undefined = visible
			const key = getDatasetKey(dataset)
			setDatasetVisibility((prev) => ({
				...prev,
				[key]: visible,
			}))
		},
		[resolveNaddrToDataset, getDatasetKey, setDatasetVisibility],
	)

	// Wrapped visibility toggle that exits focus mode
	const handleToggleVisibilityWithExitFocus = useCallback(
		(event: NDKGeoEvent) => {
			// Exit focus mode when manually toggling visibility
			if (isFocused) {
				navigateHome()
			}
			toggleDatasetVisibility(event)
		},
		[isFocused, navigateHome, toggleDatasetVisibility],
	)

	// Wrapped toggle all visibility that exits focus mode
	const handleToggleAllVisibilityWithExitFocus = useCallback(
		(visible: boolean) => {
			// Exit focus mode when toggling all visibility
			if (isFocused) {
				navigateHome()
			}
			toggleAllDatasetVisibility(visible)
		},
		[isFocused, navigateHome, toggleAllDatasetVisibility],
	)

	// Collection Editor Handlers
	const handleCreateCollection = useCallback(() => {
		setCollectionEditorMode('create')
		setEditingCollection(null)
		setContextEditorMode('none')
		setEditingContext(null)
		// Exit view mode if active
		exitViewMode()
		if (!isMobile) setShowInfoPanel(true)
	}, [isMobile, setShowInfoPanel, exitViewMode])

	const handleEditCollection = useCallback(
		(collection: NDKGeoCollectionEvent) => {
			setCollectionEditorMode('edit')
			setEditingCollection(collection)
			setContextEditorMode('none')
			setEditingContext(null)
			// Exit view mode if active
			exitViewMode()
			if (!isMobile) setShowInfoPanel(true)
		},
		[isMobile, setShowInfoPanel, exitViewMode],
	)

	const handleSaveCollection = useCallback((collection: NDKGeoCollectionEvent) => {
		setCollectionEditorMode('none')
		setEditingCollection(null)
	}, [])

	const handleCloseCollectionEditor = useCallback(() => {
		setCollectionEditorMode('none')
		setEditingCollection(null)
	}, [])

	// Wrapper that clears collection editor mode when loading a dataset for editing
	const handleLoadDatasetForEditing = useCallback(
		(event: NDKGeoEvent) => {
			setCollectionEditorMode('none')
			setEditingCollection(null)
			setContextEditorMode('none')
			setEditingContext(null)
			loadDatasetForEditing(event)
		},
		[loadDatasetForEditing],
	)

	// Feature popup handlers
	const handleFeaturePopupClose = useCallback(() => {
		setFeaturePopupData(null)
	}, [])

	const handleFeaturePopupZoom = useCallback(
		(feature: GeoJSON.Feature) => {
			if (!feature?.geometry || !map.current) return
			import('@turf/turf')
				.then((turf) => {
					const bbox = turf.bbox(feature) as [number, number, number, number]
					if (bbox.every((v) => Number.isFinite(v))) {
						handleZoomToBounds(bbox)
					}
				})
				.catch((err) => {
					console.warn('Failed to zoom to feature:', err)
				})
		},
		[handleZoomToBounds],
	)

	const handleFeaturePopupEdit = useCallback(
		(dataset: NDKGeoEvent) => {
			handleLoadDatasetForEditing(dataset)
			setFeaturePopupData(null)
		},
		[handleLoadDatasetForEditing],
	)

	const handleFeaturePopupInspect = useCallback(
		(dataset: NDKGeoEvent) => {
			setCollectionEditorMode('none')
			setEditingCollection(null)
			setContextEditorMode('none')
			setEditingContext(null)
			handleInspectDataset(dataset)
			setFeaturePopupData(null)
		},
		[handleInspectDataset],
	)

	// Wrapper that clears collection editor mode when inspecting a dataset
	const handleInspectDatasetWithModeSwitch = useCallback(
		(event: NDKGeoEvent) => {
			setCollectionEditorMode('none')
			setEditingCollection(null)
			setContextEditorMode('none')
			setEditingContext(null)
			handleInspectDataset(event)
		},
		[handleInspectDataset],
	)

	// Wrapper that clears collection editor mode when inspecting a collection
	const handleInspectCollectionWithModeSwitch = useCallback(
		(collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => {
			setCollectionEditorMode('none')
			setEditingCollection(null)
			setContextEditorMode('none')
			setEditingContext(null)
			handleInspectCollection(collection, events)
		},
		[handleInspectCollection],
	)

	const handleInspectContext = useCallback(
		(context: NDKMapContextEvent) => {
			setCollectionEditorMode('none')
			setEditingCollection(null)
			setContextEditorMode('none')
			setEditingContext(null)
			setViewModeState('view')
			setViewDatasetState(null)
			setViewCollectionState(null)
			setViewContext(context)
			ensureInfoPanelVisible()

			const naddr = encodeContextNaddr(context)
			if (naddr) {
				window.location.hash = `/context/${naddr}`
			}
		},
		[
			setViewModeState,
			setViewDatasetState,
			setViewCollectionState,
			setViewContext,
			ensureInfoPanelVisible,
			encodeContextNaddr,
		],
	)

	const handleCreateContext = useCallback(() => {
		setCollectionEditorMode('none')
		setEditingCollection(null)
		setContextEditorMode('create')
		setEditingContext(null)
		setViewModeState('edit')
		setViewDatasetState(null)
		setViewCollectionState(null)
		setViewContext(null)
		setViewContextDatasets([])
		setViewContextCollections([])
		clearFocus()
		navigateToView('context-editor')
		if (!isMobile) setShowInfoPanel(true)
	}, [
		isMobile,
		setShowInfoPanel,
		setViewModeState,
		setViewDatasetState,
		setViewCollectionState,
		setViewContext,
		setViewContextDatasets,
		setViewContextCollections,
		clearFocus,
		navigateToView,
	])

	const handleEditContext = useCallback(
		(context: NDKMapContextEvent) => {
			setCollectionEditorMode('none')
			setEditingCollection(null)
			setContextEditorMode('edit')
			setEditingContext(context)
			setViewModeState('edit')
			setViewDatasetState(null)
			setViewCollectionState(null)
			setViewContext(null)
			setViewContextDatasets([])
			setViewContextCollections([])
			clearFocus()
			navigateToView('context-editor')
			if (!isMobile) setShowInfoPanel(true)
		},
		[
			isMobile,
			setShowInfoPanel,
			setViewModeState,
			setViewDatasetState,
			setViewCollectionState,
			setViewContext,
			setViewContextDatasets,
			setViewContextCollections,
			clearFocus,
			navigateToView,
		],
	)

	const handleSaveContext = useCallback(
		(_context: NDKMapContextEvent) => {
			setContextEditorMode('none')
			setEditingContext(null)
			navigateToView('contexts')
		},
		[navigateToView],
	)

	const handleCloseContextEditor = useCallback(() => {
		setContextEditorMode('none')
		setEditingContext(null)
		navigateToView('contexts')
	}, [navigateToView])

	// Get collection key for visibility tracking
	const getCollectionKey = useCallback((collection: NDKGeoCollectionEvent): string => {
		return collection.dTag ?? collection.id ?? collection.collectionId ?? ''
	}, [])

	// Toggle collection visibility
	const handleToggleCollectionVisibility = useCallback(
		(collection: NDKGeoCollectionEvent) => {
			const key = getCollectionKey(collection)
			setCollectionVisibility((prev) => ({
				...prev,
				[key]: prev[key] === false ? true : false,
			}))
		},
		[getCollectionKey],
	)

	// Toggle all collection visibility
	const handleToggleAllCollectionVisibility = useCallback(
		(visible: boolean) => {
			setCollectionVisibility((prev) => {
				const next: Record<string, boolean> = {}
				collectionEvents.forEach((collection) => {
					const key = getCollectionKey(collection)
					next[key] = visible
				})
				return next
			})
		},
		[collectionEvents, getCollectionKey],
	)

	const multiSelectModifierLabel = editor?.getMultiSelectModifierLabel() ?? 'Shift'

	return (
		<SidebarProvider>
			{/* Sidebar - desktop only */}
			{!isMobile && (
				<AppSidebar
					geoEvents={geoEvents}
					collectionEvents={collectionEvents}
					mapContextEvents={mapContextEvents}
					activeDataset={activeDataset}
					currentUserPubkey={currentUser?.pubkey}
					datasetVisibility={effectiveVisibility}
					collectionVisibility={collectionVisibility}
					isPublishing={isPublishing}
					deletingKey={deletingKey}
					onClearEditing={clearEditingSession}
					onLoadDataset={handleDatasetSelect}
					onToggleVisibility={handleToggleVisibilityWithExitFocus}
					onToggleAllVisibility={handleToggleAllVisibilityWithExitFocus}
					onToggleCollectionVisibility={handleToggleCollectionVisibility}
					onToggleAllCollectionVisibility={handleToggleAllCollectionVisibility}
					onZoomToDataset={zoomToDataset}
					onDeleteDataset={onDeleteDataset}
					getDatasetKey={getDatasetKey}
					getDatasetName={getDatasetName}
					onZoomToCollection={zoomToCollection}
					onInspectDataset={handleInspectDatasetWithModeSwitch}
					onInspectCollection={handleInspectCollectionWithModeSwitch}
					onInspectContext={handleInspectContext}
					onOpenDebug={handleOpenDebug}
					onCreateCollection={handleCreateCollection}
					onCreateContext={handleCreateContext}
					onEditCollection={handleEditCollection}
					onEditContext={handleEditContext}
					isFocused={isFocused}
					onExitFocus={navigateHome}
					multiSelectModifier={multiSelectModifierLabel}
					// Editor panel props
					onCommentGeometryVisibility={handleCommentGeometryVisibility}
					onZoomToBounds={handleZoomToBounds}
					availableFeatures={availableFeatures}
					onMentionVisibilityToggle={handleMentionVisibilityToggle}
					onMentionZoomTo={handleMentionZoomTo}
					collectionEditorMode={collectionEditorMode}
					editingCollection={editingCollection}
					onSaveCollection={handleSaveCollection}
					onCloseCollectionEditor={handleCloseCollectionEditor}
					contextEditorMode={contextEditorMode}
					editingContext={editingContext}
					onSaveContext={handleSaveContext}
					onCloseContextEditor={handleCloseContextEditor}
					onZoomToFeature={handleZoomToFeature}
					onExitViewMode={exitViewMode}
					// Blossom upload props - callback adds blob ref to store, does NOT publish
					featureCollectionForUpload={memoizedFeatureCollection}
					onBlossomUploadComplete={handleBlobUploadComplete}
					ndk={ndk}
					// User profile props
					userPubkey={userPubkey}
					// Filter visibility sync
					onFilteredDatasetKeysChange={handleFilteredDatasetKeysChange}
				/>
			)}

			<SidebarInset>
				<div
					ref={mapContainerRef}
					className="relative h-screen w-full"
					style={{ height: '100dvh', minHeight: '100svh' }}
				>
					<MapComponent
						className="w-full h-full touch-none"
						onLoad={(m) => {
							map.current = m
							setMounted(true)
						}}
						mapSource={mapSource}
					>
						<Editor />
					</MapComponent>

					{/* User location marker - pulsating blue dot */}
					<UserLocationMarker
						map={map.current}
						coordinates={userLocation}
						accuracy={userLocation?.accuracy}
					/>

					<Magnifier
						enabled={magnifierEnabled}
						visible={magnifierVisible}
						position={magnifierPosition}
						center={magnifierCenter}
						mainMap={map.current}
						size={MAGNIFIER_SIZE}
						zoomOffset={magnifierZoomOffset}
					/>

					{/* Inspector Popup - appears near cursor when inspector is active */}
					<LocationInspectorPopup
						isOpen={inspectorActive && inspectorClickPosition !== null}
						loading={reverseLookupStatus === 'loading'}
						error={reverseLookupError}
						result={reverseLookupResult}
						clickPosition={inspectorClickPosition}
						containerRef={mapContainerRef}
						onClose={() => {
							setInspectorClickPosition(null)
							setReverseLookupResult(null)
							setReverseLookupError(null)
						}}
					/>

					{/* Feature Popup - appears when clicking a geometry on the map */}
					<FeaturePopup
						data={featurePopupData}
						containerRef={mapContainerRef}
						onInspect={handleFeaturePopupInspect}
						onEdit={handleFeaturePopupEdit}
						onZoom={handleFeaturePopupZoom}
						onClose={handleFeaturePopupClose}
					/>

					{mapError && (
						<div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded z-50">
							<p className="font-bold">Map Error</p>
							<p>{mapError}</p>
						</div>
					)}

					{/* Desktop: Floating locate button */}
					{!isMobile && (
						<div className="absolute bottom-12 right-4 z-10">
							<LocateButton onLocate={handleLocate} />
						</div>
					)}

					{!isMobile && (
						<div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none">
							<div className="mx-auto w-full max-w-6xl px-6 pb-2 text-xs text-gray-500 text-center pointer-events-auto">
								Hold <strong>{multiSelectModifierLabel}</strong> to multi-select
								{selectionCount > 0 ? ` • ${selectionCount} selected` : ''}
							</div>
						</div>
					)}

					{mounted && editor && (
						<div className="absolute top-2 left-2 right-2 z-10 pointer-events-none flex">
							<div className="w-full">
								<Toolbar
									datasetActions={{
										onExport: exportGeoJSON,
										canExport: stats.total > 0,
										onImport: handleImport,
										onClear: handleClear,
										onPublishNew: handlePublishNew,
										canPublishNew,
										onPublishUpdate: handlePublishUpdate,
										canPublishUpdate,
										onPublishCopy: handlePublishCopy,
										canPublishCopy,
										isPublishing,
									}}
									isMobile={isMobile}
									showLogin={true}
									onSearchResultSelect={(result) => handleSearchResultSelect(result as any)}
									onInspectorDeactivate={disableInspector}
									onStartNewDataset={startNewDataset}
									onCancelEditing={cancelEditing}
									onOsmQueryClick={handleOsmQueryClick}
									onOsmQueryView={handleOsmQueryView}
									onOsmAdvanced={() => setImportOsmDialogOpen(true)}
								/>
							</div>
						</div>
					)}

					{/* Mobile Panel - unified tabbed drawer */}
					{isMobile && (
						<MobilePanel
							geoEvents={geoEvents}
							collectionEvents={collectionEvents}
							mapContextEvents={mapContextEvents}
							activeDataset={activeDataset}
							currentUserPubkey={currentUser?.pubkey}
							userPubkey={userPubkey}
							datasetVisibility={effectiveVisibility}
							collectionVisibility={collectionVisibility}
							isPublishing={isPublishing}
							deletingKey={deletingKey}
							isFocused={isFocused}
							multiSelectModifier={multiSelectModifierLabel}
							onClearEditing={clearEditingSession}
							onLoadDataset={loadDatasetForEditing}
							onToggleVisibility={handleToggleVisibilityWithExitFocus}
							onToggleAllVisibility={handleToggleAllVisibilityWithExitFocus}
							onZoomToDataset={zoomToDataset}
							onDeleteDataset={onDeleteDataset}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onInspectDataset={handleInspectDatasetWithModeSwitch}
							onExitFocus={navigateHome}
							onToggleCollectionVisibility={handleToggleCollectionVisibility}
							onToggleAllCollectionVisibility={handleToggleAllCollectionVisibility}
							onZoomToCollection={zoomToCollection}
							onInspectCollection={handleInspectCollectionWithModeSwitch}
							onInspectContext={handleInspectContext}
							onCreateCollection={handleCreateCollection}
							onCreateContext={handleCreateContext}
							onEditCollection={handleEditCollection}
							onEditContext={handleEditContext}
							onOpenDebug={handleOpenDebug}
							onExitViewMode={exitViewMode}
							onCommentGeometryVisibility={handleCommentGeometryVisibility}
							onZoomToBounds={handleZoomToBounds}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={handleMentionVisibilityToggle}
							onMentionZoomTo={handleMentionZoomTo}
							collectionEditorMode={collectionEditorMode}
							editingCollection={editingCollection}
							onSaveCollection={handleSaveCollection}
							onCloseCollectionEditor={handleCloseCollectionEditor}
							contextEditorMode={contextEditorMode}
							editingContext={editingContext}
							onSaveContext={handleSaveContext}
							onCloseContextEditor={handleCloseContextEditor}
							onZoomToFeature={handleZoomToFeature}
							featureCollectionForUpload={memoizedFeatureCollection}
							onBlossomUploadComplete={handleBlobUploadComplete}
							ndk={ndk}
							onFilteredDatasetKeysChange={handleFilteredDatasetKeysChange}
						/>
					)}

					{isMobile && (
						<>
							<div className="fixed bottom-2 left-2 z-50 md:hidden">
								<div className="flex gap-2">
									<LocateButton onLocate={handleLocate} />
									<Button
										variant={panLocked ? 'default' : 'outline'}
										className="shadow-lg h-10 w-10 p-0 rounded-full bg-white/95 backdrop-blur hover:bg-white"
										onClick={togglePanLock}
										aria-label="Toggle pan lock while drawing"
										disabled={isDrawingMode}
										title={isDrawingMode ? 'Pan is auto-locked while drawing' : 'Toggle pan lock'}
									>
										{panLocked ? <Lock className="h-5 w-5" /> : <LockOpen className="h-5 w-5" />}
									</Button>
									{(currentMode === 'draw_linestring' || currentMode === 'draw_polygon') && (
										<Button
											variant="default"
											className="shadow-lg h-10 px-4 rounded-full"
											onClick={() => editor?.finishDrawing()}
											aria-label="Finish current drawing"
											disabled={!canFinishDrawing}
										>
											Finish
										</Button>
									)}
									<div className="relative">
										<Button
											ref={magnifierButtonRef}
											variant={magnifierEnabled ? 'default' : 'outline'}
											className="shadow-lg h-10 w-10 p-0 rounded-full"
											onPointerDown={handleMagnifierPointerDown}
											onPointerUp={handleMagnifierPointerUp}
											onPointerLeave={clearMagnifierLongPress}
											onPointerCancel={clearMagnifierLongPress}
											onContextMenu={(event) => event.preventDefault()}
											aria-label="Toggle magnifier"
										>
											<Search className="h-5 w-5" />
										</Button>
										{magnifierMenuOpen && (
											<div
												ref={magnifierMenuRef}
												className="pointer-events-auto absolute bottom-14 left-0 z-50 w-52 rounded-xl border border-gray-200 bg-white/95 px-4 py-3 text-sm shadow-lg backdrop-blur"
											>
												<div className="mb-3 text-xs font-medium text-gray-600">Magnifier zoom</div>
												<div className="flex items-center gap-3">
													<button
														type="button"
														className="h-8 w-8 rounded-md border border-gray-200 text-sm text-gray-700"
														onClick={() =>
															setMagnifierZoomOffset((value) => Math.max(1, value - 0.5))
														}
														aria-label="Decrease magnifier zoom"
													>
														-
													</button>
													<input
														type="range"
														min={1}
														max={6}
														step={0.5}
														value={magnifierZoomOffset}
														onChange={(event) => setMagnifierZoomOffset(Number(event.target.value))}
														className="h-2 w-full"
														aria-label="Magnifier zoom level"
													/>
													<button
														type="button"
														className="h-8 w-8 rounded-md border border-gray-200 text-sm text-gray-700"
														onClick={() =>
															setMagnifierZoomOffset((value) => Math.min(6, value + 0.5))
														}
														aria-label="Increase magnifier zoom"
													>
														+
													</button>
												</div>
												<div className="mt-2 text-xs text-gray-500">
													Zoom +{magnifierZoomOffset}
												</div>
											</div>
										)}
									</div>
								</div>
							</div>
							{/* Mobile buttons - positioned to move up when drawer is open */}
							<div
								className={`fixed bottom-2 right-2 z-50 flex flex-col gap-2 md:hidden transition-all duration-300 ${
									mobilePanelOpen
										? mobilePanelSnap === 'expanded'
											? 'bottom-[calc(82vh+0.5rem)]'
											: 'bottom-[calc(45vh+0.5rem)]'
										: ''
								}`}
							>
								{/* Draw tools toggle */}
								<Button
									size="icon"
									className="shadow-lg h-10 w-10 rounded-full"
									variant={mobileToolsOpen ? 'default' : 'outline'}
									onClick={() => {
										setMobileSearchOpen(false)
										setMobileActionsOpen(false)
										setMobileToolsOpen(!mobileToolsOpen)
									}}
									aria-label="Toggle draw tools"
								>
									<Edit3 className="h-5 w-5" />
								</Button>
								{/* Search tools toggle */}
								<Button
									size="icon"
									className="shadow-lg h-10 w-10 rounded-full"
									variant={mobileSearchOpen ? 'default' : 'outline'}
									onClick={() => {
										setMobileToolsOpen(false)
										setMobileActionsOpen(false)
										setMobileSearchOpen(!mobileSearchOpen)
									}}
									aria-label="Toggle search"
								>
									<Search className="h-5 w-5" />
								</Button>
								{/* Actions toggle */}
								<Button
									size="icon"
									className="shadow-lg h-10 w-10 rounded-full"
									variant={mobileActionsOpen ? 'default' : 'outline'}
									onClick={() => {
										setMobileToolsOpen(false)
										setMobileSearchOpen(false)
										setMobileActionsOpen(!mobileActionsOpen)
									}}
									aria-label="Toggle actions"
								>
									<UploadCloud className="h-5 w-5" />
								</Button>
								{/* Panel toggle */}
								<Button
									size="icon"
									className="shadow-lg h-10 w-10 rounded-full"
									variant={mobilePanelOpen ? 'default' : 'outline'}
									onClick={() => setMobilePanelOpen(!mobilePanelOpen)}
									aria-label="Toggle panel"
								>
									<Layers className="h-5 w-5" />
								</Button>
							</div>
						</>
					)}

					{debugEvent && (
						<DebugDialog
							event={debugEvent}
							open={debugDialogOpen}
							onOpenChange={setDebugDialogOpen}
						/>
					)}

					{/* Blossom Upload Dialog */}
					<BlossomUploadDialog
						open={blossomUploadDialogOpen}
						onOpenChange={setBlossomUploadDialogOpen}
						geojson={pendingPublishCollection ?? memoizedFeatureCollection}
						onUploadComplete={handleBlobUploadComplete}
						onPublishWithUpload={handlePublishWithBlossomUpload}
						onSkip={handlePublishNew}
						allowSkip={false}
						title="Dataset Size Warning"
						ndk={ndk}
					/>

					{/* Import OSM Dialog */}
					<ImportOsmDialog
						open={importOsmDialogOpen}
						onOpenChange={setImportOsmDialogOpen}
						mapCenter={
							map.current
								? (() => {
										const center = map.current.getCenter()
										return { lat: center.lat, lon: center.lng }
									})()
								: undefined
						}
						mapBounds={
							map.current
								? (() => {
										const bounds = map.current.getBounds()
										return {
											west: bounds.getWest(),
											south: bounds.getSouth(),
											east: bounds.getEast(),
											north: bounds.getNorth(),
										}
									})()
								: undefined
						}
						onImport={(features) => {
							if (!editor) return
							features.forEach((feature) => {
								editor.addFeature(toImportedEditorFeature(feature))
							})
						}}
					/>

					{/* OSM Query Results Panel (cursor-oriented) */}
					<OsmResultsPanel onImport={handleOsmImport} onClose={clearOsmQuery} />
				</div>
			</SidebarInset>
		</SidebarProvider>
	)
}

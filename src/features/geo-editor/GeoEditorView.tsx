import { useNDK, useNDKCurrentUser } from '@nostr-dev-kit/react'
import type { FeatureCollection } from 'geojson'
import { Edit3, FilePenLine, Layers, Search, UploadCloud } from 'lucide-react'
import type maplibregl from 'maplibre-gl'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DebugDialog } from '../../components/DebugDialog'
import { GeoDatasetsPanelContent } from '../../components/GeoDatasetsPanel'
import { GeoEditorInfoPanelContent } from '../../components/GeoEditorInfoPanel'
import { LoginSessionButtons } from '../../components/LoginSessionButtom'
import { Button } from '../../components/ui/button'
import { Sheet, SheetContent } from '../../components/ui/sheet'
import { earthlyGeoServer, type ReverseLookupOutput } from '../../ctxcn/EarthlyGeoServerClient'
import { useAvailableGeoFeatures } from '../../lib/hooks/useAvailableGeoFeatures'
import { useIsMobile } from '../../lib/hooks/useIsMobile'
import { useGeoCollections, useStations } from '../../lib/hooks/useStations'
import type { NDKGeoEvent } from '../../lib/ndk/NDKGeoEvent'
import { Editor } from './components/Editor'
import { LocationInspectorPopup } from './components/LocationInspectorPopup'
import { Magnifier } from './components/Magnifier'
import { GeoEditorMap as MapComponent } from './components/Map'
import { Toolbar } from './components/Toolbar'
import type { EditorFeature, EditorMode } from './core'
import {
	useDatasetManagement,
	useMapLayers,
	usePublishing,
	useViewMode,
	REMOTE_FILL_LAYER,
	REMOTE_LINE_LAYER,
	REMOTE_POINT_LAYER,
	REMOTE_ANNOTATION_ANCHOR_LAYER,
	REMOTE_ANNOTATION_LAYER,
} from './hooks'
import { useEditorStore } from './store'
import type { GeoSearchResult } from './types'
import { ensureFeatureCollection, extractCollectionMeta } from './utils'

const MAGNIFIER_SIZE = 140
const MAGNIFIER_OFFSET = { x: 80, y: -80 }
const POINTER_OFFSET = { x: 0, y: -48 }

type ReverseLookupResult = ReverseLookupOutput['result']

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
	const [previousMode, setPreviousMode] = useState<string | null>(null)
	const [showToolbar, setShowToolbar] = useState(true)

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

	// Store state
	const editor = useEditorStore((state) => state.editor)
	const features = useEditorStore((state) => state.features)
	const stats = useEditorStore((state) => state.stats)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const selectionCount = selectedFeatureIds.length
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const activeDataset = useEditorStore((state) => state.activeDataset)
	const datasetVisibility = useEditorStore((state) => state.datasetVisibility)
	const setDatasetVisibility = useEditorStore((state) => state.setDatasetVisibility)
	const setCollectionMeta = useEditorStore((state) => state.setCollectionMeta)
	const isPublishing = useEditorStore((state) => state.isPublishing)
	const showDatasetsPanel = useEditorStore((state) => state.showDatasetsPanel)
	const setShowDatasetsPanel = useEditorStore((state) => state.setShowDatasetsPanel)
	const showInfoPanel = useEditorStore((state) => state.showInfoPanel)
	const setShowInfoPanel = useEditorStore((state) => state.setShowInfoPanel)
	const mobileDatasetsOpen = useEditorStore((state) => state.mobileDatasetsOpen)
	const setMobileDatasetsOpen = useEditorStore((state) => state.setMobileDatasetsOpen)
	const mobileInfoOpen = useEditorStore((state) => state.mobileInfoOpen)
	const setMobileInfoOpen = useEditorStore((state) => state.setMobileInfoOpen)
	const setShowTips = useEditorStore((state) => state.setShowTips)
	const mobileToolsOpen = useEditorStore((state) => state.mobileToolsOpen)
	const mobileSearchOpen = useEditorStore((state) => state.mobileSearchOpen)
	const mobileActionsOpen = useEditorStore((state) => state.mobileActionsOpen)
	const setMobileActiveState = useEditorStore((state) => state.setMobileActiveState)
	const panLocked = useEditorStore((state) => state.panLocked)
	const setPanLocked = useEditorStore((state) => state.setPanLocked)
	const canFinishDrawing = useEditorStore((state) => state.canFinishDrawing)
	const currentMode = useEditorStore((state) => state.mode)
	const setCurrentMode = useEditorStore((state) => state.setMode)
	const mapSource = useEditorStore((state) => state.mapSource)
	const inspectorActive = useEditorStore((state) => state.inspectorActive)
	const setInspectorActive = useEditorStore((state) => state.setInspectorActive)

	// External data
	const { events: geoEvents } = useStations([{ limit: 50 }])
	const { events: collectionEvents } = useGeoCollections([{ limit: 50 }])
	const { ndk } = useNDK()
	const currentUser = useNDKCurrentUser()
	const isMobile = useIsMobile()

	// Callback for ensuring info panel is visible
	const ensureInfoPanelVisible = useCallback(() => {
		if (isMobile) {
			setMobileInfoOpen(true)
		} else {
			setShowInfoPanel(true)
		}
	}, [isMobile, setMobileInfoOpen, setShowInfoPanel])

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
		loadDatasetForEditing,
		clearEditingSession,
	} = useDatasetManagement(map, geoEvents)

	const {
		handlePublishNew,
		handlePublishUpdate,
		handlePublishCopy,
		handleDeleteDataset,
		canPublishNew,
		canPublishUpdate,
		canPublishCopy,
	} = usePublishing({
		ndk,
		currentUserPubkey: currentUser?.pubkey,
		getDatasetName,
		getDatasetKey,
	})

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
		handleInspectCollection,
		handleOpenDebug,
	} = useViewMode({ geoEvents, onEnsureInfoPanelVisible: ensureInfoPanelVisible })

	// Visible geo events based on visibility toggle
	const visibleGeoEvents = useMemo(
		() => geoEvents.filter((event) => datasetVisibility[getDatasetKey(event)] !== false),
		[geoEvents, datasetVisibility, getDatasetKey],
	)

	// Available features for $ mentions in comments
	const availableFeatures = useAvailableGeoFeatures(visibleGeoEvents, resolvedCollectionResolver)

	// Map layers hook
	const { remoteLayersReady } = useMapLayers({
		mapRef: map,
		mounted,
		visibleGeoEvents,
		resolvedCollectionResolver,
		resolvedCollectionsVersion,
	})

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
	useEffect(() => {
		if (isMobile) {
			setMobileDatasetsOpen(false)
			setMobileInfoOpen(false)
			setShowToolbar(false)
			setShowTips(false)
		} else {
			setShowDatasetsPanel(true)
			setShowInfoPanel(true)
			setShowToolbar(true)
			setShowTips(true)
		}
	}, [
		isMobile,
		setMobileDatasetsOpen,
		setMobileInfoOpen,
		setShowTips,
		setShowDatasetsPanel,
		setShowInfoPanel,
	])

	// Preload blob references for datasets
	useEffect(() => {
		let cancelled = false
		;(async () => {
			for (const event of geoEvents) {
				if (cancelled) break
				if (event.blobReferences.length === 0) continue
				try {
					await ensureResolvedFeatureCollection(event)
					if (isMountedRef.current) {
						setResolvedCollectionsVersion((v) => v + 1)
					}
				} catch (error) {
					console.warn('Failed to resolve external blob for dataset', event.id, error)
				}
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
				const newFeatures = collection.features.map((f: any) => ({
					...f,
					id: f.id || crypto.randomUUID(),
					properties: {
						...f.properties,
						meta: 'feature',
						featureId: f.id || crypto.randomUUID(),
					},
				}))
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
		loadDatasetForEditing(event)
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
				const newFeatures = collection.features.map((f: any) => ({
					...f,
					id: f.id || crypto.randomUUID(),
					properties: {
						...f.properties,
						meta: 'feature',
						featureId: f.id || crypto.randomUUID(),
					},
				}))

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

		const remoteLayers = [
			REMOTE_FILL_LAYER,
			REMOTE_LINE_LAYER,
			REMOTE_POINT_LAYER,
			REMOTE_ANNOTATION_ANCHOR_LAYER,
			REMOTE_ANNOTATION_LAYER,
		]

		const handleMapDatasetClick = (event: maplibregl.MapLayerMouseEvent & any) => {
			const feature = event.features?.[0]
			if (!feature?.properties) return
			const sourceEventId = feature.properties.sourceEventId as string | undefined
			const datasetId = feature.properties.datasetId as string | undefined

			const dataset =
				geoEventsRef.current.find((ev) => ev.id === sourceEventId) ??
				geoEventsRef.current.find((ev) => (ev.datasetId ?? ev.id) === datasetId)

			if (!dataset) return

			ensureResolvedFeatureCollection(dataset).catch(() => undefined)
			handleInspectDataset(dataset)
		}

		const handleMouseEnter = () => {
			mapInstance.getCanvas().style.cursor = 'pointer'
		}

		const handleMouseLeave = () => {
			mapInstance.getCanvas().style.cursor = ''
		}

		for (const layer of remoteLayers) {
			if (mapInstance.getLayer(layer)) {
				mapInstance.on('click', layer, handleMapDatasetClick)
				mapInstance.on('mouseenter', layer, handleMouseEnter)
				mapInstance.on('mouseleave', layer, handleMouseLeave)
			}
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
		}
	}, [handleInspectDataset, ensureResolvedFeatureCollection, geoEventsRef, remoteLayersReady])

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

	// Resolve naddr to dataset
	const resolveNaddrToDataset = useCallback(
		(address: string): NDKGeoEvent | null => {
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
							(ev.datasetId === identifier || ev.dTag === identifier),
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
		(address: string, _featureId: string | undefined, _visible: boolean) => {
			const dataset = resolveNaddrToDataset(address)
			if (!dataset) {
				console.warn('Could not find dataset for address:', address)
				return
			}

			// Toggle the dataset visibility
			// Note: For now, we toggle the whole dataset. Feature-level visibility
			// would require additional layer/filter management.
			toggleDatasetVisibility(dataset)
		},
		[resolveNaddrToDataset, toggleDatasetVisibility],
	)

	const multiSelectModifierLabel = editor?.getMultiSelectModifierLabel() ?? 'Shift'

	return (
		<div ref={mapContainerRef} className="relative h-screen w-full">
			<MapComponent
				onLoad={(m) => {
					map.current = m
					setMounted(true)
				}}
				mapSource={mapSource}
			>
				<Editor />
			</MapComponent>

			<Magnifier
				enabled={magnifierEnabled}
				visible={magnifierVisible}
				position={magnifierPosition}
				center={magnifierCenter}
				mainMap={map.current}
				size={MAGNIFIER_SIZE}
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

			{mapError && (
				<div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded z-50">
					<p className="font-bold">Map Error</p>
					<p>{mapError}</p>
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
				<div className="absolute top-4 left-4 right-4 z-10 pointer-events-none flex">
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
							showLogin={!isMobile}
							onSearchResultSelect={(result) => handleSearchResultSelect(result as any)}
							onInspectorDeactivate={disableInspector}
						/>
					</div>
				</div>
			)}

			{!isMobile && mounted && showDatasetsPanel && (
				<div className="pointer-events-auto absolute left-4 top-[88px] bottom-4 z-40 hidden md:flex w-[25vw]">
					<div className="flex-1 overflow-hidden rounded-2xl bg-white/95 shadow-xl backdrop-blur">
						<div className="h-full overflow-y-auto p-4">
							<GeoDatasetsPanelContent
								geoEvents={geoEvents}
								collectionEvents={collectionEvents}
								activeDataset={activeDataset}
								currentUserPubkey={currentUser?.pubkey}
								datasetVisibility={datasetVisibility}
								isPublishing={isPublishing}
								deletingKey={deletingKey}
								onClearEditing={clearEditingSession}
								onLoadDataset={handleDatasetSelect}
								onToggleVisibility={toggleDatasetVisibility}
								onZoomToDataset={zoomToDataset}
								onDeleteDataset={onDeleteDataset}
								getDatasetKey={getDatasetKey}
								getDatasetName={getDatasetName}
								onZoomToCollection={zoomToCollection}
								onInspectDataset={handleInspectDataset}
								onInspectCollection={handleInspectCollection}
								onOpenDebug={handleOpenDebug}
								onClose={() => setShowDatasetsPanel(false)}
							/>
						</div>
					</div>
				</div>
			)}

			{!isMobile && mounted && showInfoPanel && (
				<div className="pointer-events-auto absolute right-4 top-[88px] bottom-4 z-40 hidden md:flex w-96">
					<div className="flex-1 overflow-hidden rounded-2xl bg-white shadow-xl">
						{editor && (
							<div className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-4 py-1 text-xs text-white backdrop-blur">
								{editor.getMode() === 'select' && 'Select features to edit'}
								{editor.getMode() === 'draw_point' && 'Click to place point'}
								{editor.getMode() === 'draw_linestring' &&
									'Click to add points, double-click to finish'}
								{editor.getMode() === 'draw_polygon' &&
									'Click to add points, double-click to finish'}
								{editor.getMode() === 'edit' && 'Drag vertices to edit'}
							</div>
						)}
						<div className="h-full overflow-y-auto p-4">
							<GeoEditorInfoPanelContent
								currentUserPubkey={currentUser?.pubkey}
								onLoadDataset={loadDatasetForEditing}
								onToggleVisibility={toggleDatasetVisibility}
								onZoomToDataset={zoomToDataset}
								onDeleteDataset={onDeleteDataset}
								onZoomToCollection={zoomToCollection}
								deletingKey={deletingKey}
								onExitViewMode={exitViewMode}
								onClose={() => setShowInfoPanel(false)}
								getDatasetKey={getDatasetKey}
								getDatasetName={getDatasetName}
								onCommentGeometryVisibility={handleCommentGeometryVisibility}
								onZoomToBounds={handleZoomToBounds}
								availableFeatures={availableFeatures}
								onMentionVisibilityToggle={handleMentionVisibilityToggle}
								onMentionZoomTo={handleMentionZoomTo}
							/>
						</div>
					</div>
				</div>
			)}

			{isMobile && (
				<>
					<div className="fixed top-4 right-4 z-50">
						<LoginSessionButtons />
					</div>
					<Sheet open={mobileDatasetsOpen} onOpenChange={setMobileDatasetsOpen} modal={false}>
						<SheetContent side="bottom" className="p-0 h-[35vh] sm:hidden" hideOverlay>
							<div className="h-full w-full overflow-y-auto px-4 pb-6 pt-3">
								<GeoDatasetsPanelContent
									geoEvents={geoEvents}
									collectionEvents={collectionEvents}
									activeDataset={activeDataset}
									currentUserPubkey={currentUser?.pubkey}
									datasetVisibility={datasetVisibility}
									isPublishing={isPublishing}
									deletingKey={deletingKey}
									onClearEditing={clearEditingSession}
									onLoadDataset={loadDatasetForEditing}
									onToggleVisibility={toggleDatasetVisibility}
									onZoomToDataset={zoomToDataset}
									onDeleteDataset={onDeleteDataset}
									getDatasetKey={getDatasetKey}
									getDatasetName={getDatasetName}
									onZoomToCollection={zoomToCollection}
									onInspectDataset={handleInspectDataset}
									onInspectCollection={handleInspectCollection}
									onOpenDebug={handleOpenDebug}
									onClose={() => setMobileDatasetsOpen(false)}
								/>
							</div>
						</SheetContent>
					</Sheet>

					<Sheet open={mobileInfoOpen} onOpenChange={setMobileInfoOpen} modal={false}>
						<SheetContent side="bottom" className="p-0 h-[35vh] sm:hidden" hideOverlay>
							<div className="h-full w-full overflow-y-auto px-4 pb-6 pt-3">
								<GeoEditorInfoPanelContent
									currentUserPubkey={currentUser?.pubkey}
									onLoadDataset={loadDatasetForEditing}
									onToggleVisibility={toggleDatasetVisibility}
									onZoomToDataset={zoomToDataset}
									onDeleteDataset={onDeleteDataset}
									onZoomToCollection={zoomToCollection}
									deletingKey={deletingKey}
									onExitViewMode={exitViewMode}
									onClose={() => setMobileInfoOpen(false)}
									getDatasetKey={getDatasetKey}
									getDatasetName={getDatasetName}
									onCommentGeometryVisibility={handleCommentGeometryVisibility}
									onZoomToBounds={handleZoomToBounds}
									availableFeatures={availableFeatures}
									onMentionVisibilityToggle={handleMentionVisibilityToggle}
									onMentionZoomTo={handleMentionZoomTo}
								/>
							</div>
						</SheetContent>
					</Sheet>
				</>
			)}

			{isMobile && (
				<>
					<div className="fixed bottom-4 left-4 z-50 md:hidden">
						<div className="flex gap-2">
							<Button
								variant={panLocked ? 'default' : 'outline'}
								className="shadow-lg"
								onClick={togglePanLock}
								aria-label="Toggle pan lock while drawing"
								disabled={isDrawingMode}
								title={isDrawingMode ? 'Pan is auto-locked while drawing' : 'Toggle pan lock'}
							>
								{panLocked ? 'Pan locked' : 'Pan unlocked'}
							</Button>
							{(currentMode === 'draw_linestring' || currentMode === 'draw_polygon') && (
								<Button
									variant="default"
									className="shadow-lg"
									onClick={() => editor?.finishDrawing()}
									aria-label="Finish current drawing"
									disabled={!canFinishDrawing}
								>
									Finish
								</Button>
							)}
							<Button
								variant={magnifierEnabled ? 'default' : 'outline'}
								className="shadow-lg"
								onClick={toggleMagnifier}
								aria-label="Toggle magnifier"
							>
								<Search className="h-4 w-4" />
							</Button>
						</div>
					</div>
					<div className="fixed bottom-4 right-4 z-50 flex flex-col gap-3 md:hidden">
						<Button
							size="icon-lg"
							className="shadow-lg"
							variant={mobileDatasetsOpen ? 'default' : 'outline'}
							onClick={() => setMobileActiveState(mobileDatasetsOpen ? null : 'datasets')}
						>
							<Layers className="h-6 w-6" />
						</Button>
						<Button
							size="icon-lg"
							className="shadow-lg"
							variant={mobileInfoOpen ? 'default' : 'outline'}
							onClick={() => setMobileActiveState(mobileInfoOpen ? null : 'info')}
						>
							<FilePenLine className="h-6 w-6" />
						</Button>
						<Button
							size="icon-lg"
							className="shadow-lg"
							variant={mobileToolsOpen ? 'default' : 'outline'}
							onClick={() => setMobileActiveState(mobileToolsOpen ? null : 'tools')}
						>
							<Edit3 className="h-6 w-6" />
						</Button>
						<Button
							size="icon-lg"
							className="shadow-lg"
							variant={mobileSearchOpen ? 'default' : 'outline'}
							onClick={() => setMobileActiveState(mobileSearchOpen ? null : 'search')}
						>
							<Search className="h-6 w-6" />
						</Button>
						<Button
							size="icon-lg"
							className="shadow-lg"
							variant={mobileActionsOpen ? 'default' : 'outline'}
							onClick={() => setMobileActiveState(mobileActionsOpen ? null : 'actions')}
						>
							<UploadCloud className="h-6 w-6" />
						</Button>
					</div>
				</>
			)}

			{debugEvent && (
				<DebugDialog event={debugEvent} open={debugDialogOpen} onOpenChange={setDebugDialogOpen} />
			)}
		</div>
	)
}

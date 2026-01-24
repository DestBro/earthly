import type { FeatureCollection } from 'geojson'
import { create } from 'zustand'
import { earthlyGeoServer } from '../../ctxcn'
import type { NDKGeoCollectionEvent } from '../../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../../lib/ndk/NDKGeoEvent'
import type { EditorFeature, EditorMode, GeoEditor } from './core'
import type { CollectionMeta, EditorBlobReference, GeoSearchResult } from './types'
import {
	detectBlobScope,
	ensureFeatureCollection,
	fetchGeoJsonPayload,
	summarizeFeatureCollection,
} from './utils'

interface EditorStats {
	points: number
	lines: number
	polygons: number
	total: number
}

export interface MapLayerState {
	id: string
	title: string
	kind: 'chunked-vector' | 'pmtiles'
	enabled: boolean
	opacity: number
	// For pmtiles layers
	blossomServer?: string
	file?: string
	pmtilesType?: 'raster' | 'vector'
}

interface EditorState {
	editor: GeoEditor | null
	features: EditorFeature[]
	stats: EditorStats
	mode: EditorMode
	selectedFeatureIds: string[]
	snappingEnabled: boolean
	panLocked: boolean
	canFinishDrawing: boolean
	history: {
		canUndo: boolean
		canRedo: boolean
	}

	// Metadata & Dataset State
	collectionMeta: CollectionMeta
	activeDataset: NDKGeoEvent | null
	datasetVisibility: Record<string, boolean>

	// Publishing State
	isPublishing: boolean
	publishMessage: string | null
	publishError: string | null

	// Blob References State
	blobReferences: EditorBlobReference[]
	blobDraftUrl: string
	blobDraftStatus: 'idle' | 'loading' | 'error'
	blobDraftError: string | null
	previewingBlobReferenceId: string | null
	blobPreviewCollection: FeatureCollection | null

	// View Mode State
	viewMode: 'edit' | 'view'
	viewDataset: NDKGeoEvent | null
	viewCollection: NDKGeoCollectionEvent | null
	viewCollectionEvents: NDKGeoEvent[]

	// Focus State (for URL routing)
	focusedNaddr: string | null
	focusedType: 'geoevent' | 'collection' | null

	// Focused map geometry (e.g. last clicked remote feature)
	focusedMapGeometry: {
		bbox: [number, number, number, number] // [west, south, east, north]
		datasetId?: string
		sourceEventId?: string
		featureId?: string
	} | null

	// UI Input State (moved from view)
	newCollectionProp: { key: string; value: string }
	newFeatureProp: { key: string; value: string }

	// UI State
	showTips: boolean
	showDatasetsPanel: boolean
	showInfoPanel: boolean
	mobileDatasetsOpen: boolean
	mobileInfoOpen: boolean
	mobileToolsOpen: boolean
	mobileSearchOpen: boolean
	mobileActionsOpen: boolean
	inspectorActive: boolean
	sidebarViewMode: 'datasets' | 'collections' | 'combined' | 'edit' | 'posts' | 'settings' | 'help'

	// Search State
	searchQuery: string
	searchResults: GeoSearchResult[]
	searchLoading: boolean
	searchError: string | null

	// OSM Query State (cursor-oriented)
	osmQueryMode: 'idle' | 'click' | 'loading'
	osmQueryFilter: string
	osmQueryPosition: { x: number; y: number; lat: number; lon: number } | null
	osmQueryResults: GeoJSON.Feature[]
	osmQueryError: string | null
	osmQuerySelectedIds: Set<string>

	// Current Map Viewport Bounds (for Create Map)
	currentBbox: [number, number, number, number] | null // [west, south, east, north]

	// Drawn Map Area Rectangle (for Create Map extraction)
	mapAreaRect: {
		bbox: [number, number, number, number] // [west, south, east, north]
		areaSqKm: number
	} | null

	// Flag to indicate we're drawing a polygon for map area
	isDrawingMapArea: boolean

	// Actions
	setEditor: (editor: GeoEditor | null) => void
	setFeatures: (features: EditorFeature[]) => void
	setMode: (mode: EditorMode) => void
	setSelectedFeatureIds: (ids: string[]) => void
	setSnappingEnabled: (enabled: boolean) => void
	setPanLocked: (locked: boolean) => void
	setCanFinishDrawing: (canFinish: boolean) => void
	setHistoryState: (canUndo: boolean, canRedo: boolean) => void

	setCollectionMeta: (meta: CollectionMeta) => void
	setActiveDataset: (dataset: NDKGeoEvent | null) => void
	setDatasetVisibility: (
		visibility:
			| Record<string, boolean>
			| ((prev: Record<string, boolean>) => Record<string, boolean>),
	) => void

	setIsPublishing: (isPublishing: boolean) => void
	setPublishMessage: (message: string | null) => void
	setPublishError: (error: string | null) => void

	setBlobReferences: (refs: EditorBlobReference[]) => void
	setBlobDraftUrl: (url: string) => void
	setBlobDraftStatus: (status: 'idle' | 'loading' | 'error') => void
	setBlobDraftError: (error: string | null) => void
	setPreviewingBlobReferenceId: (id: string | null) => void
	setBlobPreviewCollection: (collection: FeatureCollection | null) => void

	fetchBlobReference: () => Promise<void>
	previewBlobReference: (id: string) => Promise<void>
	removeBlobReference: (id: string) => void

	setViewMode: (mode: 'edit' | 'view') => void
	setViewDataset: (dataset: NDKGeoEvent | null) => void
	setViewCollection: (collection: NDKGeoCollectionEvent | null) => void
	setViewCollectionEvents: (events: NDKGeoEvent[]) => void

	// Focus Actions
	setFocused: (type: 'geoevent' | 'collection', naddr: string) => void
	clearFocused: () => void

	// Focused map geometry actions
	setFocusedMapGeometry: (focused: EditorState['focusedMapGeometry']) => void
	clearFocusedMapGeometry: () => void

	setNewCollectionProp: (prop: { key: string; value: string }) => void
	setNewFeatureProp: (prop: { key: string; value: string }) => void

	// UI Actions
	setShowTips: (show: boolean | ((prev: boolean) => boolean)) => void
	setShowDatasetsPanel: (show: boolean | ((prev: boolean) => boolean)) => void
	setShowInfoPanel: (show: boolean | ((prev: boolean) => boolean)) => void
	setMobileDatasetsOpen: (open: boolean) => void
	setMobileInfoOpen: (open: boolean) => void
	setMobileToolsOpen: (open: boolean) => void
	setMobileSearchOpen: (open: boolean) => void
	setMobileActionsOpen: (open: boolean) => void
	setMobileActiveState: (state: 'datasets' | 'info' | 'tools' | 'search' | 'actions' | null) => void
	setInspectorActive: (active: boolean) => void
	setSidebarViewMode: (
		mode: 'datasets' | 'collections' | 'combined' | 'edit' | 'posts' | 'settings' | 'help',
	) => void

	// Search Actions
	setSearchQuery: (query: string) => void
	setSearchResults: (results: GeoSearchResult[]) => void
	setSearchLoading: (loading: boolean) => void
	setSearchError: (error: string | null) => void
	performSearch: () => Promise<void>
	clearSearch: () => void

	// OSM Query Actions
	setOsmQueryMode: (mode: 'idle' | 'click' | 'loading') => void
	setOsmQueryFilter: (filter: string) => void
	setOsmQueryPosition: (position: { x: number; y: number; lat: number; lon: number } | null) => void
	setOsmQueryResults: (results: GeoJSON.Feature[]) => void
	setOsmQueryError: (error: string | null) => void
	toggleOsmQuerySelection: (id: string) => void
	clearOsmQuery: () => void

	// Current Bbox Action
	setCurrentBbox: (bbox: [number, number, number, number] | null) => void

	// Map Area Rectangle Actions
	setMapAreaRect: (rect: EditorState['mapAreaRect']) => void
	clearMapAreaRect: () => void
	setIsDrawingMapArea: (drawing: boolean) => void

	setMapSource: (source: EditorState['mapSource']) => void
	setShowMapSettings: (show: boolean) => void

	// Map Source State
	mapSource: {
		type: 'default' | 'pmtiles' | 'blossom'
		location: 'remote' | 'local'
		url?: string
		file?: File
		/** Base URL for fetching PMTiles chunks (used with blossom) */
		blossomServer?: string
		/** Lock map zoom/pan to the bounds of the PMTiles source */
		boundsLocked?: boolean
	}
	showMapSettings: boolean

	// Map Layers State (from Nostr announcements)
	mapLayers: MapLayerState[]
	setMapLayers: (layers: MapLayerState[]) => void
	updateMapLayerState: (
		id: string,
		updates: Partial<Pick<MapLayerState, 'enabled' | 'opacity'>>,
	) => void
	reorderMapLayers: (fromIndex: number, toIndex: number) => void

	// Computed/Helpers
	updateStats: () => void
}

export const useEditorStore = create<EditorState>((set, get) => ({
	editor: null,
	features: [],
	stats: { points: 0, lines: 0, polygons: 0, total: 0 },
	mode: 'select',
	selectedFeatureIds: [],
	snappingEnabled: true,
	panLocked: false,
	canFinishDrawing: false,
	history: { canUndo: false, canRedo: false },

	collectionMeta: {
		name: '',
		description: '',
		color: '#3b82f6',
		customProperties: {},
	},
	activeDataset: null,
	datasetVisibility: {},

	isPublishing: false,
	publishMessage: null,
	publishError: null,

	blobReferences: [],
	blobDraftUrl: '',
	blobDraftStatus: 'idle',
	blobDraftError: null,
	previewingBlobReferenceId: null,
	blobPreviewCollection: null,

	viewMode: 'view',
	viewDataset: null,
	viewCollection: null,
	viewCollectionEvents: [],

	// Focus State
	focusedNaddr: null,
	focusedType: null,
	focusedMapGeometry: null,

	newCollectionProp: { key: '', value: '' },
	newFeatureProp: { key: '', value: '' },

	// UI State
	showTips: true,
	showDatasetsPanel: false,
	showInfoPanel: false,
	mobileDatasetsOpen: false,
	mobileInfoOpen: false,
	mobileToolsOpen: false,
	mobileSearchOpen: false,
	mobileActionsOpen: false,
	inspectorActive: false,
	sidebarViewMode: 'datasets',

	// Search State
	searchQuery: '',
	searchResults: [],
	searchLoading: false,
	searchError: null,

	// OSM Query State
	osmQueryMode: 'idle',
	osmQueryFilter: 'highway',
	osmQueryPosition: null,
	osmQueryResults: [],
	osmQueryError: null,
	osmQuerySelectedIds: new Set(),

	// Current Map Viewport Bounds
	currentBbox: null,

	// Drawn Map Area Rectangle
	mapAreaRect: null,
	isDrawingMapArea: false,

	setEditor: (editor) => set({ editor }),

	setMapAreaRect: (rect) => set({ mapAreaRect: rect }),
	clearMapAreaRect: () => set({ mapAreaRect: null, isDrawingMapArea: false }),
	setIsDrawingMapArea: (drawing) => set({ isDrawingMapArea: drawing }),

	setFeatures: (features) => {
		set({ features })
		get().updateStats()
	},

	setMode: (mode) => {
		const { editor } = get()
		if (editor && editor.getMode() !== mode) {
			editor.setMode(mode)
		}
		set({ mode })
	},

	setSelectedFeatureIds: (selectedFeatureIds) => set({ selectedFeatureIds }),

	setSnappingEnabled: (snappingEnabled) => {
		set({ snappingEnabled })
	},

	setPanLocked: (panLocked) => {
		const { editor } = get()
		if (editor) {
			editor.setPanLocked(panLocked)
		}
		set({ panLocked })
	},

	setCanFinishDrawing: (canFinishDrawing) => set({ canFinishDrawing }),

	setHistoryState: (canUndo, canRedo) => set({ history: { canUndo, canRedo } }),

	setCollectionMeta: (collectionMeta) => set({ collectionMeta }),
	setActiveDataset: (activeDataset) => set({ activeDataset }),
	setDatasetVisibility: (update) =>
		set((state) => ({
			datasetVisibility: typeof update === 'function' ? update(state.datasetVisibility) : update,
		})),

	setIsPublishing: (isPublishing) => set({ isPublishing }),
	setPublishMessage: (publishMessage) => set({ publishMessage }),
	setPublishError: (publishError) => set({ publishError }),

	setBlobReferences: (blobReferences) => set({ blobReferences }),
	setBlobDraftUrl: (blobDraftUrl) => set({ blobDraftUrl }),
	setBlobDraftStatus: (blobDraftStatus) => set({ blobDraftStatus }),
	setBlobDraftError: (blobDraftError) => set({ blobDraftError }),
	setPreviewingBlobReferenceId: (previewingBlobReferenceId) => set({ previewingBlobReferenceId }),
	setBlobPreviewCollection: (blobPreviewCollection) => set({ blobPreviewCollection }),

	fetchBlobReference: async () => {
		const { blobDraftUrl } = get()
		const url = blobDraftUrl.trim()
		if (!url) return

		set({ blobDraftStatus: 'loading', blobDraftError: null })

		try {
			const { payload, size, mimeType } = await fetchGeoJsonPayload(url)
			const normalized = ensureFeatureCollection(payload)
			const collection = JSON.parse(JSON.stringify(normalized)) as FeatureCollection
			const summary = summarizeFeatureCollection(collection)
			const scopeInfo = detectBlobScope(collection)
			const id = crypto.randomUUID()

			const reference: EditorBlobReference = {
				id,
				url,
				scope: scopeInfo.scope,
				featureId: scopeInfo.featureId,
				status: 'ready',
				featureCount: summary.featureCount,
				geometryTypes: summary.geometryTypes,
				previewCollection: collection,
				size,
				mimeType,
			}

			set((state) => ({
				blobReferences: [...state.blobReferences, reference],
				blobPreviewCollection: collection,
				previewingBlobReferenceId: id,
				blobDraftUrl: '',
				blobDraftStatus: 'idle',
			}))
		} catch (error) {
			console.error('Failed to fetch external GeoJSON', error)
			set({
				blobDraftStatus: 'error',
				blobDraftError:
					error instanceof Error ? error.message : 'Failed to fetch external GeoJSON.',
			})
		}
	},

	previewBlobReference: async (id: string) => {
		const { blobReferences } = get()
		const reference = blobReferences.find((ref) => ref.id === id)
		if (!reference) return

		if (reference.status === 'ready' && reference.previewCollection) {
			set({
				previewingBlobReferenceId: id,
				blobPreviewCollection: reference.previewCollection,
			})
			return
		}

		set((state) => ({
			blobReferences: state.blobReferences.map((ref) =>
				ref.id === id ? { ...ref, status: 'loading', error: undefined } : ref,
			),
		}))

		try {
			const { payload, size, mimeType } = await fetchGeoJsonPayload(reference.url)
			const normalized = ensureFeatureCollection(payload)
			const collection = JSON.parse(JSON.stringify(normalized)) as FeatureCollection
			const summary = summarizeFeatureCollection(collection)
			const scopeInfo = detectBlobScope(collection)

			set((state) => ({
				blobReferences: state.blobReferences.map((ref) =>
					ref.id === id
						? {
								...ref,
								...scopeInfo,
								status: 'ready',
								featureCount: summary.featureCount,
								geometryTypes: summary.geometryTypes,
								previewCollection: collection,
								size: size ?? ref.size,
								mimeType: mimeType ?? ref.mimeType,
							}
						: ref,
				),
				blobPreviewCollection: collection,
				previewingBlobReferenceId: id,
			}))
		} catch (error) {
			console.error('Failed to preview blob reference', error)
			set((state) => ({
				blobReferences: state.blobReferences.map((ref) =>
					ref.id === id
						? {
								...ref,
								status: 'error',
								error: error instanceof Error ? error.message : 'Failed to load external GeoJSON.',
							}
						: ref,
				),
			}))
		}
	},

	removeBlobReference: (id: string) => {
		const { previewingBlobReferenceId } = get()
		set((state) => {
			const newState: Partial<EditorState> = {
				blobReferences: state.blobReferences.filter((reference) => reference.id !== id),
			}
			if (previewingBlobReferenceId === id) {
				newState.previewingBlobReferenceId = null
				newState.blobPreviewCollection = null
			}
			return newState
		})
	},

	setViewMode: (viewMode) => {
		set({ viewMode })
		// Auto-switch sidebar to combined view when entering edit mode
		if (viewMode === 'edit') {
			set({ sidebarViewMode: 'combined' })
		}
	},
	setViewDataset: (viewDataset) => set({ viewDataset }),
	setViewCollection: (viewCollection) => set({ viewCollection }),
	setViewCollectionEvents: (viewCollectionEvents) => set({ viewCollectionEvents }),

	// Focus Actions
	setFocused: (type, naddr) => set({ focusedType: type, focusedNaddr: naddr }),
	clearFocused: () => set({ focusedType: null, focusedNaddr: null }),

	// Focused map geometry actions
	setFocusedMapGeometry: (focusedMapGeometry) => set({ focusedMapGeometry }),
	clearFocusedMapGeometry: () => set({ focusedMapGeometry: null }),

	setNewCollectionProp: (newCollectionProp) => set({ newCollectionProp }),
	setNewFeatureProp: (newFeatureProp) => set({ newFeatureProp }),

	// UI Actions
	setShowTips: (showTips) =>
		set((state) => ({
			showTips: typeof showTips === 'function' ? showTips(state.showTips) : showTips,
		})),
	setShowDatasetsPanel: (show) =>
		set((state) => ({
			showDatasetsPanel: typeof show === 'function' ? show(state.showDatasetsPanel) : show,
		})),
	setShowInfoPanel: (show) =>
		set((state) => ({
			showInfoPanel: typeof show === 'function' ? show(state.showInfoPanel) : show,
		})),
	setMobileDatasetsOpen: (open) => set({ mobileDatasetsOpen: open }),
	setMobileInfoOpen: (open) => set({ mobileInfoOpen: open }),
	setMobileToolsOpen: (open) => set({ mobileToolsOpen: open }),
	setMobileSearchOpen: (open) => set({ mobileSearchOpen: open }),
	setMobileActionsOpen: (open) => set({ mobileActionsOpen: open }),
	setMobileActiveState: (state) =>
		set({
			mobileDatasetsOpen: state === 'datasets',
			mobileInfoOpen: state === 'info',
			mobileToolsOpen: state === 'tools',
			mobileSearchOpen: state === 'search',
			mobileActionsOpen: state === 'actions',
		}),
	setInspectorActive: (active) => set({ inspectorActive: active }),
	setSidebarViewMode: (mode) => set({ sidebarViewMode: mode }),

	// Search Actions
	setSearchQuery: (searchQuery) => set({ searchQuery }),
	setSearchResults: (searchResults) => set({ searchResults }),
	setSearchLoading: (searchLoading) => set({ searchLoading }),
	setSearchError: (searchError) => set({ searchError }),

	performSearch: async () => {
		const { searchQuery } = get()
		const trimmed = searchQuery.trim()
		if (!trimmed) {
			set({ searchError: 'Enter a search query', searchResults: [] })
			return
		}

		set({ searchLoading: true, searchError: null })

		try {
			const response = await earthlyGeoServer.SearchLocation(trimmed, 8)
			set({ searchResults: response.result?.results ?? [] })
		} catch (error) {
			set({
				searchError: error instanceof Error ? error.message : 'Search failed',
				searchResults: [],
			})
		} finally {
			set({ searchLoading: false })
		}
	},

	clearSearch: () => set({ searchQuery: '', searchResults: [], searchError: null }),

	// OSM Query Actions
	setOsmQueryMode: (mode) => set({ osmQueryMode: mode }),
	setOsmQueryFilter: (filter) => set({ osmQueryFilter: filter }),
	setOsmQueryPosition: (position) => set({ osmQueryPosition: position }),
	setOsmQueryResults: (results) => set({ osmQueryResults: results }),
	setOsmQueryError: (error) => set({ osmQueryError: error }),
	toggleOsmQuerySelection: (id) =>
		set((state) => {
			const newSet = new Set(state.osmQuerySelectedIds)
			if (newSet.has(id)) {
				newSet.delete(id)
			} else {
				newSet.add(id)
			}
			return { osmQuerySelectedIds: newSet }
		}),
	clearOsmQuery: () =>
		set({
			osmQueryMode: 'idle',
			osmQueryPosition: null,
			osmQueryResults: [],
			osmQueryError: null,
			osmQuerySelectedIds: new Set(),
		}),

	// Current Bbox Action
	setCurrentBbox: (bbox) => set({ currentBbox: bbox }),

	mapSource: {
		type: 'default',
		location: 'remote',
		url: 'https://build.protomaps.com/20251202.pmtiles',
	},
	showMapSettings: false,

	setMapSource: (mapSource) => set({ mapSource }),
	setShowMapSettings: (showMapSettings) => set({ showMapSettings }),

	// Map Layers State
	mapLayers: [],
	setMapLayers: (mapLayers) => set({ mapLayers }),
	updateMapLayerState: (id, updates) =>
		set((state) => ({
			mapLayers: state.mapLayers.map((layer) =>
				layer.id === id ? { ...layer, ...updates } : layer,
			),
		})),
	reorderMapLayers: (fromIndex, toIndex) =>
		set((state) => {
			const layers = [...state.mapLayers]
			const [removed] = layers.splice(fromIndex, 1)
			if (removed) layers.splice(toIndex, 0, removed)
			return { mapLayers: layers }
		}),

	updateStats: () => {
		const { features } = get()
		const stats = {
			points: features.filter((f) => f.geometry.type === 'Point').length,
			lines: features.filter((f) => f.geometry.type === 'LineString').length,
			polygons: features.filter((f) => f.geometry.type === 'Polygon').length,
			total: features.length,
		}
		set({ stats })
	},
}))

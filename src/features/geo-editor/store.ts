import type { FeatureCollection } from 'geojson'
import { create } from 'zustand'
import { earthlyGeoServer } from '../../ctxcn'
import type { NDKGeoCollectionEvent } from '../../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../../lib/ndk/NDKGeoEvent'
import type { NDKMapContextEvent } from '../../lib/ndk/NDKMapContextEvent'
import type { ContextFilterMode } from '../../lib/context/validation'
import type { EditorFeature, EditorMode, GeoEditor } from './core'
import type { CollectionMeta, EditorBlobReference, GeoSearchResult } from './types'
import type { SidebarViewMode } from './hooks/useRouting'
import {
	createDefaultCollectionMeta,
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

export interface AnnouncementSourceMeta {
	name: string | null
	about: string | null
	pubkey: string | null
	createdAt: number | null
}

export interface MapLayerState {
	id: string
	title: string
	kind: string
	enabled: boolean
	opacity: number
	// For file/pmtiles layers
	blossomServer?: string
	file?: string
	pmtilesType?: string
}

export type MobilePanelTab =
	| 'datasets'
	| 'collections'
	| 'contexts'
	| 'context-editor'
	| 'edit'
	| 'profile'
	| 'posts'
	| 'settings'
	| 'help'

export type MobilePanelSnap = 'peek' | 'expanded'

export interface GeoCollectionEditDraft {
	id: string
	sourceId: string
	name: string
	description: string
	collectionMeta: CollectionMeta
	features: EditorFeature[]
	selectedFeatureIds: string[]
	createdAt: number
	updatedAt: number
}

interface PersistedGeoCollectionDraftState {
	drafts: Record<string, GeoCollectionEditDraft>
	activeDraftId: string | null
}

const GEO_COLLECTION_DRAFTS_STORAGE_KEY = 'earthly:geo-editor:collection-drafts:v1'

const normalizeDraftCollectionMeta = (value: unknown): CollectionMeta => {
	const defaults = createDefaultCollectionMeta()
	if (!value || typeof value !== 'object') {
		return defaults
	}
	const asRecord = value as Record<string, unknown>
	return {
		name: typeof asRecord.name === 'string' ? asRecord.name : defaults.name,
		description:
			typeof asRecord.description === 'string' ? asRecord.description : defaults.description,
		color: typeof asRecord.color === 'string' ? asRecord.color : defaults.color,
		customProperties:
			asRecord.customProperties &&
			typeof asRecord.customProperties === 'object' &&
			!Array.isArray(asRecord.customProperties)
				? (asRecord.customProperties as CollectionMeta['customProperties'])
				: defaults.customProperties,
	}
}

const readPersistedGeoCollectionDraftState = (): PersistedGeoCollectionDraftState => {
	if (typeof window === 'undefined') {
		return { drafts: {}, activeDraftId: null }
	}

	try {
		const raw = window.localStorage.getItem(GEO_COLLECTION_DRAFTS_STORAGE_KEY)
		if (!raw) return { drafts: {}, activeDraftId: null }
		const parsed = JSON.parse(raw) as Partial<PersistedGeoCollectionDraftState>
		if (!parsed || typeof parsed !== 'object') {
			return { drafts: {}, activeDraftId: null }
		}
		const rawDrafts =
			parsed.drafts && typeof parsed.drafts === 'object' && !Array.isArray(parsed.drafts)
				? (parsed.drafts as Record<string, unknown>)
				: {}
		const drafts: Record<string, GeoCollectionEditDraft> = {}
		for (const [draftId, rawDraft] of Object.entries(rawDrafts)) {
			if (!rawDraft || typeof rawDraft !== 'object') continue
			const asRecord = rawDraft as Record<string, unknown>
			const createdAt = typeof asRecord.createdAt === 'number' ? asRecord.createdAt : Date.now()
			const normalized: GeoCollectionEditDraft = {
				id: typeof asRecord.id === 'string' ? asRecord.id : draftId,
				sourceId:
					typeof asRecord.sourceId === 'string' && asRecord.sourceId.trim()
						? asRecord.sourceId
						: '__unknown__',
				name: typeof asRecord.name === 'string' ? asRecord.name : '',
				description: typeof asRecord.description === 'string' ? asRecord.description : '',
				collectionMeta: normalizeDraftCollectionMeta(asRecord.collectionMeta),
				features: Array.isArray(asRecord.features) ? (asRecord.features as EditorFeature[]) : [],
				selectedFeatureIds: Array.isArray(asRecord.selectedFeatureIds)
					? asRecord.selectedFeatureIds.filter((id): id is string => typeof id === 'string')
					: [],
				createdAt,
				updatedAt: typeof asRecord.updatedAt === 'number' ? asRecord.updatedAt : createdAt,
			}
			drafts[normalized.id] = normalized
		}
		const activeDraftId = typeof parsed.activeDraftId === 'string' ? parsed.activeDraftId : null
		return { drafts, activeDraftId }
	} catch (error) {
		console.warn('Failed to read geo collection drafts from localStorage', error)
		return { drafts: {}, activeDraftId: null }
	}
}

const writePersistedGeoCollectionDraftState = (
	drafts: Record<string, GeoCollectionEditDraft>,
	activeDraftId: string | null,
) => {
	if (typeof window === 'undefined') return
	try {
		window.localStorage.setItem(
			GEO_COLLECTION_DRAFTS_STORAGE_KEY,
			JSON.stringify({ drafts, activeDraftId }),
		)
	} catch (error) {
		console.warn('Failed to persist geo collection drafts to localStorage', error)
	}
}

const createGeoDraftId = () => {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID()
	}
	return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

const persistedGeoCollectionDraftState = readPersistedGeoCollectionDraftState()

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

	// Local Draft State (persisted)
	geoEditDrafts: Record<string, GeoCollectionEditDraft>
	activeGeoEditDraftId: string | null

	// Metadata & Dataset State
	collectionMeta: CollectionMeta
	activeDataset: NDKGeoEvent | null
	activeDatasetContextRefs: string[]
	datasetVisibility: Record<string, boolean>
	resolvingDatasets: Set<string>
	resolvingProgress: Map<string, { loaded: number; total: number }>

	// Publishing State
	isPublishing: boolean
	publishMessage: string | null
	publishError: string | null

	// Blossom Upload Dialog State
	blossomUploadDialogOpen: boolean
	pendingPublishCollection: FeatureCollection | null

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
	viewContext: NDKMapContextEvent | null
	viewContextDatasets: NDKGeoEvent[]
	viewContextCollections: NDKGeoCollectionEvent[]
	contextFilterMode: ContextFilterMode

	// Focus State (for URL routing)
	focusedNaddr: string | null
	focusedType: 'geoevent' | 'collection' | 'mapcontext' | null

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
	// Unified mobile panel state (replaces individual panel states)
	mobilePanelOpen: boolean
	mobilePanelTab: MobilePanelTab
	mobilePanelSnap: MobilePanelSnap
	inspectorActive: boolean
	sidebarViewMode: SidebarViewMode

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
	createGeoEditDraft: (
		sourceId: string,
		seed?: Partial<
			Pick<
				GeoCollectionEditDraft,
				'name' | 'description' | 'collectionMeta' | 'features' | 'selectedFeatureIds'
			>
		>,
	) => string
	setActiveGeoEditDraftId: (id: string | null) => void
	saveGeoEditDraft: (
		id: string,
		updates: Partial<
			Pick<
				GeoCollectionEditDraft,
				'sourceId' | 'name' | 'description' | 'collectionMeta' | 'features' | 'selectedFeatureIds'
			>
		>,
	) => void
	loadGeoEditDraft: (id: string) => void
	deleteGeoEditDraft: (id: string) => void

	setCollectionMeta: (meta: CollectionMeta) => void
	setActiveDataset: (dataset: NDKGeoEvent | null) => void
	setActiveDatasetContextRefs: (refs: string[]) => void
	setDatasetVisibility: (
		visibility:
			| Record<string, boolean>
			| ((prev: Record<string, boolean>) => Record<string, boolean>),
	) => void
	setDatasetResolving: (datasetKey: string, resolving: boolean) => void
	setDatasetResolvingProgress: (datasetKey: string, loaded: number, total: number) => void

	setIsPublishing: (isPublishing: boolean) => void
	setPublishMessage: (message: string | null) => void
	setPublishError: (error: string | null) => void

	// Blossom Upload Dialog Actions
	setBlossomUploadDialogOpen: (open: boolean) => void
	setPendingPublishCollection: (collection: FeatureCollection | null) => void

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
	setViewContext: (context: NDKMapContextEvent | null) => void
	setViewContextDatasets: (events: NDKGeoEvent[]) => void
	setViewContextCollections: (collections: NDKGeoCollectionEvent[]) => void
	setContextFilterMode: (mode: ContextFilterMode) => void

	// Focus Actions
	setFocused: (type: 'geoevent' | 'collection' | 'mapcontext', naddr: string) => void
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
	// Unified mobile panel setters
	setMobilePanelOpen: (open: boolean) => void
	setMobilePanelTab: (tab: MobilePanelTab) => void
	setMobilePanelSnap: (snap: MobilePanelSnap) => void
	openMobilePanel: (tab?: MobilePanelTab) => void
	closeMobilePanel: () => void
	setInspectorActive: (active: boolean) => void
	setSidebarViewMode: (mode: SidebarViewMode) => void

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
	announcementSource: AnnouncementSourceMeta | null
	setAnnouncementSource: (meta: AnnouncementSourceMeta | null) => void

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
	geoEditDrafts: persistedGeoCollectionDraftState.drafts,
	activeGeoEditDraftId: persistedGeoCollectionDraftState.activeDraftId,

	collectionMeta: {
		name: '',
		description: '',
		color: '#3b82f6',
		customProperties: {},
	},
	activeDataset: null,
	activeDatasetContextRefs: [],
	datasetVisibility: {},
	resolvingDatasets: new Set<string>(),
	resolvingProgress: new Map<string, { loaded: number; total: number }>(),

	isPublishing: false,
	publishMessage: null,
	publishError: null,

	// Blossom Upload Dialog State
	blossomUploadDialogOpen: false,
	pendingPublishCollection: null,

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
	viewContext: null,
	viewContextDatasets: [],
	viewContextCollections: [],
	contextFilterMode: 'strict',

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
	mobilePanelOpen: false,
	mobilePanelTab: 'datasets',
	mobilePanelSnap: 'peek',
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
		set((state) => {
			const { activeGeoEditDraftId, geoEditDrafts } = state
			if (!activeGeoEditDraftId || !geoEditDrafts[activeGeoEditDraftId]) {
				return { features }
			}
			const updatedDraft: GeoCollectionEditDraft = {
				...geoEditDrafts[activeGeoEditDraftId],
				features,
				updatedAt: Date.now(),
			}
			const nextDrafts = {
				...geoEditDrafts,
				[activeGeoEditDraftId]: updatedDraft,
			}
			writePersistedGeoCollectionDraftState(nextDrafts, activeGeoEditDraftId)
			return {
				features,
				geoEditDrafts: nextDrafts,
			}
		})
		get().updateStats()
	},

	setMode: (mode) => {
		const { editor } = get()
		if (editor && editor.getMode() !== mode) {
			editor.setMode(mode)
		}
		set({ mode })
	},

	setSelectedFeatureIds: (selectedFeatureIds) =>
		set((state) => {
			const { activeGeoEditDraftId, geoEditDrafts } = state
			if (!activeGeoEditDraftId || !geoEditDrafts[activeGeoEditDraftId]) {
				return { selectedFeatureIds }
			}
			const updatedDraft: GeoCollectionEditDraft = {
				...geoEditDrafts[activeGeoEditDraftId],
				selectedFeatureIds,
				updatedAt: Date.now(),
			}
			const nextDrafts = {
				...geoEditDrafts,
				[activeGeoEditDraftId]: updatedDraft,
			}
			writePersistedGeoCollectionDraftState(nextDrafts, activeGeoEditDraftId)
			return {
				selectedFeatureIds,
				geoEditDrafts: nextDrafts,
			}
		}),

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

	createGeoEditDraft: (sourceId, seed) => {
		const id = createGeoDraftId()
		const now = Date.now()
		const state = get()
		const draft: GeoCollectionEditDraft = {
			id,
			sourceId,
			name: seed?.name ?? '',
			description: seed?.description ?? '',
			collectionMeta: seed?.collectionMeta ?? state.collectionMeta,
			features: seed?.features ?? state.features,
			selectedFeatureIds: seed?.selectedFeatureIds ?? state.selectedFeatureIds,
			createdAt: now,
			updatedAt: now,
		}
		const nextDrafts = {
			...state.geoEditDrafts,
			[id]: draft,
		}
		set({
			geoEditDrafts: nextDrafts,
			activeGeoEditDraftId: id,
		})
		writePersistedGeoCollectionDraftState(nextDrafts, id)
		return id
	},

	setActiveGeoEditDraftId: (id) =>
		set((state) => {
			const nextId = id && state.geoEditDrafts[id] ? id : null
			writePersistedGeoCollectionDraftState(state.geoEditDrafts, nextId)
			return { activeGeoEditDraftId: nextId }
		}),

	saveGeoEditDraft: (id, updates) =>
		set((state) => {
			const existing = state.geoEditDrafts[id]
			if (!existing) return {}
			const updatedDraft: GeoCollectionEditDraft = {
				...existing,
				sourceId: updates.sourceId ?? existing.sourceId,
				name: updates.name ?? existing.name,
				description: updates.description ?? existing.description,
				collectionMeta: updates.collectionMeta ?? existing.collectionMeta,
				features: updates.features ?? existing.features,
				selectedFeatureIds: updates.selectedFeatureIds ?? existing.selectedFeatureIds,
				updatedAt: Date.now(),
			}
			const nextDrafts = {
				...state.geoEditDrafts,
				[id]: updatedDraft,
			}
			const nextActiveId = state.activeGeoEditDraftId ?? id
			writePersistedGeoCollectionDraftState(nextDrafts, nextActiveId)
			return {
				geoEditDrafts: nextDrafts,
				activeGeoEditDraftId: nextActiveId,
			}
		}),

	loadGeoEditDraft: (id) => {
		const draft = get().geoEditDrafts[id]
		if (!draft) return
		const updatedDraft: GeoCollectionEditDraft = {
			...draft,
			updatedAt: Date.now(),
		}
		const nextDrafts = {
			...get().geoEditDrafts,
			[id]: updatedDraft,
		}
		set({
			activeGeoEditDraftId: id,
			collectionMeta: updatedDraft.collectionMeta,
			features: updatedDraft.features,
			selectedFeatureIds: updatedDraft.selectedFeatureIds,
			geoEditDrafts: nextDrafts,
		})
		writePersistedGeoCollectionDraftState(nextDrafts, id)
		get().updateStats()
	},

	deleteGeoEditDraft: (id) =>
		set((state) => {
			if (!state.geoEditDrafts[id]) return {}
			const nextDrafts = { ...state.geoEditDrafts }
			delete nextDrafts[id]

			let nextActiveId = state.activeGeoEditDraftId
			if (state.activeGeoEditDraftId === id) {
				const nextMostRecent = Object.values(nextDrafts).sort(
					(a, b) => b.updatedAt - a.updatedAt,
				)[0]
				nextActiveId = nextMostRecent?.id ?? null
			}

			writePersistedGeoCollectionDraftState(nextDrafts, nextActiveId)
			return {
				geoEditDrafts: nextDrafts,
				activeGeoEditDraftId: nextActiveId,
			}
		}),

	setCollectionMeta: (collectionMeta) =>
		set((state) => {
			const { activeGeoEditDraftId, geoEditDrafts } = state
			if (!activeGeoEditDraftId || !geoEditDrafts[activeGeoEditDraftId]) {
				return { collectionMeta }
			}
			const updatedDraft: GeoCollectionEditDraft = {
				...geoEditDrafts[activeGeoEditDraftId],
				collectionMeta,
				updatedAt: Date.now(),
			}
			const nextDrafts = {
				...geoEditDrafts,
				[activeGeoEditDraftId]: updatedDraft,
			}
			writePersistedGeoCollectionDraftState(nextDrafts, activeGeoEditDraftId)
			return {
				collectionMeta,
				geoEditDrafts: nextDrafts,
			}
		}),
	setActiveDataset: (activeDataset) => set({ activeDataset }),
	setActiveDatasetContextRefs: (activeDatasetContextRefs) => set({ activeDatasetContextRefs }),
	setDatasetVisibility: (update) =>
		set((state) => ({
			datasetVisibility: typeof update === 'function' ? update(state.datasetVisibility) : update,
		})),
	setDatasetResolving: (datasetKey, resolving) =>
		set((state) => {
			const next = new Set(state.resolvingDatasets)
			const nextProgress = new Map(state.resolvingProgress)
			if (resolving) {
				next.add(datasetKey)
			} else {
				next.delete(datasetKey)
				nextProgress.delete(datasetKey)
			}
			return { resolvingDatasets: next, resolvingProgress: nextProgress }
		}),
	setDatasetResolvingProgress: (datasetKey, loaded, total) =>
		set((state) => {
			const next = new Map(state.resolvingProgress)
			next.set(datasetKey, { loaded, total })
			return { resolvingProgress: next }
		}),

	setIsPublishing: (isPublishing) => set({ isPublishing }),
	setPublishMessage: (publishMessage) => set({ publishMessage }),
	setPublishError: (publishError) => set({ publishError }),

	// Blossom Upload Dialog Actions
	setBlossomUploadDialogOpen: (blossomUploadDialogOpen) => set({ blossomUploadDialogOpen }),
	setPendingPublishCollection: (pendingPublishCollection) => set({ pendingPublishCollection }),

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
	setViewContext: (viewContext) => set({ viewContext }),
	setViewContextDatasets: (viewContextDatasets) => set({ viewContextDatasets }),
	setViewContextCollections: (viewContextCollections) => set({ viewContextCollections }),
	setContextFilterMode: (contextFilterMode) => set({ contextFilterMode }),

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
	// Unified mobile panel setters
	setMobilePanelOpen: (open) =>
		set((state) => ({
			mobilePanelOpen: open,
			mobilePanelSnap: open ? 'peek' : state.mobilePanelSnap,
		})),
	setMobilePanelTab: (tab) => set({ mobilePanelTab: tab }),
	setMobilePanelSnap: (mobilePanelSnap) => set({ mobilePanelSnap }),
	openMobilePanel: (tab) =>
		set((state) => ({
			mobilePanelOpen: true,
			mobilePanelTab: tab ?? state.mobilePanelTab,
			mobilePanelSnap: 'peek',
		})),
	closeMobilePanel: () => set({ mobilePanelOpen: false }),
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
			const rawResults = response.result?.results ?? []
			const normalizedResults = rawResults.map((result) => {
				const bbox = Array.isArray(result.boundingbox) ? result.boundingbox : null
				const normalizedBbox =
					bbox && bbox.length === 4 && bbox.every((value) => typeof value === 'number')
						? (bbox as [number, number, number, number])
						: null
				return {
					...result,
					boundingbox: normalizedBbox,
				}
			})
			set({ searchResults: normalizedResults })
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
	announcementSource: null,
	setAnnouncementSource: (announcementSource) => set({ announcementSource }),

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

import type { StateCreator } from 'zustand'
import type { EditorCoreSlice, EditorState } from './types'

export const createEditorCoreSlice: StateCreator<EditorState, [], [], EditorCoreSlice> = (
	set,
	get,
) => ({
	editor: null,
	features: [],
	stats: { points: 0, lines: 0, polygons: 0, total: 0 },
	mode: 'select',
	selectedFeatureIds: [],
	snappingEnabled: true,
	panLocked: false,
	canFinishDrawing: false,
	history: { canUndo: false, canRedo: false },

	setEditor: (editor) => set({ editor }),

	setFeatures: (features) => {
		set((state) => {
			const { activeGeoEditDraftId, geoEditDrafts } = state
			if (!activeGeoEditDraftId || !geoEditDrafts[activeGeoEditDraftId]) {
				return { features }
			}
			const updatedDraft = {
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
			const updatedDraft = {
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

	setSnappingEnabled: (snappingEnabled) => set({ snappingEnabled }),

	setPanLocked: (panLocked) => {
		const { editor } = get()
		if (editor) {
			editor.setPanLocked(panLocked)
		}
		set({ panLocked })
	},

	setCanFinishDrawing: (canFinishDrawing) => set({ canFinishDrawing }),

	setHistoryState: (canUndo, canRedo) => set({ history: { canUndo, canRedo } }),

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
})

// Draft persistence helpers used by both editorCoreSlice and draftSlice
import type { GeoCollectionEditDraft } from './types'

const GEO_COLLECTION_DRAFTS_STORAGE_KEY = 'earthly:geo-editor:collection-drafts:v1'

export const writePersistedGeoCollectionDraftState = (
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

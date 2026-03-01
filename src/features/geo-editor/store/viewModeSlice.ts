import type { StateCreator } from 'zustand'
import type { EditorState, ViewModeSlice } from './types'

export const createViewModeSlice: StateCreator<EditorState, [], [], ViewModeSlice> = (set) => ({
	viewMode: 'view',
	viewDataset: null,
	viewCollection: null,
	viewCollectionEvents: [],
	viewContext: null,
	viewContextDatasets: [],
	viewContextCollections: [],
	contextFilterMode: 'strict',

	focusedNaddr: null,
	focusedType: null,
	focusedMapGeometry: null,

	setViewMode: (viewMode) => {
		set({ viewMode })
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

	setFocused: (type, naddr) => set({ focusedType: type, focusedNaddr: naddr }),
	clearFocused: () => set({ focusedType: null, focusedNaddr: null }),

	setFocusedMapGeometry: (focusedMapGeometry) => set({ focusedMapGeometry }),
	clearFocusedMapGeometry: () => set({ focusedMapGeometry: null }),
})

import type { FeatureCollection } from 'geojson'
import type { GeoJSONSource } from 'maplibre-gl'
import type maplibregl from 'maplibre-gl'
import { useCallback, useEffect, useState } from 'react'
import type { NDKGeoEvent } from '../../../lib/ndk/NDKGeoEvent'
import { useEditorStore } from '../store'
import { convertGeoEventsToFeatureCollection } from '../utils'

// Layer/Source IDs
const REMOTE_SOURCE_ID = 'geo-editor-remote-datasets'
const REMOTE_FILL_LAYER = 'geo-editor-remote-fill'
const REMOTE_LINE_LAYER = 'geo-editor-remote-line'
const BLOB_PREVIEW_SOURCE_ID = 'geo-editor-blob-preview'
const BLOB_PREVIEW_FILL_LAYER = 'geo-editor-blob-preview-fill'
const BLOB_PREVIEW_LINE_LAYER = 'geo-editor-blob-preview-line'

export { REMOTE_FILL_LAYER, REMOTE_LINE_LAYER }

interface UseMapLayersOptions {
	mapRef: React.MutableRefObject<maplibregl.Map | null>
	mounted: boolean
	visibleGeoEvents: NDKGeoEvent[]
	resolvedCollectionResolver: (event: NDKGeoEvent) => FeatureCollection | undefined
	resolvedCollectionsVersion: number
}

export function useMapLayers({
	mapRef,
	mounted,
	visibleGeoEvents,
	resolvedCollectionResolver,
	resolvedCollectionsVersion,
}: UseMapLayersOptions) {
	const [remoteLayersReady, setRemoteLayersReady] = useState(false)
	const editor = useEditorStore((state) => state.editor)
	const blobPreviewCollection = useEditorStore((state) => state.blobPreviewCollection)

	// Initialize extra layers when map is ready
	useEffect(() => {
		if (!mapRef.current || !mounted) return
		const mapInstance = mapRef.current

		const initLayers = () => {
			try {
				if (!mapInstance.isStyleLoaded()) return
				if (mapInstance.getSource(REMOTE_SOURCE_ID)) return
			} catch {
				return
			}

			try {
				// Remote dataset preview source/layers
				mapInstance.addSource(REMOTE_SOURCE_ID, {
					type: 'geojson',
					data: { type: 'FeatureCollection', features: [] },
				})
				mapInstance.addLayer({
					id: REMOTE_FILL_LAYER,
					type: 'fill',
					source: REMOTE_SOURCE_ID,
					filter: [
						'any',
						['==', ['geometry-type'], 'Polygon'],
						['==', ['geometry-type'], 'MultiPolygon'],
					],
					paint: {
						'fill-color': '#1d4ed8',
						'fill-opacity': 0.15,
					},
				})
				mapInstance.addLayer({
					id: REMOTE_LINE_LAYER,
					type: 'line',
					source: REMOTE_SOURCE_ID,
					paint: {
						'line-color': '#1d4ed8',
						'line-width': 2,
						'line-dasharray': [2, 2],
					},
				})

				// Blob preview source/layers
				mapInstance.addSource(BLOB_PREVIEW_SOURCE_ID, {
					type: 'geojson',
					data: { type: 'FeatureCollection', features: [] },
				})
				mapInstance.addLayer({
					id: BLOB_PREVIEW_FILL_LAYER,
					type: 'fill',
					source: BLOB_PREVIEW_SOURCE_ID,
					filter: [
						'any',
						['==', ['geometry-type'], 'Polygon'],
						['==', ['geometry-type'], 'MultiPolygon'],
					],
					paint: {
						'fill-color': '#f97316',
						'fill-opacity': 0.2,
					},
				})
				mapInstance.addLayer({
					id: BLOB_PREVIEW_LINE_LAYER,
					type: 'line',
					source: BLOB_PREVIEW_SOURCE_ID,
					paint: {
						'line-color': '#f97316',
						'line-width': 2,
					},
				})
				setRemoteLayersReady(true)
			} catch (error) {
				console.warn('Failed to initialize map layers:', error)
			}
		}

		try {
			if (mapInstance.isStyleLoaded()) {
				initLayers()
			}
		} catch {
			// Map may have been removed
		}

		mapInstance.on('styledata', initLayers)

		return () => {
			try {
				mapInstance.off('styledata', initLayers)
			} catch {
				// Map may have been removed
			}
		}
	}, [mounted, mapRef])

	// Update remote datasets layer
	useEffect(() => {
		if (!editor) return
		if (!mapRef.current) return

		try {
			if (!mapRef.current.isStyleLoaded()) return
			const source = mapRef.current.getSource(REMOTE_SOURCE_ID) as GeoJSONSource | undefined
			if (!source) return

			const collection = convertGeoEventsToFeatureCollection(
				visibleGeoEvents,
				resolvedCollectionResolver,
			)
			source.setData(collection)
		} catch {
			// Map may have been removed during source switch
		}
	}, [
		visibleGeoEvents,
		resolvedCollectionsVersion,
		resolvedCollectionResolver,
		editor,
		remoteLayersReady,
		mapRef,
	])

	// Update blob preview layer
	useEffect(() => {
		if (!mapRef.current) return

		try {
			if (!mapRef.current.isStyleLoaded()) return
			const source = mapRef.current.getSource(BLOB_PREVIEW_SOURCE_ID) as GeoJSONSource | undefined
			if (!source) return
			if (blobPreviewCollection) {
				source.setData(blobPreviewCollection)
			} else {
				source.setData({ type: 'FeatureCollection', features: [] })
			}
		} catch {
			// Map may have been removed during source switch
		}
	}, [blobPreviewCollection, mapRef])

	return {
		remoteLayersReady,
		REMOTE_SOURCE_ID,
		REMOTE_FILL_LAYER,
		REMOTE_LINE_LAYER,
		BLOB_PREVIEW_SOURCE_ID,
	}
}

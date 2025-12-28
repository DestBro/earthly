import type { FeatureCollection } from 'geojson'
import type { GeoJSONSource } from 'maplibre-gl'
import type maplibregl from 'maplibre-gl'
import { useEffect, useState } from 'react'
import type { NDKGeoEvent } from '../../../lib/ndk/NDKGeoEvent'
import { useEditorStore } from '../store'
import { convertGeoEventsToFeatureCollection } from '../utils'

// Layer/Source IDs
const REMOTE_SOURCE_ID = 'geo-editor-remote-datasets'
const REMOTE_FILL_LAYER = 'geo-editor-remote-fill'
const REMOTE_LINE_LAYER = 'geo-editor-remote-line'
const REMOTE_POINT_LAYER = 'geo-editor-remote-point'
const BLOB_PREVIEW_SOURCE_ID = 'geo-editor-blob-preview'
const BLOB_PREVIEW_FILL_LAYER = 'geo-editor-blob-preview-fill'
const BLOB_PREVIEW_LINE_LAYER = 'geo-editor-blob-preview-line'

export { REMOTE_FILL_LAYER, REMOTE_LINE_LAYER, REMOTE_POINT_LAYER }

interface UseMapLayersOptions {
	mapRef: React.MutableRefObject<maplibregl.Map | null>
	mounted: boolean
	visibleGeoEvents: NDKGeoEvent[]
	resolvedCollectionResolver: (event: NDKGeoEvent) => FeatureCollection | undefined
	/** Version counter that increments when resolved blob data changes, triggers re-render */
	resolvedCollectionsVersion: number
}

export function useMapLayers({
	mapRef,
	mounted,
	visibleGeoEvents,
	resolvedCollectionResolver,
	resolvedCollectionsVersion,
}: UseMapLayersOptions) {
	// Use version to detect when resolved data changes (resolver uses a ref internally)
	void resolvedCollectionsVersion
	const [remoteLayersReady, setRemoteLayersReady] = useState(false)
	const blobPreviewCollection = useEditorStore((state) => state.blobPreviewCollection)

	// Initialize extra layers when map is ready
	useEffect(() => {
		if (!mapRef.current || !mounted) return
		const mapInstance = mapRef.current

		const initLayers = () => {
			try {
				// Check if we can safely access the style
				const style = mapInstance.getStyle()
				if (!style) return
				if (mapInstance.getSource(REMOTE_SOURCE_ID)) {
					// Source already exists, mark as ready
					if (!remoteLayersReady) setRemoteLayersReady(true)
					return
				}
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
						'fill-color': ['coalesce', ['get', 'color'], '#1d4ed8'],
						'fill-opacity': 0.15,
					},
				})
				mapInstance.addLayer({
					id: REMOTE_LINE_LAYER,
					type: 'line',
					source: REMOTE_SOURCE_ID,
					paint: {
						'line-color': ['coalesce', ['get', 'color'], '#1d4ed8'],
						'line-width': 2,
						'line-dasharray': [2, 2],
					},
				})
				mapInstance.addLayer({
					id: REMOTE_POINT_LAYER,
					type: 'circle',
					source: REMOTE_SOURCE_ID,
					filter: [
						'any',
						['==', ['geometry-type'], 'Point'],
						['==', ['geometry-type'], 'MultiPoint'],
					],
					paint: {
						'circle-radius': 6,
						'circle-color': ['coalesce', ['get', 'color'], '#1d4ed8'],
						'circle-stroke-width': 2,
						'circle-stroke-color': '#fff',
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
				console.warn('Failed to initialize remote map layers:', error)
			}
		}

		// Try to initialize immediately
		initLayers()

		// Also try after a short delay in case style is still loading
		const timeoutId = setTimeout(initLayers, 100)

		// Listen for style events
		mapInstance.on('styledata', initLayers)
		mapInstance.on('style.load', initLayers)
		mapInstance.on('load', initLayers)
		mapInstance.on('idle', initLayers)

		return () => {
			clearTimeout(timeoutId)
			try {
				mapInstance.off('styledata', initLayers)
				mapInstance.off('style.load', initLayers)
				mapInstance.off('load', initLayers)
				mapInstance.off('idle', initLayers)
			} catch {
				// Map may have been removed
			}
		}
	}, [mounted, mapRef, remoteLayersReady])

	// Update remote datasets layer
	useEffect(() => {
		if (!mapRef.current) return
		if (!remoteLayersReady) return

		try {
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
	}, [visibleGeoEvents, resolvedCollectionResolver, remoteLayersReady, mapRef])

	// Update blob preview layer
	useEffect(() => {
		if (!mapRef.current) return
		if (!remoteLayersReady) return

		try {
			// Don't check isStyleLoaded() - remoteLayersReady guarantees layers exist
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
	}, [blobPreviewCollection, remoteLayersReady, mapRef])

	return {
		remoteLayersReady,
		REMOTE_SOURCE_ID,
		REMOTE_FILL_LAYER,
		REMOTE_LINE_LAYER,
		BLOB_PREVIEW_SOURCE_ID,
	}
}

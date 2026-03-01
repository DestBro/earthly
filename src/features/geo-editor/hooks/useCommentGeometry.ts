import { useCallback, useRef } from 'react'
import type { FeatureCollection } from 'geojson'
import type maplibregl from 'maplibre-gl'

export function useCommentGeometry(mapRef: React.RefObject<maplibregl.Map | null>) {
	const commentGeometryLayers = useRef<Map<string, { sourceId: string; layerIds: string[] }>>(
		new Map(),
	)

	const handleCommentGeometryVisibility = useCallback(
		(commentId: string, geojson: FeatureCollection | null) => {
			if (!mapRef.current) return

			const mapInstance = mapRef.current
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
					'fill-color': '#f97316',
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
					'line-dasharray': [2, 2],
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
		[mapRef],
	)

	return {
		commentGeometryLayers,
		handleCommentGeometryVisibility,
	}
}

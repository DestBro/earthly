import { useEffect } from 'react'
import type maplibregl from 'maplibre-gl'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { bboxFromGeometry } from '@/lib/geo/bbox'
import { useEditorStore } from '../store'
import type { FeaturePopupData } from '../components/FeaturePopup'
import {
	CLUSTER_CIRCLE_LAYER,
	REMOTE_ANNOTATION_ANCHOR_LAYER,
	REMOTE_ANNOTATION_LAYER,
	REMOTE_FILL_LAYER,
	REMOTE_LINE_LAYER,
	REMOTE_POINT_LAYER,
	UNCLUSTERED_POINT_LAYER,
} from './useMapLayers'

interface UseMapInteractionsParams {
	mapRef: React.RefObject<maplibregl.Map | null>
	remoteLayersReady: boolean
	CLUSTERED_SOURCE_ID: string
	geoEventsRef: React.RefObject<NDKGeoEvent[]>
	currentUserPubkey: string | undefined
	getDatasetName: (event: NDKGeoEvent) => string
	handleInspectDatasetWithoutFocus: (event: NDKGeoEvent) => void
	ensureResolvedFeatureCollection: (event: NDKGeoEvent) => Promise<GeoJSON.FeatureCollection>
	setFeaturePopupData: (data: FeaturePopupData | null) => void
}

export function useMapInteractions({
	mapRef,
	remoteLayersReady,
	CLUSTERED_SOURCE_ID,
	geoEventsRef,
	currentUserPubkey,
	getDatasetName,
	handleInspectDatasetWithoutFocus,
	ensureResolvedFeatureCollection,
	setFeaturePopupData,
}: UseMapInteractionsParams) {
	const viewMode = useEditorStore((state) => state.viewMode)
	const currentMode = useEditorStore((state) => state.mode)
	const setFocusedMapGeometry = useEditorStore((state) => state.setFocusedMapGeometry)

	useEffect(() => {
		if (!mapRef.current || !remoteLayersReady) return
		const mapInstance = mapRef.current

		const isInDrawingMode = currentMode.startsWith('draw_')

		const remoteLayers = [
			REMOTE_FILL_LAYER,
			REMOTE_LINE_LAYER,
			REMOTE_POINT_LAYER,
			REMOTE_ANNOTATION_ANCHOR_LAYER,
			REMOTE_ANNOTATION_LAYER,
			UNCLUSTERED_POINT_LAYER,
		]

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

			const isOwner = currentUserPubkey === dataset.pubkey
			const datasetName = getDatasetName(dataset)
			setFeaturePopupData({
				dataset,
				feature: feature as any,
				clickPosition: { x: event.point.x, y: event.point.y },
				isOwner,
				datasetName,
			})

			ensureResolvedFeatureCollection(dataset).catch(() => undefined)
			handleInspectDatasetWithoutFocus(dataset)
		}

		const handleMouseEnter = () => {
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
		currentUserPubkey,
		getDatasetName,
	])
}

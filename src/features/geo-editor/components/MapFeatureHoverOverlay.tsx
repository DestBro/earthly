import { useState } from 'react'
import type maplibregl from 'maplibre-gl'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { useMapInteractions } from '../hooks/useMapInteractions'
import { FeaturePopup, type FeaturePopupData } from './FeaturePopup'

interface MapFeatureHoverOverlayProps {
	mapRef: React.RefObject<maplibregl.Map | null>
	containerRef: React.RefObject<HTMLDivElement | null>
	remoteLayersReady: boolean
	clusteredSourceId: string
	geoEventsRef: React.RefObject<NDKGeoEvent[]>
	currentUserPubkey?: string
	getDatasetName: (event: NDKGeoEvent) => string
	handleInspectDatasetWithoutFocus: (event: NDKGeoEvent) => void
}

export function MapFeatureHoverOverlay({
	mapRef,
	containerRef,
	remoteLayersReady,
	clusteredSourceId,
	geoEventsRef,
	currentUserPubkey,
	getDatasetName,
	handleInspectDatasetWithoutFocus,
}: MapFeatureHoverOverlayProps) {
	const [featurePopupData, setFeaturePopupData] = useState<FeaturePopupData | null>(null)

	useMapInteractions({
		mapRef,
		remoteLayersReady,
		CLUSTERED_SOURCE_ID: clusteredSourceId,
		geoEventsRef,
		currentUserPubkey,
		getDatasetName,
		handleInspectDatasetWithoutFocus,
		setFeaturePopupData,
	})

	return <FeaturePopup data={featurePopupData} containerRef={containerRef} />
}

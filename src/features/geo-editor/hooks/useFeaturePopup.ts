import { useCallback, useState } from 'react'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import type { FeaturePopupData } from '../components/FeaturePopup'

interface UseFeaturePopupParams {
	handleZoomToBounds: (bounds: [number, number, number, number]) => void
	handleLoadDatasetForEditing: (event: NDKGeoEvent) => void
	handleInspectDataset: (event: NDKGeoEvent) => void
	clearEditorModes: () => void
}

export function useFeaturePopup({
	handleZoomToBounds,
	handleLoadDatasetForEditing,
	handleInspectDataset,
	clearEditorModes,
}: UseFeaturePopupParams) {
	const [featurePopupData, setFeaturePopupData] = useState<FeaturePopupData | null>(null)

	const handleFeaturePopupClose = useCallback(() => {
		setFeaturePopupData(null)
	}, [])

	const handleFeaturePopupZoom = useCallback(
		(feature: GeoJSON.Feature) => {
			if (!feature?.geometry) return
			import('@turf/turf')
				.then((turf) => {
					const bbox = turf.bbox(feature) as [number, number, number, number]
					if (bbox.every((v) => Number.isFinite(v))) {
						handleZoomToBounds(bbox)
					}
				})
				.catch((err) => {
					console.warn('Failed to zoom to feature:', err)
				})
		},
		[handleZoomToBounds],
	)

	const handleFeaturePopupEdit = useCallback(
		(dataset: NDKGeoEvent) => {
			handleLoadDatasetForEditing(dataset)
			setFeaturePopupData(null)
		},
		[handleLoadDatasetForEditing],
	)

	const handleFeaturePopupInspect = useCallback(
		(dataset: NDKGeoEvent) => {
			clearEditorModes()
			handleInspectDataset(dataset)
			setFeaturePopupData(null)
		},
		[handleInspectDataset, clearEditorModes],
	)

	return {
		featurePopupData,
		setFeaturePopupData,
		handleFeaturePopupClose,
		handleFeaturePopupZoom,
		handleFeaturePopupEdit,
		handleFeaturePopupInspect,
	}
}

import { useCallback } from 'react'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { useEditorStore } from '../store'

interface UseMentionActionsParams {
	geoEvents: NDKGeoEvent[]
	resolvedCollectionResolver: (event: NDKGeoEvent) => GeoJSON.FeatureCollection | null | undefined
	handleZoomToBounds: (bounds: [number, number, number, number]) => void
	zoomToDataset: (event: NDKGeoEvent) => void
	getDatasetKey: (event: NDKGeoEvent) => string
	isFocused: boolean
	navigateHome: () => void
	toggleDatasetVisibility: (event: NDKGeoEvent) => void
	toggleAllDatasetVisibility: (visible: boolean) => void
}

export function useMentionActions({
	geoEvents,
	resolvedCollectionResolver,
	handleZoomToBounds,
	zoomToDataset,
	getDatasetKey,
	isFocused,
	navigateHome,
	toggleDatasetVisibility,
	toggleAllDatasetVisibility,
}: UseMentionActionsParams) {
	const setDatasetVisibility = useEditorStore((state) => state.setDatasetVisibility)

	const resolveNaddrToDataset = useCallback(
		(address: string): NDKGeoEvent | null => {
			if (!address || !address.startsWith('naddr1')) {
				return null
			}
			try {
				const { nip19 } = require('nostr-tools')
				const decoded = nip19.decode(address)
				if (decoded.type !== 'naddr') return null

				const { kind, pubkey, identifier } = decoded.data

				return (
					geoEvents.find(
						(ev) =>
							ev.kind === kind &&
							ev.pubkey === pubkey &&
							(ev.datasetId === identifier || ev.dTag === identifier || ev.id === identifier),
					) ?? null
				)
			} catch {
				console.warn('Failed to decode naddr:', address)
				return null
			}
		},
		[geoEvents],
	)

	const handleMentionZoomTo = useCallback(
		(address: string, featureId: string | undefined) => {
			const dataset = resolveNaddrToDataset(address)
			if (!dataset) {
				console.warn('Could not find dataset for address:', address)
				return
			}

			const collection = resolvedCollectionResolver?.(dataset) ?? dataset.featureCollection

			if (featureId) {
				const feature = collection?.features.find(
					(f) =>
						f.id === featureId || String(f.id) === featureId || f.properties?.id === featureId,
				)
				if (feature?.geometry) {
					import('@turf/turf')
						.then((turf) => {
							const bbox = turf.bbox(feature) as [number, number, number, number]
							if (bbox.every((v) => Number.isFinite(v))) {
								handleZoomToBounds(bbox)
							}
						})
						.catch(() => {
							zoomToDataset(dataset)
						})
				} else {
					zoomToDataset(dataset)
				}
			} else {
				zoomToDataset(dataset)
			}
		},
		[resolveNaddrToDataset, resolvedCollectionResolver, handleZoomToBounds, zoomToDataset],
	)

	const handleMentionVisibilityToggle = useCallback(
		(address: string, _featureId: string | undefined, visible: boolean) => {
			const dataset = resolveNaddrToDataset(address)
			if (!dataset) {
				console.warn('Could not find dataset for address:', address)
				return
			}
			const key = getDatasetKey(dataset)
			setDatasetVisibility((prev) => ({
				...prev,
				[key]: visible,
			}))
		},
		[resolveNaddrToDataset, getDatasetKey, setDatasetVisibility],
	)

	const handleToggleVisibilityWithExitFocus = useCallback(
		(event: NDKGeoEvent) => {
			if (isFocused) {
				navigateHome()
			}
			toggleDatasetVisibility(event)
		},
		[isFocused, navigateHome, toggleDatasetVisibility],
	)

	const handleToggleAllVisibilityWithExitFocus = useCallback(
		(visible: boolean) => {
			if (isFocused) {
				navigateHome()
			}
			toggleAllDatasetVisibility(visible)
		},
		[isFocused, navigateHome, toggleAllDatasetVisibility],
	)

	return {
		resolveNaddrToDataset,
		handleMentionZoomTo,
		handleMentionVisibilityToggle,
		handleToggleVisibilityWithExitFocus,
		handleToggleAllVisibilityWithExitFocus,
	}
}

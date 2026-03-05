import { useEffect, useState } from 'react'
import type { Feature, Geometry } from 'geojson'
import { UserProfile } from '@/components/user-profile/UserProfile'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'

export interface FeaturePopupData {
	/** The dataset containing the hovered feature */
	dataset: NDKGeoEvent
	/** The hovered feature */
	feature: Feature<Geometry>
	/** Screen position where user hovered */
	clickPosition: { x: number; y: number }
	/** Whether the current user owns this dataset */
	isOwner: boolean
	/** Name of the dataset */
	datasetName: string
}

interface FeaturePopupProps {
	data: FeaturePopupData | null
	/** Container ref for positioning calculations */
	containerRef: React.RefObject<HTMLDivElement | null>
}

const POPUP_WIDTH = 320
const POPUP_HEIGHT_ESTIMATE = 170
const OFFSET = 12

function getDatasetDescription(dataset: NDKGeoEvent): string | null {
	const featureCollection = dataset.featureCollection as Record<string, unknown> | undefined
	if (!featureCollection) return null

	const candidates = [
		featureCollection.description,
		featureCollection.summary,
		(featureCollection.properties as Record<string, unknown> | undefined)?.description,
		(featureCollection.properties as Record<string, unknown> | undefined)?.summary,
	]

	for (const value of candidates) {
		if (typeof value === 'string' && value.trim().length > 0) {
			return value.trim()
		}
	}

	return null
}

function formatCreatedAt(createdAt?: number): string {
	if (!createdAt || !Number.isFinite(createdAt)) return 'Unknown'
	return new Date(createdAt * 1000).toLocaleString()
}

export function FeaturePopup({ data, containerRef }: FeaturePopupProps) {
	const [position, setPosition] = useState<{ x: number; y: number; anchor: 'top' | 'bottom' }>({
		x: 0,
		y: 0,
		anchor: 'bottom',
	})

	useEffect(() => {
		if (!data?.clickPosition || !containerRef.current) return

		const container = containerRef.current
		const containerRect = container.getBoundingClientRect()
		const containerWidth = containerRect.width
		const containerHeight = containerRect.height

		let x = data.clickPosition.x - POPUP_WIDTH / 2
		x = Math.max(8, Math.min(x, containerWidth - POPUP_WIDTH - 8))

		const spaceAbove = data.clickPosition.y - OFFSET
		const spaceBelow = containerHeight - data.clickPosition.y - OFFSET

		let y: number
		let anchor: 'top' | 'bottom'

		if (spaceAbove >= POPUP_HEIGHT_ESTIMATE) {
			y = data.clickPosition.y - OFFSET
			anchor = 'bottom'
		} else if (spaceBelow >= POPUP_HEIGHT_ESTIMATE) {
			y = data.clickPosition.y + OFFSET
			anchor = 'top'
		} else {
			y = data.clickPosition.y - OFFSET
			anchor = 'bottom'
		}

		setPosition({ x, y, anchor })
	}, [data?.clickPosition, containerRef])

	if (!data) return null

	const { dataset, datasetName } = data
	const description = getDatasetDescription(dataset)

	return (
		<div
			className="pointer-events-none absolute z-50 overflow-hidden rounded-xl bg-white/95 shadow-2xl backdrop-blur ring-1 ring-black/5"
			style={{
				width: POPUP_WIDTH,
				left: position.x,
				...(position.anchor === 'bottom'
					? { bottom: `calc(100% - ${position.y}px)` }
					: { top: position.y }),
			}}
		>
			<div className="border-b border-gray-100 bg-gray-50/80 px-3 py-2">
				<div className="font-semibold text-sm text-gray-900 truncate">{datasetName}</div>
				<UserProfile
					pubkey={dataset.pubkey}
					mode="avatar-name"
					size="xs"
					showNip05Badge={false}
					className="mt-0.5"
				/>
			</div>

			<div className="px-3 py-2 space-y-2">
				{description && <p className="text-xs text-gray-700 line-clamp-3">{description}</p>}
				<div className="text-[11px] text-gray-600">
					<span className="text-gray-400">Created:</span> {formatCreatedAt(dataset.created_at)}
				</div>
			</div>
		</div>
	)
}

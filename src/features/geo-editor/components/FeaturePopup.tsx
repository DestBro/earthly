import { Eye, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Feature, Geometry } from 'geojson'
import { Button } from '@/components/ui/button'
import { GeometryBadge } from '@/components/info-panel/geometry/GeometryDisplay'
import { DatasetFeaturesList } from '@/components/info-panel/DatasetFeaturesList'
import { UserProfile } from '@/components/user-profile/UserProfile'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { cn } from '@/lib/utils'

export interface FeaturePopupData {
	/** The dataset containing the clicked feature */
	dataset: NDKGeoEvent
	/** The clicked feature */
	feature: Feature<Geometry>
	/** Screen position where user clicked */
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
	/** Called when user clicks View to open full details panel */
	onInspect: (dataset: NDKGeoEvent) => void
	/** Called when user clicks Edit (owner) or Load Copy (non-owner) */
	onEdit: (dataset: NDKGeoEvent) => void
	/** Called when user clicks Zoom */
	onZoom: (feature: Feature<Geometry>) => void
	/** Called to close the popup */
	onClose: () => void
}

const POPUP_WIDTH = 320
const POPUP_HEIGHT_ESTIMATE = 300
const OFFSET = 12

/**
 * Get a display name for a feature
 */
function getFeatureName(feature: Feature<Geometry>): string {
	const props = feature.properties
	if (props?.name) return props.name
	if (props?.title) return props.title
	if (props?.featureType === 'annotation' && props?.text) {
		const text = props.text as string
		return `"${text.slice(0, 25)}${text.length > 25 ? '…' : ''}"`
	}
	// Fallback to geometry type + id fragment
	const idStr = feature.id ? String(feature.id).slice(0, 8) : ''
	return `${feature.geometry.type}${idStr ? ` • ${idStr}` : ''}`
}

/**
 * Popup that appears when clicking a feature on the map (in view mode).
 * Shows dataset details similar to the sidebar ViewModePanel.
 */
export function FeaturePopup({
	data,
	containerRef,
	onInspect,
	onEdit,
	onZoom,
	onClose,
}: FeaturePopupProps) {
	const popupRef = useRef<HTMLDivElement>(null)
	const [position, setPosition] = useState<{ x: number; y: number; anchor: 'top' | 'bottom' }>({
		x: 0,
		y: 0,
		anchor: 'bottom',
	})

	// Calculate optimal popup position based on click location and container bounds
	useEffect(() => {
		if (!data?.clickPosition || !containerRef.current) return

		const container = containerRef.current
		const containerRect = container.getBoundingClientRect()
		const containerWidth = containerRect.width
		const containerHeight = containerRect.height

		// Calculate X position (centered on click, but clamped to container)
		let x = data.clickPosition.x - POPUP_WIDTH / 2
		x = Math.max(8, Math.min(x, containerWidth - POPUP_WIDTH - 8))

		// Calculate Y position (prefer above cursor, but flip if not enough space)
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

	const { dataset, feature, isOwner, datasetName } = data
	const props = feature.properties ?? {}
	const isAnnotation = props.featureType === 'annotation'
	const featureName = getFeatureName(feature)
	const featureCount = dataset.featureCollection?.features?.length ?? 0

	return (
		<div
			ref={popupRef}
			className="pointer-events-auto absolute z-50 overflow-hidden rounded-xl bg-white/95 shadow-2xl backdrop-blur ring-1 ring-black/5 flex flex-col"
			style={{
				width: POPUP_WIDTH,
				left: position.x,
				...(position.anchor === 'bottom'
					? { bottom: `calc(100% - ${position.y}px)` }
					: { top: position.y }),
				maxHeight: 'min(450px, 55vh)',
			}}
		>
			{/* Header with dataset name */}
			<div className="flex-shrink-0 flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/80 px-3 py-2">
				<div className="flex-1 min-w-0">
					<div className="font-semibold text-sm text-gray-900 truncate">{datasetName}</div>
					<UserProfile
						pubkey={dataset.pubkey}
						mode="avatar-name"
						size="xs"
						showNip05Badge={false}
						className="mt-0.5"
					/>
				</div>
				<Button
					size="icon"
					variant="ghost"
					className="h-6 w-6 flex-shrink-0"
					aria-label="Close"
					onClick={onClose}
				>
					<X className="h-3.5 w-3.5" />
				</Button>
			</div>

			{/* Dataset metadata - same as ViewModePanel */}
			<div className="flex-shrink-0 px-3 py-2 border-b border-gray-100 space-y-1.5">
				{/* Hashtags */}
				{dataset.hashtags.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{dataset.hashtags.slice(0, 5).map((tag) => (
							<span
								key={tag}
								className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700"
							>
								#{tag}
							</span>
						))}
					</div>
				)}

				{/* Bounding box, geohash, collections */}
				<div className="text-[11px] text-gray-600 space-y-0.5">
					<div className="truncate">
						<span className="text-gray-400">Bbox:</span>{' '}
						{dataset.boundingBox ? dataset.boundingBox.map((n) => n.toFixed(4)).join(', ') : '—'}
					</div>
					<div>
						<span className="text-gray-400">Geohash:</span> {dataset.geohash ?? '—'}
					</div>
					<div>
						<span className="text-gray-400">Collections:</span>{' '}
						{dataset.collectionReferences.length}
					</div>
				</div>

				{/* Action buttons */}
				<div className="flex items-center gap-1.5 pt-1">
					<Button
						size="sm"
						className={cn(
							'h-7 text-xs flex-1',
							isOwner
								? 'bg-green-600 text-white hover:bg-green-700'
								: 'bg-blue-600 text-white hover:bg-blue-700',
						)}
						onClick={() => onEdit(dataset)}
					>
						{isOwner ? 'Edit dataset' : 'Load copy'}
					</Button>
					<Button
						size="sm"
						variant="outline"
						className="h-7 text-xs"
						onClick={() => onZoom(feature)}
					>
						Zoom
					</Button>
				</div>
			</div>

			{/* Clicked feature highlight */}
			<div className="flex-shrink-0 px-3 py-2 bg-amber-50/50 border-b border-amber-100">
				<div className="text-[10px] text-amber-700 font-medium mb-1">Clicked feature</div>
				<div className="flex items-center gap-2">
					<GeometryBadge geometry={feature.geometry} isAnnotation={isAnnotation} />
					<span className="text-xs text-gray-700 truncate flex-1">{featureName}</span>
				</div>
			</div>

			{/* Features list - same component as ViewModePanel */}
			<div className="flex-1 overflow-y-auto min-h-0 px-3 py-2">
				<div className="text-xs font-semibold text-gray-700 mb-1.5">Features ({featureCount})</div>
				<DatasetFeaturesList
					featureCollection={dataset.featureCollection}
					className="max-h-[25vh]"
				/>
			</div>

			{/* Footer with View Details */}
			<div className="flex-shrink-0 border-t border-gray-100 bg-gray-50/50 px-3 py-2">
				<Button
					size="sm"
					variant="outline"
					className="w-full h-7 text-xs"
					onClick={() => {
						onInspect(dataset)
						onClose()
					}}
				>
					<Eye className="h-3 w-3 mr-1" />
					View Details & Comments
				</Button>
			</div>
		</div>
	)
}

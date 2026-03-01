import { Eye, EyeOff, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { Button } from '../ui/button'

export interface DatasetActionCardProps {
	event: NDKGeoEvent
	datasetKey: string
	datasetName: string
	isVisible: boolean
	isOwned: boolean
	isPublishing?: boolean
	deletingKey: string | null
	onLoadDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
}

/**
 * A card component for displaying dataset actions (load, delete, toggle visibility, zoom).
 * Used in both View Mode and Edit Mode panels.
 */
export function DatasetActionCard({
	event,
	datasetKey,
	datasetName,
	isVisible,
	isOwned,
	isPublishing = false,
	deletingKey,
	onLoadDataset,
	onToggleVisibility,
	onZoomToDataset,
	onDeleteDataset,
}: DatasetActionCardProps) {
	const primaryLabel = isOwned ? 'Edit dataset' : 'Load copy'

	return (
		<div
			className={cn(
				'rounded-lg border border-gray-200 bg-white p-3 text-sm space-y-2',
				!isVisible && 'opacity-60',
			)}
		>
			<div className="font-semibold text-gray-900 truncate">{datasetName}</div>
			<div className="text-[11px] text-gray-500 truncate">
				Owner: {event.pubkey.slice(0, 8)}…{event.pubkey.slice(-4)}
			</div>
			{event.hashtags.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{event.hashtags.slice(0, 3).map((tag) => (
						<span key={tag} className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">
							#{tag}
						</span>
					))}
				</div>
			)}
			<div className="flex flex-col gap-2">
				<Button
					size="sm"
					className={cn(
						'w-full',
						isOwned
							? 'bg-green-600 text-white hover:bg-green-700'
							: 'bg-blue-600 text-white hover:bg-blue-700',
					)}
					onClick={() => onLoadDataset(event)}
					disabled={isPublishing}
				>
					{primaryLabel}
				</Button>
				{isOwned && (
					<Button
						size="sm"
						variant="destructive"
						className="w-full"
						onClick={() => onDeleteDataset(event)}
						disabled={deletingKey === datasetKey}
					>
						{deletingKey === datasetKey ? 'Deleting…' : 'Delete'}
					</Button>
				)}
				<div className="flex items-center justify-between gap-2 text-[11px]">
					<Button
						size="sm"
						variant="outline"
						className="flex-1"
						onClick={() => onToggleVisibility(event)}
					>
						{isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
						{isVisible ? 'Hide' : 'Show'}
					</Button>
					<Button
						size="sm"
						variant="outline"
						className="flex-1"
						onClick={() => onZoomToDataset(event)}
					>
						<Maximize2 className="h-3 w-3" />
						Zoom
					</Button>
				</div>
			</div>
		</div>
	)
}

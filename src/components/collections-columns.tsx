import type { ColumnDef } from '@tanstack/react-table'
import { Bug, Maximize2, Pencil, Eye } from 'lucide-react'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import { Button } from './ui/button'
import { UserProfile } from './user-profile'

export interface CollectionRowData {
	collection: NDKGeoCollectionEvent
	collectionName: string
	datasetCount: number
	referencedEvents: NDKGeoEvent[]
	zoomDisabled: boolean
	isVisible: boolean
}

export interface CollectionColumnsContext {
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onOpenDebug?: (event: NDKGeoCollectionEvent) => void
	getDatasetName: (event: NDKGeoEvent) => string
	onEditCollection?: (collection: NDKGeoCollectionEvent) => void
	onToggleVisibility?: (collection: NDKGeoCollectionEvent) => void
	onToggleAllVisibility?: (visible: boolean) => void
	currentUserPubkey?: string
	allVisibleState: 'all' | 'none' | 'some'
}

export const createCollectionColumns = (
	context: CollectionColumnsContext,
): ColumnDef<CollectionRowData>[] => [
	{
		id: 'visibility',
		header: () => {
			const isAllVisible = context.allVisibleState === 'all'
			const isIndeterminate = context.allVisibleState === 'some'
			return (
				<input
					type="checkbox"
					checked={isAllVisible}
					ref={(el) => {
						if (el) el.indeterminate = isIndeterminate
					}}
					onChange={() => context.onToggleAllVisibility?.(!isAllVisible)}
					className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
					aria-label={isAllVisible ? 'Hide all collections' : 'Show all collections'}
					title={isAllVisible ? 'Hide all collections' : 'Show all collections'}
				/>
			)
		},
		size: 32,
		cell: ({ row }) => {
			const { collection, isVisible } = row.original
			return (
				<input
					type="checkbox"
					checked={isVisible}
					onChange={() => context.onToggleVisibility?.(collection)}
					className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
					aria-label={isVisible ? 'Hide collection' : 'Show collection'}
					title={isVisible ? 'Hide collection' : 'Show collection'}
				/>
			)
		},
	},
	{
		accessorKey: 'collectionName',
		header: 'Collection',
		cell: ({ row }) => {
			const { collection, collectionName, datasetCount } = row.original
			const metadata = collection.metadata

			return (
				<div className="space-y-0.5 max-w-[180px]">
					<div className="text-xs font-semibold text-gray-900 truncate" title={collectionName}>
						{collectionName}
					</div>
					<UserProfile pubkey={collection.pubkey} mode="avatar-name" size="xs" showNip05Badge />
					<div className="text-[10px] text-gray-500">
						{datasetCount} dataset{datasetCount === 1 ? '' : 's'}
					</div>
					{metadata.tags && metadata.tags.length > 0 && (
						<div className="flex flex-wrap gap-0.5">
							{metadata.tags.slice(0, 2).map((tag) => (
								<span
									key={tag}
									className="rounded bg-purple-100 px-1 py-0.5 text-[9px] text-purple-700"
								>
									#{tag}
								</span>
							))}
						</div>
					)}
				</div>
			)
		},
	},
	{
		id: 'datasets',
		header: 'Geo Events',
		cell: ({ row }) => {
			const { referencedEvents } = row.original
			return (
				<div className="min-w-[120px]">
					{referencedEvents.length === 0 ? (
						<p className="text-[10px] text-gray-500">No datasets loaded.</p>
					) : (
						<ul className="list-disc space-y-0.5 pl-3 text-[10px] text-gray-700">
							{referencedEvents.slice(0, 3).map((event) => (
								<li key={event.id ?? event.datasetId} className="truncate max-w-[140px]">
									{context.getDatasetName(event)}
								</li>
							))}
							{referencedEvents.length > 3 && (
								<li className="text-gray-400">+{referencedEvents.length - 3} more</li>
							)}
						</ul>
					)}
				</div>
			)
		},
		size: 160,
	},
	{
		id: 'actions',
		header: '',
		cell: ({ row }) => {
			const { collection, referencedEvents, zoomDisabled } = row.original
			const isOwner = context.currentUserPubkey === collection.pubkey
			return (
				<div className="flex items-center gap-0.5">
					{isOwner && context.onEditCollection && (
						<Button
							size="icon-xs"
							variant="outline"
							onClick={() => context.onEditCollection?.(collection)}
							aria-label="Edit collection"
							title="Edit collection"
						>
							<Pencil className="h-3 w-3" />
						</Button>
					)}
					<Button
						size="icon-xs"
						variant="outline"
						disabled={zoomDisabled}
						onClick={() => context.onZoomToCollection?.(collection, referencedEvents)}
						aria-label="Zoom to collection bounds"
						title="Zoom to collection bounds"
					>
						<Maximize2 className="h-3 w-3" />
					</Button>
					<Button
						size="icon-xs"
						variant="outline"
						onClick={() => context.onInspectCollection?.(collection, referencedEvents)}
						aria-label="Inspect collection"
						title="Inspect collection"
					>
						<Eye className="h-3 w-3" />
					</Button>
					{context.onOpenDebug && (
						<Button
							size="icon-xs"
							variant="ghost"
							aria-label="Open debug dialog"
							title="Open debug dialog"
							onClick={() => context.onOpenDebug?.(collection)}
						>
							<Bug className="h-3 w-3" />
						</Button>
					)}
				</div>
			)
		},
	},
]

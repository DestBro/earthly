import type { ColumnDef } from '@tanstack/react-table'
import { Bug, Maximize2, Pencil, Eye } from 'lucide-react'
import { GeoRichTextEditor, type GeoFeatureItem } from './editor/GeoRichTextEditor'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import { Button } from './ui/button'

export interface CollectionRowData {
	collection: NDKGeoCollectionEvent
	collectionName: string
	datasetCount: number
	referencedEvents: NDKGeoEvent[]
	zoomDisabled: boolean
}

export interface CollectionColumnsContext {
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onOpenDebug?: (event: NDKGeoCollectionEvent) => void
	getDatasetName: (event: NDKGeoEvent) => string
	onEditCollection?: (collection: NDKGeoCollectionEvent) => void
	currentUserPubkey?: string
	availableFeatures?: GeoFeatureItem[]
}

export const createCollectionColumns = (
	context: CollectionColumnsContext,
): ColumnDef<CollectionRowData>[] => [
	{
		accessorKey: 'collectionName',
		header: 'Collection',
		cell: ({ row }) => {
			const { collection, collectionName, datasetCount, referencedEvents } = row.original
			const metadata = collection.metadata

			return (
				<div className="space-y-2 min-w-[200px]">
					<div className="font-semibold text-gray-900 truncate">{collectionName}</div>
					<div className="text-[11px] text-gray-500 truncate">
						Maintainer: {collection.pubkey.slice(0, 8)}…{collection.pubkey.slice(-4)}
					</div>
					{metadata.description && (
						<div className="text-xs text-gray-600">
							<GeoRichTextEditor
								initialValue={metadata.description}
								readOnly
								availableFeatures={context.availableFeatures}
								rows={1}
							/>
						</div>
					)}
					<div className="text-[11px] text-gray-500">
						{datasetCount} dataset{datasetCount === 1 ? '' : 's'} referenced
					</div>
					{metadata.tags && metadata.tags.length > 0 && (
						<div className="flex flex-wrap gap-1">
							{metadata.tags.slice(0, 3).map((tag) => (
								<span
									key={tag}
									className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700"
								>
									#{tag}
								</span>
							))}
						</div>
					)}
				</div>
			)
		},
		size: 250,
	},
	{
		id: 'datasets',
		header: 'Geo Events',
		cell: ({ row }) => {
			const { referencedEvents } = row.original
			return (
				<div className="min-w-[150px]">
					{referencedEvents.length === 0 ? (
						<p className="text-[11px] text-gray-500">No referenced datasets loaded yet.</p>
					) : (
						<ul className="list-disc space-y-1 pl-4 text-[11px] text-gray-700">
							{referencedEvents.map((event) => (
								<li key={event.id ?? event.datasetId} className="truncate max-w-[180px]">
									{context.getDatasetName(event)}
								</li>
							))}
						</ul>
					)}
				</div>
			)
		},
		size: 200,
	},
	{
		id: 'actions',
		header: 'Actions',
		cell: ({ row }) => {
			const { collection, referencedEvents, zoomDisabled } = row.original
			const isOwner = context.currentUserPubkey === collection.pubkey
			return (
				<div className="flex items-center gap-1">
					{isOwner && context.onEditCollection && (
						<Button
							size="icon-sm"
							variant="outline"
							onClick={() => context.onEditCollection?.(collection)}
							aria-label="Edit collection"
							title="Edit collection"
						>
							<Pencil className="h-4 w-4" />
						</Button>
					)}
					<Button
						size="icon-sm"
						variant="outline"
						disabled={zoomDisabled}
						onClick={() => context.onZoomToCollection?.(collection, referencedEvents)}
						aria-label="Zoom to collection bounds"
						title="Zoom to collection bounds"
					>
						<Maximize2 className="h-4 w-4" />
					</Button>
					<Button
						size="icon-sm"
						variant="outline"
						onClick={() => context.onInspectCollection?.(collection, referencedEvents)}
						aria-label="Inspect collection"
						title="Inspect collection"
					>
						<Eye className="h-4 w-4" />
					</Button>
					{context.onOpenDebug && (
						<Button
							size="icon-sm"
							variant="ghost"
							aria-label="Open debug dialog"
							title="Open debug dialog"
							onClick={() => context.onOpenDebug?.(collection)}
						>
							<Bug className="h-4 w-4" />
						</Button>
					)}
				</div>
			)
		},
	},
]

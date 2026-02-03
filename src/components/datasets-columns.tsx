import type { ColumnDef } from '@tanstack/react-table'
import { Bug, Download, Loader2, Maximize2, Pencil, Search, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import { Button } from './ui/button'
import { UserProfile } from './user-profile'
import { nip19 } from 'nostr-tools'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'

export interface DatasetRowData {
	event: NDKGeoEvent
	datasetKey: string
	datasetName: string
	isActive: boolean
	isOwned: boolean
	isVisible: boolean
	primaryLabel: string
}

export interface DatasetColumnsContext {
	onLoadDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onInspectDataset?: (event: NDKGeoEvent) => void
	onOpenDebug?: (event: NDKGeoEvent) => void
	isPublishing: boolean
	deletingKey: string | null
	allVisibleState: 'all' | 'none' | 'some'
	resolvingDatasets: Set<string>
}

export const createDatasetColumns = (
	context: DatasetColumnsContext,
): ColumnDef<DatasetRowData>[] => [
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
					onChange={() => context.onToggleAllVisibility(!isAllVisible)}
					className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
					aria-label={isAllVisible ? 'Hide all datasets' : 'Show all datasets'}
					title={isAllVisible ? 'Hide all datasets' : 'Show all datasets'}
				/>
			)
		},
		size: 32,
		cell: ({ row }) => {
			const { event, isVisible } = row.original
			return (
				<input
					type="checkbox"
					checked={isVisible}
					onChange={() => context.onToggleVisibility(event)}
					className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
					aria-label={isVisible ? 'Hide dataset' : 'Show dataset'}
					title={isVisible ? 'Hide dataset' : 'Show dataset'}
				/>
			)
		},
	},
	{
		accessorKey: 'datasetName',
		header: 'Dataset',
		cell: ({ row }) => {
			const { event, datasetName } = row.original

			const handleDragStart = (e: React.DragEvent) => {
				const datasetId = event.datasetId ?? event.dTag
				if (!datasetId || !event.pubkey || !event.kind) return

				let naddr: string
				try {
					naddr = nip19.naddrEncode({
						kind: event.kind,
						pubkey: event.pubkey,
						identifier: datasetId,
					})
				} catch {
					naddr = `${event.kind}:${event.pubkey}:${datasetId}`
				}

				const item: GeoFeatureItem = {
					id: `dataset:${event.id}`,
					name: datasetName,
					address: naddr,
					datasetName,
					geometryType: 'Dataset',
				}

				e.dataTransfer.setData('application/geo-feature', JSON.stringify(item))
				e.dataTransfer.effectAllowed = 'copy'
			}

			return (
				<div
					className="space-y-0.5 max-w-[160px] cursor-grab active:cursor-grabbing"
					draggable
					onDragStart={handleDragStart}
				>
					<div className="text-xs font-semibold text-gray-900 truncate" title={datasetName}>
						{datasetName}
					</div>
					<UserProfile pubkey={event.pubkey} mode="avatar-name" size="xs" showNip05Badge />
					{event.hashtags.length > 0 && (
						<div className="flex flex-wrap gap-0.5">
							{event.hashtags.slice(0, 2).map((tag) => (
								<span
									key={tag}
									className="rounded bg-blue-100 px-1 py-0.5 text-[9px] text-blue-700"
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
		id: 'actions',
		header: '',
		cell: ({ row }) => {
			const { event, isActive, isOwned, datasetKey } = row.original
			const isResolving = context.resolvingDatasets.has(datasetKey)
			return (
				<div className="flex items-center gap-0.5">
					<Button
						size="icon-xs"
						className={cn(
							isActive
								? 'bg-green-600 text-white hover:bg-green-700'
								: 'bg-blue-600 text-white hover:bg-blue-700',
						)}
						onClick={() => context.onLoadDataset(event)}
						disabled={context.isPublishing || isResolving}
						aria-label={isResolving ? 'Loading blob data...' : isActive ? 'Loaded in editor' : isOwned ? 'Edit dataset' : 'Load copy'}
						title={isResolving ? 'Loading blob data...' : isActive ? 'Loaded in editor' : isOwned ? 'Edit dataset' : 'Load copy'}
					>
						{isResolving ? (
							<Loader2 className="h-3 w-3 animate-spin" />
						) : isOwned ? (
							<Pencil className="h-3 w-3" />
						) : (
							<Download className="h-3 w-3" />
						)}
					</Button>
					{isOwned && (
						<Button
							size="icon-xs"
							variant="destructive"
							onClick={() => context.onDeleteDataset(event)}
							disabled={context.deletingKey === datasetKey}
							aria-label="Delete dataset"
							title={context.deletingKey === datasetKey ? 'Deleting…' : 'Delete dataset'}
						>
							<Trash2 className="h-3 w-3" />
						</Button>
					)}
					<Button
						size="icon-xs"
						variant="outline"
						onClick={() => context.onInspectDataset?.(event)}
						aria-label="Inspect dataset"
						title="Inspect dataset"
					>
						<Search className="h-3 w-3" />
					</Button>
					<Button
						size="icon-xs"
						variant="outline"
						onClick={() => context.onZoomToDataset(event)}
						aria-label="Zoom to dataset"
						title="Zoom to dataset"
					>
						<Maximize2 className="h-3 w-3" />
					</Button>
					{context.onOpenDebug && (
						<Button
							size="icon-xs"
							variant="ghost"
							aria-label="Open debug"
							title="Open debug"
							onClick={() => context.onOpenDebug?.(event)}
						>
							<Bug className="h-3 w-3" />
						</Button>
					)}
				</div>
			)
		},
	},
]

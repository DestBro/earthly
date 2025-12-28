import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEditorStore } from '../features/geo-editor/store'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import {
	BlobReferencesSection,
	DatasetMetadataSection,
	FeaturePropertiesSection,
	ViewModePanel,
} from './info-panel'
import { Button } from './ui/button'

export interface GeoEditorInfoPanelProps {
	currentUserPubkey?: string
	onLoadDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	deletingKey: string | null
	onExitViewMode?: () => void
	onClose?: () => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
}

export function GeoEditorInfoPanelContent(props: GeoEditorInfoPanelProps) {
	const {
		onLoadDataset,
		onToggleVisibility,
		onZoomToDataset,
		onDeleteDataset,
		onZoomToCollection,
		currentUserPubkey,
		deletingKey,
		onExitViewMode,
		onClose,
		getDatasetKey,
		getDatasetName,
	} = props

	// Store state
	const stats = useEditorStore((state) => state.stats)
	const features = useEditorStore((state) => state.features)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const editor = useEditorStore((state) => state.editor)
	const activeDataset = useEditorStore((state) => state.activeDataset)
	const isPublishing = useEditorStore((state) => state.isPublishing)
	const publishMessage = useEditorStore((state) => state.publishMessage)
	const publishError = useEditorStore((state) => state.publishError)
	const viewMode = useEditorStore((state) => state.viewMode)

	// Derived state
	const selectionCount = selectedFeatureIds.length
	const selectedFeatureId = selectionCount === 1 ? selectedFeatureIds[0] : null
	const selectedFeature = selectedFeatureId
		? (features.find((f) => f.id === selectedFeatureId) ?? null)
		: null
	const multiSelectModifierLabel = editor?.getMultiSelectModifierLabel() ?? 'Shift'
	const activeDatasetInfo = activeDataset
		? {
				name: getDatasetName(activeDataset),
				isOwner: currentUserPubkey === activeDataset.pubkey,
			}
		: null

	// View mode - delegate to ViewModePanel
	if (viewMode === 'view') {
		return (
			<ViewModePanel
				currentUserPubkey={currentUserPubkey}
				onLoadDataset={onLoadDataset}
				onToggleVisibility={onToggleVisibility}
				onZoomToDataset={onZoomToDataset}
				onDeleteDataset={onDeleteDataset}
				onZoomToCollection={onZoomToCollection}
				deletingKey={deletingKey}
				onExitViewMode={onExitViewMode}
				onClose={onClose}
				getDatasetKey={getDatasetKey}
				getDatasetName={getDatasetName}
			/>
		)
	}

	// Edit mode
	return (
		<div className="space-y-4 text-sm">
			{/* Header */}
			<div className="flex items-center justify-between gap-2">
				<div>
					<h2 className="text-lg font-bold text-gray-900">GeoJSON Editor</h2>
					<p className="text-xs text-gray-500">Dataset metadata & feature details</p>
				</div>
				{onClose && (
					<Button size="icon" variant="ghost" onClick={onClose} aria-label="Close properties panel">
						<X className="h-4 w-4" />
					</Button>
				)}
			</div>

			{/* Stats */}
			<div className="space-y-1">
				{[
					{ label: 'Points', value: stats.points },
					{ label: 'Lines', value: stats.lines },
					{ label: 'Polygons', value: stats.polygons },
					{ label: 'Total', value: stats.total },
				].map(({ label, value }) => (
					<div key={label} className="flex justify-between text-sm">
						<span className="text-gray-600">{label}:</span>
						<span className="font-semibold text-gray-900">{value}</span>
					</div>
				))}
			</div>

			{/* Dataset Metadata */}
			<DatasetMetadataSection />

			{/* Blob References */}
			<BlobReferencesSection />

			{/* Feature Properties (when selected) */}
			{selectedFeature && <FeaturePropertiesSection feature={selectedFeature} />}

			{/* Active Dataset Info */}
			{activeDatasetInfo && (
				<div className="text-xs text-gray-600">
					Editing dataset: <span className="font-semibold">{activeDatasetInfo.name}</span>{' '}
					{activeDatasetInfo.isOwner ? '(owned)' : '(read-only copy)'}
				</div>
			)}

			{/* Publishing Status */}
			{publishMessage && <p className="text-xs text-green-600">{publishMessage}</p>}
			{publishError && <p className="text-xs text-red-600">{publishError}</p>}

			{/* Features List */}
			<section className="rounded-lg border border-gray-200 p-3">
				<div className="text-sm font-semibold text-gray-800 mb-2">
					Geometries ({features.length})
				</div>
				{features.length === 0 ? (
					<p className="text-xs text-gray-500">Draw or load geometries to edit their metadata.</p>
				) : (
					<div className="flex flex-wrap gap-2">
						{features.map((feature) => (
							<button
								type="button"
								key={feature.id}
								onClick={() => setSelectedFeatureIds([feature.id])}
								className={cn(
									'rounded-full border px-3 py-1 text-xs',
									selectedFeatureId === feature.id
										? 'border-blue-500 bg-blue-50 text-blue-800'
										: 'border-gray-200 text-gray-700',
								)}
							>
								{feature.properties?.name ||
									`${feature.geometry.type} • ${feature.id.slice(0, 8)}…`}
							</button>
						))}
					</div>
				)}
			</section>

			{/* Selection Tips */}
			<section className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900 space-y-1">
				{selectionCount > 0 ? (
					<>
						<p className="font-semibold">
							{selectionCount} feature{selectionCount === 1 ? '' : 's'} selected
						</p>
						<p>
							Press <strong>Delete/Backspace</strong> or use the trash icon to remove them. Hold{' '}
							<strong>{multiSelectModifierLabel}</strong> while clicking or dragging with the Select
							tool to add to the selection.
						</p>
					</>
				) : (
					<>
						<p className="font-semibold">Selection tips</p>
						<ul className="list-inside list-disc space-y-1">
							<li>Use the Select tool to click a feature.</li>
							<li>
								Hold <strong>{multiSelectModifierLabel}</strong> to multi-select or drag to
								box-select.
							</li>
							<li>The active geometry is highlighted on the map.</li>
						</ul>
					</>
				)}
			</section>

			{/* Keyboard Shortcuts */}
			<section className="border-t pt-3 text-xs text-gray-600 space-y-1">
				<p className="font-semibold">Keyboard Shortcuts:</p>
				<ul className="list-inside list-disc space-y-0.5">
					<li>Cmd/Ctrl + Z: Undo</li>
					<li>Cmd/Ctrl + Shift + Z: Redo</li>
					<li>Delete/Backspace: Delete selected</li>
					<li>Enter: Finish drawing</li>
					<li>Escape: Cancel drawing</li>
				</ul>
			</section>
		</div>
	)
}

export function GeoEditorInfoPanel({
	className,
	...props
}: GeoEditorInfoPanelProps & { className?: string }) {
	return (
		<div className={cn('w-96 rounded-2xl bg-white p-4 shadow-xl', className)}>
			<GeoEditorInfoPanelContent {...props} />
		</div>
	)
}

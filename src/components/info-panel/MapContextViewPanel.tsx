import { Eye, Maximize2, Layers3 } from 'lucide-react'
import { useMemo } from 'react'
import { useEditorStore } from '../../features/geo-editor/store'
import { validateDatasetForContext, type ContextFilterMode } from '../../lib/context/validation'
import type { NDKGeoCollectionEvent } from '../../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../../lib/ndk/NDKGeoEvent'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'

interface MapContextViewPanelProps {
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onLoadDataset: (event: NDKGeoEvent) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onOpenReferenceCollection?: (collection: NDKGeoCollectionEvent) => void
}

export function MapContextViewPanel({
	getDatasetKey,
	getDatasetName,
	onLoadDataset,
	onZoomToDataset,
	onOpenReferenceCollection,
}: MapContextViewPanelProps) {
	const viewContext = useEditorStore((state) => state.viewContext)
	const viewContextDatasets = useEditorStore((state) => state.viewContextDatasets)
	const viewContextCollections = useEditorStore((state) => state.viewContextCollections)
	const contextFilterMode = useEditorStore((state) => state.contextFilterMode)
	const setContextFilterMode = useEditorStore((state) => state.setContextFilterMode)

	const validationModeForDisplay = contextFilterMode === 'off' ? 'warn' : contextFilterMode

	const validationByDatasetKey = useMemo(() => {
		const map = new Map<string, ReturnType<typeof validateDatasetForContext>>()
		if (!viewContext) return map
		viewContextDatasets.forEach((dataset) => {
			const key = getDatasetKey(dataset)
			map.set(
				key,
				validateDatasetForContext(dataset, viewContext, undefined, validationModeForDisplay),
			)
		})
		return map
	}, [viewContext, viewContextDatasets, getDatasetKey, validationModeForDisplay])

	const counters = useMemo(() => {
		let valid = 0
		let invalid = 0
		let unresolved = 0
		validationByDatasetKey.forEach((result) => {
			if (result.status === 'valid') valid += 1
			else if (result.status === 'invalid') invalid += 1
			else unresolved += 1
		})
		return { valid, invalid, unresolved }
	}, [validationByDatasetKey])

	const mapLaneDatasets = useMemo(() => {
		if (contextFilterMode !== 'strict') return viewContextDatasets
		return viewContextDatasets.filter((dataset) => {
			const key = getDatasetKey(dataset)
			return validationByDatasetKey.get(key)?.status === 'valid'
		})
	}, [contextFilterMode, viewContextDatasets, getDatasetKey, validationByDatasetKey])

	if (!viewContext) {
		return <div className="text-sm text-gray-500">No context selected.</div>
	}

	const contextContent = viewContext.context
	const allowedGeometryTypes = contextContent.geometryConstraints?.allowedTypes ?? []

	return (
		<div className="space-y-4 text-sm">
			<div className="space-y-1">
				<h2 className="text-lg font-semibold text-gray-900">
					{contextContent.name || viewContext.contextId}
				</h2>
				{contextContent.description && (
					<p className="text-xs text-gray-600">{contextContent.description}</p>
				)}
				<div className="flex flex-wrap gap-2 text-[10px]">
					<span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
						use: {contextContent.contextUse}
					</span>
					<span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700">
						validation: {contextContent.validationMode}
					</span>
					{allowedGeometryTypes.length > 0 && (
						<span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700">
							geometry: {allowedGeometryTypes.join(', ')}
						</span>
					)}
				</div>
			</div>

			<div className="space-y-2 rounded-lg border border-gray-200 p-3">
				<Label>Context filter mode</Label>
				<Select
					value={contextFilterMode}
					onValueChange={(mode) => setContextFilterMode(mode as ContextFilterMode)}
				>
					<SelectTrigger>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="off">off</SelectItem>
						<SelectItem value="warn">warn</SelectItem>
						<SelectItem value="strict">strict</SelectItem>
					</SelectContent>
				</Select>
				<p className="text-[11px] text-gray-500">
					Valid {counters.valid} · Invalid {counters.invalid} · Unresolved {counters.unresolved}
				</p>
			</div>

			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<Layers3 className="h-4 w-4 text-emerald-700" />
					<h3 className="font-medium text-gray-900">Map lane datasets</h3>
					<span className="text-xs text-gray-500">({mapLaneDatasets.length})</span>
				</div>

				{mapLaneDatasets.length === 0 ? (
					<p className="text-xs text-gray-500">No datasets in the current filter mode.</p>
				) : (
					<div className="space-y-2">
						{mapLaneDatasets.map((dataset) => {
							const key = getDatasetKey(dataset)
							const result = validationByDatasetKey.get(key)
							const status = result?.status ?? 'unresolved'
							const statusClass =
								status === 'valid'
									? 'bg-emerald-100 text-emerald-700'
									: status === 'invalid'
										? 'bg-red-100 text-red-700'
										: 'bg-gray-100 text-gray-700'
							return (
								<div
									key={key}
									className="rounded border border-gray-200 p-2 flex items-center justify-between gap-2"
								>
									<div className="min-w-0">
										<p className="truncate text-xs font-medium text-gray-900">
											{getDatasetName(dataset)}
										</p>
										<div className="flex items-center gap-2">
											<span className={`rounded px-1.5 py-0.5 text-[10px] ${statusClass}`}>
												{status}
											</span>
											{result && result.featureErrorCount > 0 && (
												<span className="text-[10px] text-red-600">
													{result.featureErrorCount} invalid feature(s)
												</span>
											)}
										</div>
									</div>
									<div className="flex items-center gap-1 shrink-0">
										<Button size="icon-sm" variant="outline" onClick={() => onLoadDataset(dataset)}>
											<Eye className="h-3 w-3" />
										</Button>
										<Button
											size="icon-sm"
											variant="outline"
											onClick={() => onZoomToDataset(dataset)}
										>
											<Maximize2 className="h-3 w-3" />
										</Button>
									</div>
								</div>
							)
						})}
					</div>
				)}
			</div>

			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<h3 className="font-medium text-gray-900">Reference lane</h3>
					<span className="text-xs text-gray-500">({viewContextCollections.length})</span>
				</div>
				{viewContextCollections.length === 0 ? (
					<p className="text-xs text-gray-500">No attached references.</p>
				) : (
					<div className="space-y-2">
						{viewContextCollections.map((collection) => (
							<div
								key={collection.id ?? collection.collectionId}
								className="rounded border border-gray-200 p-2 flex items-center justify-between gap-2"
							>
								<div className="min-w-0">
									<p className="truncate text-xs font-medium text-gray-900">
										{collection.metadata.name ?? collection.collectionId}
									</p>
									<p className="text-[10px] text-gray-500">
										{collection.datasetReferences.length} dataset reference(s)
									</p>
								</div>
								<Button
									size="sm"
									variant="outline"
									onClick={() => onOpenReferenceCollection?.(collection)}
								>
									Open isolation
								</Button>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	)
}

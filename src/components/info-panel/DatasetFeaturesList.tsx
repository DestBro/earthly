import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from 'geojson'
import { cn } from '@/lib/utils'
import { GeometryBadge, GeometryDisplay } from './geometry/GeometryDisplay'

interface ReadOnlyFeatureRowProps {
	feature: Feature<Geometry, GeoJsonProperties>
	name: string
	isExpanded: boolean
	onToggleExpand: () => void
}

function ReadOnlyFeatureRow({
	feature,
	name,
	isExpanded,
	onToggleExpand,
}: ReadOnlyFeatureRowProps) {
	const isAnnotation = feature.properties?.featureType === 'annotation'

	return (
		<div className="rounded border border-gray-200 bg-white text-xs">
			{/* Row header */}
			<div className="flex items-center gap-1 px-1.5 py-1">
				<button
					type="button"
					onClick={onToggleExpand}
					className="text-gray-400 hover:text-gray-600"
				>
					{isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
				</button>

				<GeometryBadge geometry={feature.geometry} isAnnotation={isAnnotation} />

				<span className="flex-1 text-left truncate text-gray-700">{name}</span>
			</div>

			{/* Expanded content */}
			{isExpanded && (
				<div className="border-t border-gray-100 px-2 py-2 bg-gray-50/50 space-y-2">
					{/* Annotation text */}
					{isAnnotation && feature.properties?.text && (
						<div className="text-xs text-gray-600 italic">
							"{feature.properties.text}"
						</div>
					)}

					{/* Name if different from display */}
					{feature.properties?.name && (
						<div className="text-[11px] text-gray-600">
							<span className="text-gray-400">Name:</span> {feature.properties.name}
						</div>
					)}

					{/* Description */}
					{feature.properties?.description && (
						<div className="text-[11px] text-gray-600">
							<span className="text-gray-400">Description:</span> {feature.properties.description}
						</div>
					)}

					{/* Geometry coordinates */}
					<GeometryDisplay geometry={feature.geometry} />
				</div>
			)}
		</div>
	)
}

interface DatasetFeaturesListProps {
	featureCollection: FeatureCollection | null | undefined
	className?: string
}

/**
 * Read-only list of features from a dataset's feature collection.
 * Used in view mode to display the contents of a dataset.
 */
export function DatasetFeaturesList({ featureCollection, className }: DatasetFeaturesListProps) {
	const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

	const toggleExpand = (index: number) => {
		setExpandedIds((prev) => {
			const next = new Set(prev)
			if (next.has(index)) {
				next.delete(index)
			} else {
				next.add(index)
			}
			return next
		})
	}

	if (!featureCollection?.features?.length) {
		return (
			<div className={cn('text-xs text-gray-500 py-2', className)}>
				No features in this dataset.
			</div>
		)
	}

	const features = featureCollection.features

	return (
		<div className={cn('space-y-1', className)}>
			{features.map((feature, index) => {
				const isAnnotation = feature.properties?.featureType === 'annotation'
				let name = feature.properties?.name as string | undefined
				if (!name) {
					if (isAnnotation) {
						const text = feature.properties?.text as string | undefined
						name = text ? `"${text.slice(0, 20)}${text.length > 20 ? '…' : ''}"` : 'Annotation'
					} else {
						const id = feature.id ?? index
						name = `${feature.geometry?.type ?? 'Unknown'} • ${String(id).slice(0, 6)}`
					}
				}

				return (
					<ReadOnlyFeatureRow
						key={feature.id ?? index}
						feature={feature}
						name={name}
						isExpanded={expandedIds.has(index)}
						onToggleExpand={() => toggleExpand(index)}
					/>
				)
			})}
		</div>
	)
}

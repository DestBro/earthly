import { ChevronDown, ChevronRight, Cloud } from 'lucide-react'
import { useState } from 'react'
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from 'geojson'
import { cn } from '@/lib/utils'
import { GeometryBadge, GeometryDisplay } from './geometry/GeometryDisplay'

interface ReadOnlyFeatureRowProps {
	feature: Feature<Geometry | null, GeoJsonProperties>
	name: string
	isExpanded: boolean
	onToggleExpand: () => void
	isExternal?: boolean
}

function ReadOnlyFeatureRow({
	feature,
	name,
	isExpanded,
	onToggleExpand,
	isExternal,
}: ReadOnlyFeatureRowProps) {
	const isAnnotation = feature.properties?.featureType === 'annotation'
	const isExternalPlaceholder = feature.properties?.externalPlaceholder === true
	const hasGeometry = feature.geometry !== null

	return (
		<div
			className={cn(
				'rounded border text-xs',
				isExternalPlaceholder ? 'border-sky-200 bg-sky-50/50' : 'border-gray-200 bg-white',
			)}
		>
			{/* Row header */}
			<div className="flex items-center gap-1 px-1.5 py-1">
				<button
					type="button"
					onClick={onToggleExpand}
					className="text-gray-400 hover:text-gray-600"
					disabled={!hasGeometry}
				>
					{hasGeometry ? (
						isExpanded ? (
							<ChevronDown className="h-3 w-3" />
						) : (
							<ChevronRight className="h-3 w-3" />
						)
					) : (
						<Cloud className="h-3 w-3 text-sky-400" />
					)}
				</button>

				<GeometryBadge
					geometry={feature.geometry}
					isAnnotation={isAnnotation}
					isExternal={isExternal || isExternalPlaceholder}
				/>

				<span className="flex-1 text-left truncate text-gray-700">{name}</span>
			</div>

			{/* External placeholder info */}
			{isExternalPlaceholder && !hasGeometry && (
				<div className="border-t border-sky-100 px-2 py-1.5 text-[11px] text-sky-600">
					<span className="flex items-center gap-1">
						<Cloud className="h-3 w-3" />
						Geometry stored externally
					</span>
					{feature.properties?.blobUrl && (
						<span className="block truncate text-[10px] text-sky-500 mt-0.5">
							{feature.properties.blobUrl}
						</span>
					)}
				</div>
			)}

			{/* Expanded content */}
			{isExpanded && hasGeometry && (
				<div className="border-t border-gray-100 px-2 py-2 bg-gray-50/50 space-y-2">
					{/* Annotation text */}
					{isAnnotation && feature.properties?.text && (
						<div className="text-xs text-gray-600 italic">"{feature.properties.text}"</div>
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
					{feature.geometry && <GeometryDisplay geometry={feature.geometry} />}
				</div>
			)}
		</div>
	)
}

interface DatasetFeaturesListProps {
	featureCollection: FeatureCollection | null | undefined
	hiddenFeatureIds?: Set<string>
	className?: string
}

/**
 * Read-only list of features from a dataset's feature collection.
 * Used in view mode to display the contents of a dataset.
 */
export function DatasetFeaturesList({
	featureCollection,
	hiddenFeatureIds,
	className,
}: DatasetFeaturesListProps) {
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

	const features = hiddenFeatureIds
		? featureCollection.features.filter((feature, index) => {
				const featureId =
					typeof feature.id === 'string' || typeof feature.id === 'number'
						? String(feature.id)
						: String(index)
				return !hiddenFeatureIds.has(featureId)
			})
		: featureCollection.features

	return (
		<div className={cn('space-y-1', className)}>
			{features.map((feature, index) => {
				const isAnnotation = feature.properties?.featureType === 'annotation'
				const isExternalPlaceholder = feature.properties?.externalPlaceholder === true

				let name = feature.properties?.name as string | undefined
				if (!name) {
					if (isExternalPlaceholder) {
						name = 'External geometry'
					} else if (isAnnotation) {
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
						feature={feature as Feature<Geometry | null, GeoJsonProperties>}
						name={name}
						isExpanded={expandedIds.has(index)}
						onToggleExpand={() => toggleExpand(index)}
						isExternal={isExternalPlaceholder}
					/>
				)
			})}
		</div>
	)
}

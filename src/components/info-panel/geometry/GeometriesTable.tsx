import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { EditorFeature } from '../../../features/geo-editor/core'
import { useEditorStore } from '../../../features/geo-editor/store'
import { cn } from '@/lib/utils'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { GeometryBadge, GeometryDisplay } from './GeometryDisplay'

interface FeatureRowProps {
	feature: EditorFeature
	name: string
	isSelected: boolean
	isExpanded: boolean
	onToggleExpand: () => void
	onSelect: () => void
	onDelete: () => void
}

function FeatureRow({
	feature,
	name,
	isSelected,
	isExpanded,
	onToggleExpand,
	onSelect,
	onDelete,
}: FeatureRowProps) {
	const editor = useEditorStore((state) => state.editor)

	// Local state for new property - each row has its own
	const [newPropKey, setNewPropKey] = useState('')
	const [newPropValue, setNewPropValue] = useState('')

	const onFieldChange = (field: 'name' | 'description' | 'color', value: string) => {
		if (!editor) return
		editor.updateFeature(feature.id, {
			...feature,
			properties: { ...feature.properties, [field]: value },
		})
	}

	const onCustomPropertyChange = (key: string, value: string) => {
		if (!editor) return
		const currentProps = feature.properties?.customProperties || {}
		editor.updateFeature(feature.id, {
			...feature,
			properties: {
				...feature.properties,
				customProperties: { ...currentProps, [key]: value },
			},
		})
	}

	const onRemoveCustomProperty = (key: string) => {
		if (!editor) return
		const currentProps = { ...(feature.properties?.customProperties || {}) }
		delete currentProps[key]
		editor.updateFeature(feature.id, {
			...feature,
			properties: {
				...feature.properties,
				customProperties: currentProps,
			},
		})
	}

	const onAddCustomProperty = () => {
		if (!editor || !newPropKey) return
		const currentProps = feature.properties?.customProperties || {}
		editor.updateFeature(feature.id, {
			...feature,
			properties: {
				...feature.properties,
				customProperties: {
					...currentProps,
					[newPropKey]: newPropValue,
				},
			},
		})
		setNewPropKey('')
		setNewPropValue('')
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && newPropKey) {
			onAddCustomProperty()
		}
	}

	const customProperties = feature.properties?.customProperties ?? {}

	return (
		<div
			className={cn(
				'rounded border text-xs',
				isSelected ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50',
			)}
		>
			{/* Row header */}
			<div className="flex items-center gap-1 px-1.5 py-1">
				<button
					type="button"
					onClick={onToggleExpand}
					className="text-gray-400 hover:text-gray-600"
				>
					{isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
				</button>

				<GeometryBadge geometry={feature.geometry} />

				<button
					type="button"
					onClick={onSelect}
					className="flex-1 text-left truncate text-gray-700 hover:text-gray-900"
				>
					{name}
				</button>

				<Button
					size="icon-xs"
					variant="ghost"
					className="text-red-500 hover:text-red-700"
					onClick={onDelete}
					aria-label="Delete feature"
				>
					<Trash2 className="h-3 w-3" />
				</Button>
			</div>

			{/* Expanded content */}
			{isExpanded && (
				<div className="border-t border-gray-100 px-2 py-2 bg-gray-50/50 space-y-2">
					{/* Name + Color inline */}
					<div className="flex items-center gap-1">
						<Input
							className="h-6 text-xs flex-1"
							placeholder="Name"
							value={(feature.properties?.name as string) ?? ''}
							onChange={(e) => onFieldChange('name', e.target.value)}
						/>
						<Input
							type="color"
							className="h-6 w-8 p-0.5 rounded border border-gray-200"
							value={(feature.properties?.color as string) ?? '#16a34a'}
							onChange={(e) => onFieldChange('color', e.target.value)}
						/>
					</div>

					{/* Description */}
					<textarea
						className="w-full h-8 rounded border border-gray-200 px-1.5 py-1 text-[11px] resize-none"
						placeholder="Description"
						value={(feature.properties?.description as string) ?? ''}
						onChange={(e) => onFieldChange('description', e.target.value)}
					/>

					{/* Custom properties - compact */}
					{Object.keys(customProperties).length > 0 && (
						<div className="space-y-0.5">
							{Object.entries(customProperties).map(([key, value]) => (
								<div key={key} className="flex items-center gap-1">
									<span className="text-[10px] text-gray-500 min-w-[32px] truncate">{key}</span>
									<Input
										className="h-5 text-[11px] flex-1"
										value={String(value)}
										onChange={(e) => onCustomPropertyChange(key, e.target.value)}
									/>
									<Button
										size="icon-xs"
										variant="ghost"
										className="text-red-400 hover:text-red-600"
										onClick={() => onRemoveCustomProperty(key)}
									>
										<Trash2 className="h-2.5 w-2.5" />
									</Button>
								</div>
							))}
						</div>
					)}

					{/* Add new property */}
					<div className="flex items-center gap-1">
						<Input
							className="h-5 text-[11px] flex-1"
							placeholder="key"
							value={newPropKey}
							onChange={(e) => setNewPropKey(e.target.value)}
							onKeyDown={handleKeyDown}
						/>
						<Input
							className="h-5 text-[11px] flex-1"
							placeholder="value"
							value={newPropValue}
							onChange={(e) => setNewPropValue(e.target.value)}
							onKeyDown={handleKeyDown}
						/>
						<Button
							size="icon-xs"
							variant="ghost"
							onClick={onAddCustomProperty}
							disabled={!newPropKey}
						>
							<Plus className="h-2.5 w-2.5" />
						</Button>
					</div>

					{/* Geometry coordinates */}
					<GeometryDisplay geometry={feature.geometry} />
				</div>
			)}
		</div>
	)
}

interface GeometriesTableProps {
	className?: string
}

export function GeometriesTable({ className }: GeometriesTableProps) {
	const features = useEditorStore((state) => state.features)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const editor = useEditorStore((state) => state.editor)

	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

	const toggleExpand = (id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) {
				next.delete(id)
			} else {
				next.add(id)
			}
			return next
		})
	}

	const handleSelect = (featureId: string) => {
		setSelectedFeatureIds([featureId])
	}

	const handleDelete = (featureId: string) => {
		if (!editor) return
		editor.deleteFeatures([featureId])
	}

	const rows = useMemo(
		() =>
			features.map((feature) => ({
				feature,
				name:
					(feature.properties?.name as string) ||
					`${feature.geometry.type} • ${feature.id.slice(0, 6)}`,
				isSelected: selectedFeatureIds.includes(feature.id),
			})),
		[features, selectedFeatureIds],
	)

	if (features.length === 0) {
		return (
			<div className={cn('text-xs text-gray-500 py-2', className)}>
				Draw or load geometries to edit.
			</div>
		)
	}

	return (
		<div className={cn('space-y-1', className)}>
			{rows.map((row) => (
				<FeatureRow
					key={row.feature.id}
					feature={row.feature}
					name={row.name}
					isSelected={row.isSelected}
					isExpanded={expandedIds.has(row.feature.id)}
					onToggleExpand={() => toggleExpand(row.feature.id)}
					onSelect={() => handleSelect(row.feature.id)}
					onDelete={() => handleDelete(row.feature.id)}
				/>
			))}
		</div>
	)
}

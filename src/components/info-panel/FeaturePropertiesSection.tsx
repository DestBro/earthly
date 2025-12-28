import { Plus, Trash2 } from 'lucide-react'
import type { EditorFeature } from '../../features/geo-editor/core'
import { useEditorStore } from '../../features/geo-editor/store'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

export interface FeaturePropertiesSectionProps {
	feature: EditorFeature
}

/**
 * Compact section for editing properties of a selected feature.
 */
export function FeaturePropertiesSection({ feature }: FeaturePropertiesSectionProps) {
	const editor = useEditorStore((state) => state.editor)
	const newFeatureProp = useEditorStore((state) => state.newFeatureProp)
	const setNewFeatureProp = useEditorStore((state) => state.setNewFeatureProp)

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
		if (!editor || !newFeatureProp.key) return
		const currentProps = feature.properties?.customProperties || {}
		editor.updateFeature(feature.id, {
			...feature,
			properties: {
				...feature.properties,
				customProperties: {
					...currentProps,
					[newFeatureProp.key]: newFeatureProp.value,
				},
			},
		})
		setNewFeatureProp({ key: '', value: '' })
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && newFeatureProp.key) {
			onAddCustomProperty()
		}
	}

	const customProperties = feature.properties?.customProperties ?? {}

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-gray-700">Feature</span>
				<span className="text-[10px] text-gray-400 font-mono">{feature.id.slice(0, 10)}…</span>
			</div>

			{/* Name + Color inline */}
			<div className="flex items-center gap-2">
				<Input
					className="h-7 text-xs flex-1"
					placeholder="Name"
					value={(feature.properties?.name as string) ?? ''}
					onChange={(e) => onFieldChange('name', e.target.value)}
				/>
				<Input
					type="color"
					className="h-7 w-10 p-0.5 rounded border border-gray-200"
					value={(feature.properties?.color as string) ?? '#16a34a'}
					onChange={(e) => onFieldChange('color', e.target.value)}
				/>
			</div>

			{/* Description */}
			<textarea
				className="w-full h-10 rounded border border-gray-200 px-2 py-1 text-xs resize-none"
				placeholder="Description"
				value={(feature.properties?.description as string) ?? ''}
				onChange={(e) => onFieldChange('description', e.target.value)}
			/>

			{/* Custom properties - compact */}
			<div className="space-y-1">
				<div className="text-[10px] text-gray-500 uppercase tracking-wide">Properties</div>
				{Object.entries(customProperties).map(([key, value]) => (
					<div key={key} className="flex items-center gap-1">
						<span className="text-[10px] text-gray-600 min-w-[40px] truncate">{key}</span>
						<Input
							className="h-6 text-xs flex-1"
							value={String(value)}
							onChange={(e) => onCustomPropertyChange(key, e.target.value)}
						/>
						<Button
							size="icon-xs"
							variant="ghost"
							className="text-red-500"
							onClick={() => onRemoveCustomProperty(key)}
						>
							<Trash2 className="h-3 w-3" />
						</Button>
					</div>
				))}

				{/* Add new */}
				<div className="flex items-center gap-1">
					<Input
						className="h-6 text-xs flex-1"
						placeholder="key"
						value={newFeatureProp.key}
						onChange={(e) => setNewFeatureProp({ ...newFeatureProp, key: e.target.value })}
						onKeyDown={handleKeyDown}
					/>
					<Input
						className="h-6 text-xs flex-1"
						placeholder="value"
						value={newFeatureProp.value}
						onChange={(e) => setNewFeatureProp({ ...newFeatureProp, value: e.target.value })}
						onKeyDown={handleKeyDown}
					/>
					<Button
						size="icon-xs"
						variant="outline"
						onClick={onAddCustomProperty}
						disabled={!newFeatureProp.key}
					>
						<Plus className="h-3 w-3" />
					</Button>
				</div>
			</div>
		</div>
	)
}

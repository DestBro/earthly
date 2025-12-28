import type { EditorFeature } from '../../features/geo-editor/core'
import { useEditorStore } from '../../features/geo-editor/store'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

export interface FeaturePropertiesSectionProps {
	feature: EditorFeature
}

/**
 * Section for editing properties of a selected feature.
 * Displays name, description, color, and custom properties.
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
		const currentProps = {
			...(feature.properties?.customProperties || {}),
		}
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

	const customProperties = feature.properties?.customProperties ?? {}

	return (
		<section className="rounded-lg border border-gray-200 p-3 space-y-3">
			<div className="text-sm font-semibold text-gray-800">Feature properties</div>
			<p className="text-[11px] text-gray-500 break-all">ID: {feature.id}</p>

			<label className="block text-xs text-gray-600">
				Name
				<Input
					className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
					value={(feature.properties?.name as string) ?? ''}
					onChange={(e) => onFieldChange('name', e.target.value)}
				/>
			</label>

			<label className="block text-xs text-gray-600">
				Description
				<textarea
					className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
					rows={2}
					value={(feature.properties?.description as string) ?? ''}
					onChange={(e) => onFieldChange('description', e.target.value)}
				/>
			</label>

			<label className="block text-xs text-gray-600">
				Color
				<Input
					type="color"
					className="mt-1 h-8 w-16 rounded border border-gray-200"
					value={(feature.properties?.color as string) ?? '#16a34a'}
					onChange={(e) => onFieldChange('color', e.target.value)}
				/>
			</label>

			{/* Custom properties */}
			<div className="space-y-2">
				<div className="text-xs font-semibold text-gray-600">Custom properties</div>
				{Object.entries(customProperties).length === 0 ? (
					<p className="text-[11px] text-gray-500">No custom properties</p>
				) : (
					Object.entries(customProperties).map(([key, value]) => (
						<div key={key} className="flex items-center gap-2 text-xs">
							<span className="min-w-[60px] font-medium text-gray-700">{key}</span>
							<Input
								className="flex-1 rounded border border-gray-200 px-2 py-1"
								value={String(value)}
								onChange={(e) => onCustomPropertyChange(key, e.target.value)}
							/>
							<Button size="sm" variant="destructive" onClick={() => onRemoveCustomProperty(key)}>
								✕
							</Button>
						</div>
					))
				)}

				{/* Add new custom property */}
				<div className="flex items-center gap-2">
					<Input
						className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
						placeholder="key"
						value={newFeatureProp.key}
						onChange={(e) => setNewFeatureProp({ ...newFeatureProp, key: e.target.value })}
					/>
					<Input
						className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
						placeholder="value"
						value={newFeatureProp.value}
						onChange={(e) => setNewFeatureProp({ ...newFeatureProp, value: e.target.value })}
					/>
					<Button size="sm" onClick={onAddCustomProperty}>
						Add
					</Button>
				</div>
			</div>
		</section>
	)
}

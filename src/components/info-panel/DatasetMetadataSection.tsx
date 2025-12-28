import { useEditorStore } from '../../features/geo-editor/store'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

/**
 * Section for editing dataset/collection metadata.
 * Displays name, description, color, and custom properties.
 */
export function DatasetMetadataSection() {
	const collectionMeta = useEditorStore((state) => state.collectionMeta)
	const setCollectionMeta = useEditorStore((state) => state.setCollectionMeta)
	const newCollectionProp = useEditorStore((state) => state.newCollectionProp)
	const setNewCollectionProp = useEditorStore((state) => state.setNewCollectionProp)

	const onNameChange = (value: string) => {
		setCollectionMeta({ ...collectionMeta, name: value })
	}

	const onDescriptionChange = (value: string) => {
		setCollectionMeta({ ...collectionMeta, description: value })
	}

	const onColorChange = (value: string) => {
		setCollectionMeta({ ...collectionMeta, color: value })
	}

	const onCustomPropertyChange = (key: string, value: string) => {
		setCollectionMeta({
			...collectionMeta,
			customProperties: { ...collectionMeta.customProperties, [key]: value },
		})
	}

	const onCustomPropertyRemove = (key: string) => {
		const next = { ...collectionMeta.customProperties }
		delete next[key]
		setCollectionMeta({ ...collectionMeta, customProperties: next })
	}

	const onAddCustomProperty = () => {
		if (!newCollectionProp.key) return
		setCollectionMeta({
			...collectionMeta,
			customProperties: {
				...collectionMeta.customProperties,
				[newCollectionProp.key]: newCollectionProp.value,
			},
		})
		setNewCollectionProp({ key: '', value: '' })
	}

	return (
		<section className="rounded-lg border border-gray-200 p-3 space-y-3">
			<h4 className="text-sm font-semibold text-gray-800">Dataset metadata</h4>

			<label className="block text-xs text-gray-600">
				Name
				<Input
					className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
					placeholder="Dataset name"
					value={collectionMeta.name}
					onChange={(e) => onNameChange(e.target.value)}
				/>
			</label>

			<label className="block text-xs text-gray-600">
				Description
				<textarea
					className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
					rows={2}
					placeholder="Describe this dataset"
					value={collectionMeta.description}
					onChange={(e) => onDescriptionChange(e.target.value)}
				/>
			</label>

			<label className="block text-xs text-gray-600">
				Accent color
				<Input
					type="color"
					className="mt-1 h-8 w-16 rounded border border-gray-200"
					value={collectionMeta.color}
					onChange={(e) => onColorChange(e.target.value)}
				/>
			</label>

			{/* Custom properties */}
			<div className="space-y-2">
				<div className="text-xs font-semibold text-gray-600">Custom properties</div>
				{Object.keys(collectionMeta.customProperties).length === 0 ? (
					<p className="text-[11px] text-gray-500">No custom properties</p>
				) : (
					Object.entries(collectionMeta.customProperties).map(([key, value]) => (
						<div key={key} className="flex items-center gap-2 text-xs">
							<span className="min-w-[60px] font-medium text-gray-700">{key}</span>
							<Input
								className="flex-1 rounded border border-gray-200 px-2 py-1"
								value={String(value)}
								onChange={(e) => onCustomPropertyChange(key, e.target.value)}
							/>
							<Button size="sm" variant="destructive" onClick={() => onCustomPropertyRemove(key)}>
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
						value={newCollectionProp.key}
						onChange={(e) => setNewCollectionProp({ ...newCollectionProp, key: e.target.value })}
					/>
					<Input
						className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
						placeholder="value"
						value={newCollectionProp.value}
						onChange={(e) => setNewCollectionProp({ ...newCollectionProp, value: e.target.value })}
					/>
					<Button size="sm" onClick={onAddCustomProperty}>
						Add
					</Button>
				</div>
			</div>
		</section>
	)
}

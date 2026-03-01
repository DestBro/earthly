import { useNDK, useNDKCurrentUser } from '@nostr-dev-kit/react'
import { useMemo, useState } from 'react'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { NDKMapContextEvent, type MapContextContent } from '../lib/ndk/NDKMapContextEvent'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Textarea } from './ui/textarea'

type SchemaFieldType = 'string' | 'number' | 'integer' | 'boolean'

interface SchemaBuilderField {
	id: string
	key: string
	type: SchemaFieldType
	required: boolean
	min?: number
	max?: number
	minLength?: number
	maxLength?: number
}

interface MapContextEditorPanelProps {
	initialContext?: NDKMapContextEvent | null
	onClose: () => void
	onSave: (context: NDKMapContextEvent) => void
}

const ajv = new Ajv2020({
	allErrors: true,
	strict: false,
	validateSchema: true,
})
addFormats(ajv)

const DEFAULT_SCHEMA = {
	type: 'object',
	properties: {},
	required: [],
	additionalProperties: true,
}

function createSchemaFieldId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID()
	}
	return `schema-field-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function schemaFromBuilder(fields: SchemaBuilderField[]) {
	const properties: Record<string, Record<string, unknown>> = {}
	const required: string[] = []

	fields.forEach((field) => {
		if (!field.key.trim()) return
		const definition: Record<string, unknown> = { type: field.type }
		if (field.required) {
			required.push(field.key)
		}
		if ((field.type === 'number' || field.type === 'integer') && typeof field.min === 'number') {
			definition.minimum = field.min
		}
		if ((field.type === 'number' || field.type === 'integer') && typeof field.max === 'number') {
			definition.maximum = field.max
		}
		if (field.type === 'string' && typeof field.minLength === 'number') {
			definition.minLength = field.minLength
		}
		if (field.type === 'string' && typeof field.maxLength === 'number') {
			definition.maxLength = field.maxLength
		}
		properties[field.key] = definition
	})

	return {
		type: 'object',
		properties,
		required,
		additionalProperties: true,
	}
}

function builderFromSchema(schema: unknown): SchemaBuilderField[] {
	if (!schema || typeof schema !== 'object') return []
	const maybe = schema as Record<string, unknown>
	const props = maybe.properties
	if (!props || typeof props !== 'object' || Array.isArray(props)) return []
	const requiredList = Array.isArray(maybe.required)
		? maybe.required.filter((entry): entry is string => typeof entry === 'string')
		: []

	return Object.entries(props).flatMap(([key, def]) => {
		if (!def || typeof def !== 'object') return []
		const asRecord = def as Record<string, unknown>
		const type = asRecord.type
		if (!['string', 'number', 'integer', 'boolean'].includes(String(type))) return []
		return [
			{
				id: createSchemaFieldId(),
				key,
				type: type as SchemaFieldType,
				required: requiredList.includes(key),
				min: typeof asRecord.minimum === 'number' ? asRecord.minimum : undefined,
				max: typeof asRecord.maximum === 'number' ? asRecord.maximum : undefined,
				minLength: typeof asRecord.minLength === 'number' ? asRecord.minLength : undefined,
				maxLength: typeof asRecord.maxLength === 'number' ? asRecord.maxLength : undefined,
			},
		]
	})
}

function hasExternalRef(schema: unknown): boolean {
	if (!schema || typeof schema !== 'object') return false
	if (Array.isArray(schema)) {
		return schema.some((value) => hasExternalRef(value))
	}
	const entries = Object.entries(schema as Record<string, unknown>)
	for (const [key, value] of entries) {
		if (key === '$ref' && typeof value === 'string') {
			if (!value.startsWith('#/')) return true
		}
		if (hasExternalRef(value)) return true
	}
	return false
}

export function MapContextEditorPanel({
	initialContext,
	onClose,
	onSave,
}: MapContextEditorPanelProps) {
	const { ndk } = useNDK()
	const currentUser = useNDKCurrentUser()
	const initial = initialContext?.context

	const [name, setName] = useState(initial?.name ?? '')
	const [description, setDescription] = useState(initial?.description ?? '')
	const [image, setImage] = useState(initial?.image ?? '')
	const [contextUse, setContextUse] = useState<MapContextContent['contextUse']>(
		initial?.contextUse ?? 'taxonomy',
	)
	const [validationMode, setValidationMode] = useState<MapContextContent['validationMode']>(
		initial?.validationMode ?? 'none',
	)
	const [schemaMode, setSchemaMode] = useState<'builder' | 'json'>('builder')
	const [fields, setFields] = useState<SchemaBuilderField[]>(builderFromSchema(initial?.schema))
	const [schemaJson, setSchemaJson] = useState(
		JSON.stringify(initial?.schema ?? DEFAULT_SCHEMA, null, 2),
	)
	const [samplePropertiesJson, setSamplePropertiesJson] = useState('{\n  "elevation": 1000\n}')
	const [isSaving, setIsSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)

	const builderSchema = useMemo(() => schemaFromBuilder(fields), [fields])
	const effectiveSchemaJson =
		schemaMode === 'builder' ? JSON.stringify(builderSchema, null, 2) : schemaJson

	const parsedSchema = useMemo(() => {
		try {
			return { schema: JSON.parse(effectiveSchemaJson), error: null as string | null }
		} catch (error) {
			return {
				schema: null,
				error: error instanceof Error ? error.message : 'Invalid schema JSON',
			}
		}
	}, [effectiveSchemaJson])

	const sampleValidation = useMemo(() => {
		if (!parsedSchema.schema) {
			return { status: 'error' as const, message: parsedSchema.error ?? 'Invalid schema' }
		}
		try {
			const parsedSample = JSON.parse(samplePropertiesJson)
			const validate = ajv.compile(parsedSchema.schema)
			const valid = validate(parsedSample)
			if (valid) {
				return { status: 'valid' as const, message: 'Sample is valid.' }
			}
			const first = validate.errors?.[0]
			return {
				status: 'invalid' as const,
				message: `${first?.instancePath || '/'} ${first?.message || 'Validation failed'}`,
			}
		} catch (error) {
			return {
				status: 'error' as const,
				message: error instanceof Error ? error.message : 'Invalid sample JSON',
			}
		}
	}, [parsedSchema, samplePropertiesJson])

	const requiresSchema = contextUse !== 'taxonomy' && validationMode !== 'none'

	const handleSave = async () => {
		if (!ndk || !currentUser) return
		setSaveError(null)

		if (!name.trim()) {
			setSaveError('Context name is required.')
			return
		}

		if (requiresSchema) {
			if (!parsedSchema.schema) {
				setSaveError('Schema is invalid.')
				return
			}
			if (hasExternalRef(parsedSchema.schema)) {
				setSaveError('External $ref is not supported in v1. Use self-contained schema only.')
				return
			}
		}

		setIsSaving(true)
		try {
			const event = initialContext
				? NDKMapContextEvent.from(initialContext)
				: new NDKMapContextEvent(ndk)

			const effectiveValidationMode =
				contextUse === 'taxonomy' ? 'none' : validationMode || 'optional'

			event.context = {
				version: 1,
				name: name.trim(),
				description: description.trim() || undefined,
				image: image.trim() || undefined,
				contextUse,
				validationMode: effectiveValidationMode,
				schemaDialect: requiresSchema ? 'https://json-schema.org/draft/2020-12/schema' : undefined,
				schema: requiresSchema ? (parsedSchema.schema as Record<string, unknown>) : undefined,
			}

			await event.publishNew()
			onSave(event)
			onClose()
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : 'Failed to save context')
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<div className="space-y-3 text-sm">
			<div className="flex items-center justify-between">
				<h2 className="text-lg font-semibold text-gray-900">
					{initialContext ? 'Edit context' : 'Create context'}
				</h2>
			</div>

			<div className="space-y-2">
				<Label>Name</Label>
				<Input
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder="Context name"
				/>
			</div>

			<div className="space-y-2">
				<Label>Description</Label>
				<Textarea
					value={description}
					onChange={(event) => setDescription(event.target.value)}
					placeholder="What belongs in this context?"
					rows={3}
				/>
			</div>

			<div className="space-y-2">
				<Label>Image URL</Label>
				<Input
					value={image}
					onChange={(event) => setImage(event.target.value)}
					placeholder="https://..."
				/>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<div className="space-y-2">
					<Label>Context use</Label>
					<Select
						value={contextUse}
						onValueChange={(value) => {
							const nextUse = value as MapContextContent['contextUse']
							setContextUse(nextUse)
							if (nextUse === 'taxonomy') {
								setValidationMode('none')
							}
						}}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="taxonomy">taxonomy</SelectItem>
							<SelectItem value="validation">validation</SelectItem>
							<SelectItem value="hybrid">hybrid</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-2">
					<Label>Validation mode</Label>
					<Select
						value={validationMode}
						onValueChange={(value) =>
							setValidationMode(value as MapContextContent['validationMode'])
						}
						disabled={contextUse === 'taxonomy'}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="none">none</SelectItem>
							<SelectItem value="optional">optional</SelectItem>
							<SelectItem value="required">required</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="space-y-2 rounded-lg border border-gray-200 p-3">
				<div className="flex items-center justify-between">
					<Label>Schema</Label>
					<div className="flex items-center gap-1">
						<Button
							size="sm"
							variant={schemaMode === 'builder' ? 'default' : 'outline'}
							onClick={() => {
								setSchemaMode('builder')
							}}
						>
							Builder
						</Button>
						<Button
							size="sm"
							variant={schemaMode === 'json' ? 'default' : 'outline'}
							onClick={() => {
								setSchemaMode('json')
								setSchemaJson(JSON.stringify(builderSchema, null, 2))
							}}
						>
							JSON
						</Button>
					</div>
				</div>

				{schemaMode === 'builder' ? (
					<div className="space-y-2">
						{fields.map((field, index) => (
							<div key={field.id} className="rounded border border-gray-100 p-2 space-y-2">
								<div className="grid grid-cols-2 gap-2">
									<Input
										value={field.key}
										onChange={(event) => {
											const next = [...fields]
											next[index] = { ...field, key: event.target.value }
											setFields(next)
										}}
										placeholder="property key"
									/>
									<Select
										value={field.type}
										onValueChange={(value) => {
											const next = [...fields]
											next[index] = { ...field, type: value as SchemaFieldType }
											setFields(next)
										}}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="string">string</SelectItem>
											<SelectItem value="number">number</SelectItem>
											<SelectItem value="integer">integer</SelectItem>
											<SelectItem value="boolean">boolean</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="grid grid-cols-2 gap-2">
									<Input
										type="number"
										value={field.type === 'string' ? (field.minLength ?? '') : (field.min ?? '')}
										onChange={(event) => {
											const next = [...fields]
											const numeric =
												event.target.value === '' ? undefined : Number(event.target.value)
											next[index] =
												field.type === 'string'
													? { ...field, minLength: numeric }
													: { ...field, min: numeric }
											setFields(next)
										}}
										placeholder={field.type === 'string' ? 'minLength' : 'minimum'}
										disabled={field.type === 'boolean'}
									/>
									<Input
										type="number"
										value={field.type === 'string' ? (field.maxLength ?? '') : (field.max ?? '')}
										onChange={(event) => {
											const next = [...fields]
											const numeric =
												event.target.value === '' ? undefined : Number(event.target.value)
											next[index] =
												field.type === 'string'
													? { ...field, maxLength: numeric }
													: { ...field, max: numeric }
											setFields(next)
										}}
										placeholder={field.type === 'string' ? 'maxLength' : 'maximum'}
										disabled={field.type === 'boolean'}
									/>
								</div>
								<div className="flex items-center justify-between">
									<label className="text-xs text-gray-600 flex items-center gap-1">
										<input
											type="checkbox"
											checked={field.required}
											onChange={(event) => {
												const next = [...fields]
												next[index] = { ...field, required: event.target.checked }
												setFields(next)
											}}
										/>
										required
									</label>
									<Button
										size="sm"
										variant="ghost"
										onClick={() => {
											setFields(fields.filter((_, fieldIndex) => fieldIndex !== index))
										}}
									>
										Remove
									</Button>
								</div>
							</div>
						))}
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								setFields([
									...fields,
									{
										id: createSchemaFieldId(),
										key: '',
										type: 'string',
										required: false,
									},
								])
							}}
						>
							Add property
						</Button>
					</div>
				) : (
					<Textarea
						value={schemaJson}
						onChange={(event) => setSchemaJson(event.target.value)}
						rows={10}
						className="font-mono text-xs"
					/>
				)}

				<div className="space-y-1">
					<Label>Sample properties JSON</Label>
					<Textarea
						value={samplePropertiesJson}
						onChange={(event) => setSamplePropertiesJson(event.target.value)}
						rows={4}
						className="font-mono text-xs"
					/>
					<p
						className={`text-xs ${
							sampleValidation.status === 'valid'
								? 'text-emerald-600'
								: sampleValidation.status === 'invalid'
									? 'text-amber-600'
									: 'text-red-600'
						}`}
					>
						{sampleValidation.message}
					</p>
				</div>
			</div>

			{saveError && <p className="text-xs text-red-600">{saveError}</p>}

			<div className="flex items-center justify-end gap-2">
				<Button variant="outline" onClick={onClose}>
					Cancel
				</Button>
				<Button onClick={handleSave} disabled={isSaving || !ndk || !currentUser}>
					{isSaving ? 'Saving…' : 'Save context'}
				</Button>
			</div>
		</div>
	)
}

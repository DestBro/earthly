import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import type { FeatureCollection, Feature } from 'geojson'
import type { NDKGeoEvent } from '../ndk/NDKGeoEvent'
import type { NDKMapContextEvent } from '../ndk/NDKMapContextEvent'

export type ContextFilterMode = 'off' | 'warn' | 'strict'

export interface ContextValidationIssue {
	featureId?: string
	path: string
	message: string
}

export interface ContextValidationResult {
	status: 'valid' | 'invalid' | 'unresolved'
	featureErrorCount: number
	datasetErrorCount: number
	errors: ContextValidationIssue[]
}

const ajv = new Ajv2020({
	allErrors: true,
	strict: false,
	validateSchema: true,
})
addFormats(ajv)

export function getContextCoordinate(context: NDKMapContextEvent): string | null {
	return context.contextCoordinate ?? null
}

export function defaultContextFilterMode(context: NDKMapContextEvent): ContextFilterMode {
	const mode = context.context.validationMode
	if (mode === 'required') return 'strict'
	if (mode === 'optional') return 'warn'
	return 'off'
}

export function contextCanValidateDatasets(context: NDKMapContextEvent): boolean {
	const use = context.context.contextUse
	return use === 'validation' || use === 'hybrid'
}

function toFeatureId(feature: Feature, index: number): string | undefined {
	if (typeof feature.id === 'string') return feature.id
	if (typeof feature.id === 'number') return String(feature.id)
	return index >= 0 ? String(index) : undefined
}

export function validateDatasetForContext(
	dataset: NDKGeoEvent,
	context: NDKMapContextEvent,
	featureCollection?: FeatureCollection,
	mode: ContextFilterMode = 'strict',
): ContextValidationResult {
	if (mode === 'off') {
		return {
			status: 'unresolved',
			featureErrorCount: 0,
			datasetErrorCount: 0,
			errors: [],
		}
	}

	if (!contextCanValidateDatasets(context)) {
		return {
			status: 'unresolved',
			featureErrorCount: 0,
			datasetErrorCount: 0,
			errors: [],
		}
	}

	const schema = context.context.schema
	if (!schema || typeof schema !== 'object') {
		return {
			status: 'unresolved',
			featureErrorCount: 0,
			datasetErrorCount: 1,
			errors: [{ path: '$', message: 'Context schema is missing.' }],
		}
	}

	let validate: ReturnType<typeof ajv.compile>
	try {
		validate = ajv.compile(schema)
	} catch (error) {
		return {
			status: 'unresolved',
			featureErrorCount: 0,
			datasetErrorCount: 1,
			errors: [
				{
					path: '$',
					message: error instanceof Error ? error.message : 'Invalid context schema.',
				},
			],
		}
	}
	const collection = featureCollection ?? dataset.featureCollection
	const features = collection?.features ?? []

	if (features.length === 0) {
		return {
			status: 'valid',
			featureErrorCount: 0,
			datasetErrorCount: 0,
			errors: [],
		}
	}

	let invalidFeatureCount = 0
	const errors: ContextValidationIssue[] = []

	features.forEach((feature, index) => {
		const properties =
			feature.properties && typeof feature.properties === 'object' ? feature.properties : {}
		const valid = validate(properties)
		if (valid) return

		invalidFeatureCount += 1
		const featureId = toFeatureId(feature, index)

		;(validate.errors ?? []).forEach((error) => {
			errors.push({
				featureId,
				path: error.instancePath || '/',
				message: error.message ?? 'Schema validation error',
			})
		})
	})

	if (invalidFeatureCount === 0) {
		return {
			status: 'valid',
			featureErrorCount: 0,
			datasetErrorCount: 0,
			errors: [],
		}
	}

	return {
		status: 'invalid',
		featureErrorCount: invalidFeatureCount,
		datasetErrorCount: 1,
		errors,
	}
}

export function isDatasetAllowedByContextFilter(
	result: ContextValidationResult,
	mode: ContextFilterMode,
): boolean {
	if (mode === 'off' || mode === 'warn') return true
	return result.status === 'valid'
}

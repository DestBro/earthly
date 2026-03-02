import type { EditorFeature, EditorOperationContext } from '../types'
import { normalizeFeature } from '../utils/featureHelpers'
import { isSimplifiableGeometryType } from '@/lib/geo/geometry'

export class SimplifyManager {
	constructor(private ctx: EditorOperationContext) {}

	canSimplify(): boolean {
		return this.ctx
			.getSelectedFeatures()
			.some((feature) => isSimplifiableGeometryType(feature.geometry.type))
	}

	simplifySelectedFeatures(tolerance: number = 0.0001): {
		updatedCount: number
		skippedCount: number
	} {
		const selected = this.ctx
			.getSelectedFeatures()
			.filter((feature) => isSimplifiableGeometryType(feature.geometry.type))

		if (selected.length === 0) {
			return { updatedCount: 0, skippedCount: 0 }
		}

		const safeTolerance = Number.isFinite(tolerance)
			? Math.min(1, Math.max(1e-8, tolerance))
			: 0.0001

		const updated: EditorFeature[] = []
		const previous: EditorFeature[] = []
		let skippedCount = 0

		for (const feature of selected) {
			try {
				const simplified = this.ctx.transform.simplify(feature, safeTolerance)
				if (JSON.stringify(simplified.geometry) === JSON.stringify(feature.geometry)) {
					skippedCount += 1
					continue
				}

				const normalized = normalizeFeature({
					...feature,
					geometry: simplified.geometry,
				})
				this.ctx.features.set(feature.id, normalized)
				updated.push(normalized)
				previous.push(feature)
			} catch (error) {
				console.error(`Failed to simplify feature ${feature.id}:`, error)
				skippedCount += 1
			}
		}

		if (updated.length === 0) {
			return { updatedCount: 0, skippedCount }
		}

		this.ctx.history.recordUpdate(updated, previous)
		this.ctx.render()
		if (this.ctx.mode === 'edit') this.ctx.renderVertices()
		this.ctx.emit('update', { type: 'update', features: updated })

		return { updatedCount: updated.length, skippedCount }
	}
}

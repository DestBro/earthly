import type { Geometry, Position } from 'geojson'
import type { EditorFeature } from '../types'

export function cloneFeature(feature: EditorFeature): EditorFeature {
	return JSON.parse(JSON.stringify(feature)) as EditorFeature
}

export function normalizeFeature(feature: EditorFeature): EditorFeature {
	feature.properties = {
		...feature.properties,
		meta: feature.properties?.meta ?? 'feature',
		featureId: feature.id,
	}
	return feature
}

export function getBaseGeometryType(type: string): 'Point' | 'LineString' | 'Polygon' | null {
	if (type === 'Point' || type === 'LineString' || type === 'Polygon') return type
	if (type === 'MultiPoint') return 'Point'
	if (type === 'MultiLineString') return 'LineString'
	if (type === 'MultiPolygon') return 'Polygon'
	return null
}

export function toMultiGeometryType(
	type: 'Point' | 'LineString' | 'Polygon',
): Geometry['type'] | null {
	if (type === 'Point') return 'MultiPoint'
	if (type === 'LineString') return 'MultiLineString'
	if (type === 'Polygon') return 'MultiPolygon'
	return null
}

export function isMultiGeometry(type: string): boolean {
	return type === 'MultiPoint' || type === 'MultiLineString' || type === 'MultiPolygon'
}

export function extractGeometryParts(
	geometry: Geometry,
	base: 'Point' | 'LineString' | 'Polygon',
): any[] {
	if (base === 'Point') {
		if (geometry.type === 'Point') return [geometry.coordinates]
		if (geometry.type === 'MultiPoint') return geometry.coordinates as Position[]
	} else if (base === 'LineString') {
		if (geometry.type === 'LineString') return [geometry.coordinates]
		if (geometry.type === 'MultiLineString') return geometry.coordinates as Position[][]
	} else if (base === 'Polygon') {
		if (geometry.type === 'Polygon') return [geometry.coordinates]
		if (geometry.type === 'MultiPolygon') return geometry.coordinates as Position[][][]
	}
	return []
}

export function isLineGeometryType(type: Geometry['type']): boolean {
	return type === 'LineString' || type === 'MultiLineString'
}

export function extractLinePartsFromGeometry(geometry: Geometry): Position[][] {
	if (geometry.type === 'LineString') {
		return [JSON.parse(JSON.stringify(geometry.coordinates)) as Position[]]
	}
	if (geometry.type === 'MultiLineString') {
		return JSON.parse(JSON.stringify(geometry.coordinates)) as Position[][]
	}
	return []
}

export function snapPosition(coord: Position, tolerance: number): Position {
	const lon = Math.round(coord[0] / tolerance) * tolerance
	const lat = Math.round(coord[1] / tolerance) * tolerance
	if (coord.length > 2) {
		return [lon, lat, ...coord.slice(2)] as Position
	}
	return [lon, lat]
}

export function positionKey(position: Position, tolerance: number): string {
	const lon = Math.round(position[0] / tolerance)
	const lat = Math.round(position[1] / tolerance)
	return `${lon}:${lat}`
}

export function positionsEquivalent(a: Position, b: Position, tolerance: number): boolean {
	return positionKey(a, tolerance) === positionKey(b, tolerance)
}

export function removeConsecutiveDuplicatePositions(
	coords: Position[],
	tolerance: number,
): Position[] {
	if (coords.length === 0) return coords
	const deduped: Position[] = [coords[0]]
	for (let i = 1; i < coords.length; i++) {
		const previous = deduped[deduped.length - 1]
		const current = coords[i]
		if (!previous || !current) continue
		if (!positionsEquivalent(previous, current, tolerance)) {
			deduped.push(current)
		}
	}
	return deduped
}

export function normalizeLineCoordinates(coords: Position[], tolerance: number): Position[] {
	const snapped = coords.map((coord) => snapPosition(coord, tolerance))
	return removeConsecutiveDuplicatePositions(snapped, tolerance)
}

export function mergeLinePartsBySharedEndpoints(
	lines: Position[][],
	tolerance: number,
): Position[][] {
	const adjacency = new Map<string, Set<string>>()
	const nodeCoords = new Map<string, Position>()
	const allEdges = new Set<string>()

	const toEdgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`)
	const registerNode = (position: Position): string => {
		const key = positionKey(position, tolerance)
		if (!nodeCoords.has(key)) {
			nodeCoords.set(key, position)
		}
		return key
	}

	for (const coords of lines) {
		if (coords.length < 2) continue
		for (let i = 0; i < coords.length - 1; i++) {
			const start = coords[i]
			const end = coords[i + 1]
			if (!start || !end) continue
			if (positionsEquivalent(start, end, tolerance)) continue

			const startKey = registerNode(start)
			const endKey = registerNode(end)
			const edgeKey = toEdgeKey(startKey, endKey)
			if (allEdges.has(edgeKey)) {
				continue
			}

			allEdges.add(edgeKey)
			const startLinks = adjacency.get(startKey) ?? new Set<string>()
			startLinks.add(endKey)
			adjacency.set(startKey, startLinks)

			const endLinks = adjacency.get(endKey) ?? new Set<string>()
			endLinks.add(startKey)
			adjacency.set(endKey, endLinks)
		}
	}

	if (allEdges.size === 0) return []

	const visitedEdges = new Set<string>()
	const walkPath = (startKey: string, nextKey: string): string[] => {
		const path = [startKey, nextKey]
		visitedEdges.add(toEdgeKey(startKey, nextKey))

		let previous = startKey
		let current = nextKey

		while (true) {
			const neighbors = [...(adjacency.get(current) ?? [])].filter((key) => key !== previous)
			if (neighbors.length === 0) break

			const candidate = neighbors.find(
				(neighborKey) => !visitedEdges.has(toEdgeKey(current, neighborKey)),
			)
			if (!candidate) break

			path.push(candidate)
			visitedEdges.add(toEdgeKey(current, candidate))
			previous = current
			current = candidate
		}

		return path
	}

	const toCoordinatePath = (nodePath: string[]): Position[] => {
		const positions = nodePath
			.map((key) => nodeCoords.get(key))
			.filter((position): position is Position => Boolean(position))
		return removeConsecutiveDuplicatePositions(positions, tolerance)
	}

	const merged: Position[][] = []
	const nodeKeys = [...adjacency.keys()]
	const nonLinearNodes = nodeKeys.filter((key) => (adjacency.get(key)?.size ?? 0) !== 2)

	for (const startKey of nonLinearNodes) {
		for (const neighborKey of adjacency.get(startKey) ?? []) {
			const edgeKey = toEdgeKey(startKey, neighborKey)
			if (visitedEdges.has(edgeKey)) continue
			const path = toCoordinatePath(walkPath(startKey, neighborKey))
			if (path.length >= 2) {
				merged.push(path)
			}
		}
	}

	for (const edgeKey of allEdges) {
		if (visitedEdges.has(edgeKey)) continue
		const [startKey, endKey] = edgeKey.split('|')
		if (!startKey || !endKey) continue
		const path = toCoordinatePath(walkPath(startKey, endKey))
		if (path.length >= 2) {
			merged.push(path)
		}
	}

	return merged
}

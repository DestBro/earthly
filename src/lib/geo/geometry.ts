import type { Geometry } from 'geojson'

/**
 * Check whether a geometry type supports simplification
 * (i.e. has enough coordinates to reduce).
 */
export function isSimplifiableGeometryType(type: Geometry['type']): boolean {
	return (
		type === 'LineString' ||
		type === 'Polygon' ||
		type === 'MultiLineString' ||
		type === 'MultiPolygon'
	)
}

/**
 * Count the total number of coordinate vertices in a geometry.
 */
export function countGeometryVertices(geometry: Geometry): number {
	switch (geometry.type) {
		case 'Point':
			return 1
		case 'MultiPoint':
		case 'LineString':
			return geometry.coordinates.length
		case 'MultiLineString':
		case 'Polygon':
			return geometry.coordinates.reduce((sum, ring) => sum + ring.length, 0)
		case 'MultiPolygon':
			return geometry.coordinates.reduce(
				(sum, polygon) => sum + polygon.reduce((ringSum, ring) => ringSum + ring.length, 0),
				0,
			)
		case 'GeometryCollection':
			return geometry.geometries.reduce((sum, child) => sum + countGeometryVertices(child), 0)
		default:
			return 0
	}
}

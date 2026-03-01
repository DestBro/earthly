/**
 * Compute a bounding box [west, south, east, north] from any GeoJSON geometry.
 * Returns null if no valid coordinates are found.
 */
export function bboxFromGeometry(geometry: any): [number, number, number, number] | null {
	let west = Infinity
	let south = Infinity
	let east = -Infinity
	let north = -Infinity

	const add = (coord: any) => {
		if (!Array.isArray(coord) || coord.length < 2) return
		const lon = Number(coord[0])
		const lat = Number(coord[1])
		if (!Number.isFinite(lon) || !Number.isFinite(lat)) return
		if (lon < west) west = lon
		if (lon > east) east = lon
		if (lat < south) south = lat
		if (lat > north) north = lat
	}

	const walk = (g: any) => {
		if (!g) return
		switch (g.type) {
			case 'Point':
				add(g.coordinates)
				break
			case 'MultiPoint':
			case 'LineString':
				for (const c of g.coordinates ?? []) add(c)
				break
			case 'MultiLineString':
			case 'Polygon':
				for (const ring of g.coordinates ?? []) {
					for (const c of ring ?? []) add(c)
				}
				break
			case 'MultiPolygon':
				for (const poly of g.coordinates ?? []) {
					for (const ring of poly ?? []) {
						for (const c of ring ?? []) add(c)
					}
				}
				break
			case 'GeometryCollection':
				for (const geom of g.geometries ?? []) walk(geom)
				break
		}
	}

	walk(geometry)
	if (
		!Number.isFinite(west) ||
		!Number.isFinite(south) ||
		!Number.isFinite(east) ||
		!Number.isFinite(north)
	) {
		return null
	}
	return [west, south, east, north]
}

/**
 * Tool definitions for AI chat
 * Maps EarthlyGeoServer tools to OpenAI function calling format
 */

import { EarthlyGeoServerClient } from '@/ctxcn/EarthlyGeoServerClient'

// OpenAI function calling tool definition
export interface Tool {
	type: 'function'
	function: {
		name: string
		description: string
		parameters: {
			type: 'object'
			properties: Record<string, {
				type: string
				description: string
				enum?: string[]
			}>
			required?: string[]
		}
	}
}

// Tool call from API response
export interface ToolCall {
	id: string
	type: 'function'
	function: {
		name: string
		arguments: string // JSON string
	}
}

// Tool call result to send back
export interface ToolResult {
	tool_call_id: string
	role: 'tool'
	content: string
}

// Define available tools
export const geoTools: Tool[] = [
	{
		type: 'function',
		function: {
			name: 'search_location',
			description: 'Search for locations by name using OpenStreetMap. Returns coordinates, bounding boxes, and addresses.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'The location query (e.g., "New York City", "Eiffel Tower")',
					},
					limit: {
						type: 'number',
						description: 'Maximum number of results (default: 5, max: 50)',
					},
				},
				required: ['query'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'reverse_lookup',
			description: 'Get address information for coordinates. Useful for identifying what is at a specific location.',
			parameters: {
				type: 'object',
				properties: {
					lat: {
						type: 'number',
						description: 'Latitude coordinate in WGS84',
					},
					lon: {
						type: 'number',
						description: 'Longitude coordinate in WGS84',
					},
					zoom: {
						type: 'number',
						description: 'Level of detail (0-18, default 18). Lower = less detail.',
					},
				},
				required: ['lat', 'lon'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'query_osm_nearby',
			description: 'Find OpenStreetMap features near a point. Can filter by tags like amenity=cafe, shop=supermarket.',
			parameters: {
				type: 'object',
				properties: {
					lat: {
						type: 'number',
						description: 'Latitude coordinate',
					},
					lon: {
						type: 'number',
						description: 'Longitude coordinate',
					},
					radius: {
						type: 'number',
						description: 'Search radius in meters (1-5000, default 500)',
					},
					filters: {
						type: 'object',
						description: 'OSM tag filters like {"amenity": "cafe"} or {"shop": "supermarket"}',
					},
					limit: {
						type: 'number',
						description: 'Maximum results to return (default 10)',
					},
				},
				required: ['lat', 'lon'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'query_osm_bbox',
			description: 'Find OpenStreetMap features within a bounding box. Can filter by tags.',
			parameters: {
				type: 'object',
				properties: {
					west: {
						type: 'number',
						description: 'Western longitude of bounding box',
					},
					south: {
						type: 'number',
						description: 'Southern latitude of bounding box',
					},
					east: {
						type: 'number',
						description: 'Eastern longitude of bounding box',
					},
					north: {
						type: 'number',
						description: 'Northern latitude of bounding box',
					},
					filters: {
						type: 'object',
						description: 'OSM tag filters like {"amenity": "restaurant"}',
					},
					limit: {
						type: 'number',
						description: 'Maximum results to return (default 10)',
					},
				},
				required: ['west', 'south', 'east', 'north'],
			},
		},
	},
]

// Singleton client instance
let geoClient: EarthlyGeoServerClient | null = null

/**
 * Get or create the geo client instance
 */
export function getGeoClient(): EarthlyGeoServerClient {
	if (!geoClient) {
		geoClient = new EarthlyGeoServerClient()
	}
	return geoClient
}

/**
 * Execute a tool call and return the result
 */
export async function executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
	const client = getGeoClient()
	const args = JSON.parse(toolCall.function.arguments)

	try {
		let result: unknown

		switch (toolCall.function.name) {
			case 'search_location': {
				const response = await client.SearchLocation(args.query, args.limit ?? 5)
				result = response.result
				break
			}
			case 'reverse_lookup': {
				const response = await client.ReverseLookup(args.lat, args.lon, args.zoom)
				result = response.result
				break
			}
			case 'query_osm_nearby': {
				const response = await client.QueryOsmNearby(
					args.lat,
					args.lon,
					args.radius,
					args.filters,
					args.limit,
				)
				result = response.result
				break
			}
			case 'query_osm_bbox': {
				const response = await client.QueryOsmBbox(
					args.west,
					args.south,
					args.east,
					args.north,
					args.filters,
					args.limit,
				)
				result = response.result
				break
			}
			default:
				throw new Error(`Unknown tool: ${toolCall.function.name}`)
		}

		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: JSON.stringify(result, null, 2),
		}
	} catch (error) {
		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: JSON.stringify({
				error: error instanceof Error ? error.message : 'Tool execution failed',
			}),
		}
	}
}

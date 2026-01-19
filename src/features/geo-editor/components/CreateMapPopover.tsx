/**
 * CreateMapPopover - UI for extracting PMTiles map excerpts
 *
 * Allows users to:
 * 1. Select source: from dataset bbox or from current selection
 * 2. Enter a Blossom server URL
 * 3. Configure max zoom level
 * 4. Extract, sign, and upload the map
 */

import { useState, useMemo, useEffect } from 'react'
import { Map, Loader2, Check, Copy, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from '@/components/ui/popover'
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
	TooltipProvider,
} from '@/components/ui/tooltip'
import { useEditorStore } from '../store'
import { useNDK, useNDKCurrentUser } from '@nostr-dev-kit/react'
import { EarthlyGeoServerClient } from '@/ctxcn/EarthlyGeoServerClient'
import { config } from '@/config'

// Area calculation helpers
function calculateBBoxAreaSqKm(bbox: { west: number; south: number; east: number; north: number }): number {
	const { west, south, east, north } = bbox

	// Convert to radians
	const lat1 = (south * Math.PI) / 180
	const lat2 = (north * Math.PI) / 180
	const lon1 = (west * Math.PI) / 180
	const lon2 = (east * Math.PI) / 180

	// Earth radius in km
	const R = 6371

	// Approximate area using spherical geometry
	const width = R * Math.cos((lat1 + lat2) / 2) * Math.abs(lon2 - lon1)
	const height = R * Math.abs(lat2 - lat1)

	return width * height
}

// Max area in sqkm (configurable)
const MAX_AREA_SQKM = 3000

interface BBox {
	west: number
	south: number
	east: number
	north: number
}

type SourceType = 'dataset' | 'selection'
type FlowState = 'idle' | 'extracting' | 'signing' | 'uploading' | 'done' | 'error'

export function CreateMapPopover() {
	const [open, setOpen] = useState(false)
	const [sourceType, setSourceType] = useState<SourceType>('dataset')
	const [blossomUrl, setBlossomUrl] = useState(
		config.isDevelopment ? 'http://localhost:3001' : 'https://blossom.earthly.city'
	)
	const [maxZoom, setMaxZoom] = useState(16)
	const [flowState, setFlowState] = useState<FlowState>('idle')
	const [error, setError] = useState<string | null>(null)
	const [resultUrl, setResultUrl] = useState<string | null>(null)
	const [copiedUrl, setCopiedUrl] = useState(false)

	const { ndk } = useNDK()
	const currentUser = useNDKCurrentUser()
	const editor = useEditorStore((state) => state.editor)
	const currentBbox = useEditorStore((state) => state.currentBbox)
	const mode = useEditorStore((state) => state.mode)
	const setMode = useEditorStore((state) => state.setMode)
	const setMapSource = useEditorStore((state) => state.setMapSource)
	const mapAreaRect = useEditorStore((state) => state.mapAreaRect)
	const clearMapAreaRect = useEditorStore((state) => state.clearMapAreaRect)

	// Compute bbox from dataset or selection
	const bbox = useMemo((): BBox | null => {
		if (sourceType === 'dataset') {
			// Get bbox from all features in editor
			const features = editor?.getAllFeatures() ?? []
			if (features.length === 0) return null

			let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity

			for (const feature of features) {
				const coords = getAllCoordinates(feature.geometry)
				for (const [lon, lat] of coords) {
					if (lon < west) west = lon
					if (lon > east) east = lon
					if (lat < south) south = lat
					if (lat > north) north = lat
				}
			}

			if (!isFinite(west)) return null
			return { west, south, east, north }
		} else {
			// From drawn rectangle
			if (mapAreaRect) {
				return {
					west: mapAreaRect.bbox[0],
					south: mapAreaRect.bbox[1],
					east: mapAreaRect.bbox[2],
					north: mapAreaRect.bbox[3],
				}
			}
			return null
		}
	}, [sourceType, editor, mapAreaRect])

	// Handle source type change - activates appropriate tool
	const setIsDrawingMapArea = useEditorStore((state) => state.setIsDrawingMapArea)
	const handleSourceChange = (newSource: SourceType) => {
		setSourceType(newSource)
		if (newSource === 'dataset') {
			// Activate select tool for dataset selection
			setMode('select')
			// Clear any drawn rectangle
			clearMapAreaRect()
		} else {
			// Set flag before activating draw mode
			setIsDrawingMapArea(true)
			// Activate polygon drawing for rectangle
			setMode('draw_polygon')
		}
		// Close the popover to let user interact with map
		setOpen(false)
	}

	// Auto-reopen popover when mapAreaRect is captured after drawing
	useEffect(() => {
		if (mapAreaRect && !open) {
			setSourceType('selection')
			setOpen(true)
		}
	}, [mapAreaRect])

	// Calculate area
	const areaSqKm = bbox ? calculateBBoxAreaSqKm(bbox) : 0
	const isAreaTooLarge = areaSqKm > MAX_AREA_SQKM

	// Validate URL
	const isUrlValid = useMemo(() => {
		try {
			new URL(blossomUrl)
			return true
		} catch {
			return false
		}
	}, [blossomUrl])

	const canCreate = bbox && isUrlValid && !isAreaTooLarge && currentUser

	// Handle create map flow
	const handleCreate = async () => {
		if (!bbox || !ndk?.signer) return

		setError(null)
		setResultUrl(null)
		setFlowState('extracting')

		try {
			// Create client
			const client = new EarthlyGeoServerClient()

			// Step 1: Extract PMTiles
			// Note: CreateMapExtract method will be available after client regeneration
			const extractResult = await (client as any).CreateMapExtract(
				bbox.west,
				bbox.south,
				bbox.east,
				bbox.north,
				maxZoom,
				blossomUrl,
			)

			if (!extractResult?.result) {
				throw new Error('Extraction failed: no result')
			}

			const { requestId, unsignedEvent } = extractResult.result

			// Step 2: Sign the event using NDK
			setFlowState('signing')

			// Create an NDKEvent from the unsigned event template
			const { NDKEvent } = await import('@nostr-dev-kit/ndk')
			const event = new NDKEvent(ndk)
			event.kind = unsignedEvent.kind
			event.content = unsignedEvent.content
			event.created_at = unsignedEvent.created_at
			event.tags = unsignedEvent.tags

			await event.sign()

			if (!event.sig) {
				throw new Error('User cancelled signing')
			}

			// Step 3: Upload
			setFlowState('uploading')

			// Note: CreateMapUpload method will be available after client regeneration
			const uploadResult = await (client as any).CreateMapUpload(requestId, {
				id: event.id,
				pubkey: event.pubkey,
				kind: event.kind,
				created_at: event.created_at,
				tags: event.tags,
				content: event.content,
				sig: event.sig,
			})

			if (!uploadResult?.result?.blobUrl) {
				throw new Error('Upload failed: no result URL')
			}

			setResultUrl(uploadResult.result.blobUrl)
			setFlowState('done')
		} catch (err: any) {
			console.error('Create map failed:', err)
			setError(err.message || 'Unknown error')
			setFlowState('error')
		}
	}

	const handleCopyUrl = async () => {
		if (resultUrl) {
			await navigator.clipboard.writeText(resultUrl)
			setCopiedUrl(true)
			setTimeout(() => setCopiedUrl(false), 2000)
		}
	}

	const handleReset = () => {
		setFlowState('idle')
		setError(null)
		setResultUrl(null)
	}

	const handleUseAsMapSource = () => {
		if (!resultUrl) return

		// Set as current map source
		setMapSource({
			type: 'pmtiles',
			location: 'remote',
			url: resultUrl,
		})

		// Update browser URL with shareable param
		const url = new URL(window.location.href)
		url.searchParams.set('pmtiles', resultUrl)
		window.history.replaceState({}, '', url.toString())

		// Close the popover
		setOpen(false)
		handleReset()
	}

	return (
		<TooltipProvider delayDuration={500}>
			<Popover open={open} onOpenChange={setOpen}>
				<Tooltip>
					<TooltipTrigger asChild>
						<PopoverTrigger asChild>
							<Button
								variant="outline"
								size="icon"
								aria-label="Create Map"
							>
								<Map className="h-4 w-4" />
							</Button>
						</PopoverTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>Create map excerpt</p>
					</TooltipContent>
				</Tooltip>

				<PopoverContent className="w-80" side="bottom" align="end">
					<div className="space-y-4">
						<div>
							<h4 className="text-sm font-semibold">Create Map</h4>
							<p className="text-xs text-muted-foreground">
								Extract a PMTiles map excerpt and upload to Blossom
							</p>
						</div>

						{flowState === 'idle' && (
							<>
								{/* Source selection - now as buttons that activate tools */}
								<div className="space-y-2">
									<Label>Source</Label>
									<div className="flex gap-2">
										<Button
											variant={sourceType === 'dataset' ? 'default' : 'outline'}
											size="sm"
											className="flex-1"
											onClick={() => handleSourceChange('dataset')}
										>
											From Dataset
										</Button>
										<Button
											variant={sourceType === 'selection' ? 'default' : 'outline'}
											size="sm"
											className="flex-1"
											onClick={() => handleSourceChange('selection')}
										>
											Draw Rectangle
										</Button>
									</div>
									<p className="text-xs text-muted-foreground">
										{sourceType === 'dataset'
											? 'Uses bounding box of current dataset features'
											: 'Draw a rectangle on the map to select area'}
									</p>
								</div>

								{/* Blossom URL */}
								<div className="space-y-2">
									<Label htmlFor="blossom-url">Blossom Server</Label>
									<Input
										id="blossom-url"
										value={blossomUrl}
										onChange={(e) => setBlossomUrl(e.target.value)}
										placeholder="https://blossom.example.com"
									/>
									{!isUrlValid && blossomUrl && (
										<p className="text-xs text-destructive">Invalid URL</p>
									)}
								</div>

								{/* Max Zoom */}
								<div className="space-y-2">
									<div className="flex items-center justify-between">
										<Label>Max Zoom</Label>
										<span className="text-xs text-muted-foreground">{maxZoom}</span>
									</div>
									<Slider
										value={[maxZoom]}
										onValueChange={([v]) => v !== undefined && setMaxZoom(v)}
										min={4}
										max={16}
										step={1}
									/>
								</div>

								{/* Area display */}
								{bbox && (
									<div className="rounded-md bg-muted p-2">
										<div className="flex items-center justify-between text-xs">
											<span>Area:</span>
											<span className={isAreaTooLarge ? 'text-destructive font-medium' : ''}>
												{areaSqKm.toFixed(2)} km²
											</span>
										</div>
										{isAreaTooLarge && (
											<div className="flex items-center gap-1 mt-1 text-xs text-destructive">
												<AlertTriangle className="h-3 w-3" />
												Max {MAX_AREA_SQKM} km² allowed
											</div>
										)}
									</div>
								)}

								{!bbox && (
									<p className="text-xs text-muted-foreground">
										{sourceType === 'dataset'
											? 'No features in current dataset'
											: 'Draw a selection on the map'}
									</p>
								)}

								{!currentUser && (
									<p className="text-xs text-destructive">
										Please log in to sign the upload
									</p>
								)}

								<Button
									onClick={handleCreate}
									disabled={!canCreate}
									className="w-full"
								>
									Create Map
								</Button>
							</>
						)}

						{(flowState === 'extracting' || flowState === 'signing' || flowState === 'uploading') && (
							<div className="flex flex-col items-center py-4 gap-2">
								<Loader2 className="h-8 w-8 animate-spin text-primary" />
								<p className="text-sm text-muted-foreground">
									{flowState === 'extracting' && 'Extracting map...'}
									{flowState === 'signing' && 'Waiting for signature...'}
									{flowState === 'uploading' && 'Uploading to Blossom...'}
								</p>
							</div>
						)}

						{flowState === 'done' && resultUrl && (
							<div className="space-y-3">
								<div className="flex items-center gap-2 text-green-600">
									<Check className="h-5 w-5" />
									<span className="text-sm font-medium">Upload complete!</span>
								</div>
								<div className="space-y-1">
									<Label>PMTiles URL</Label>
									<div className="flex gap-2">
										<Input
											value={resultUrl}
											readOnly
											className="text-xs"
										/>
										<Button
											size="icon"
											variant="outline"
											onClick={handleCopyUrl}
										>
											{copiedUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
										</Button>
									</div>
								</div>
								<Button onClick={handleUseAsMapSource} className="w-full">
									Use as Map Source
								</Button>
								<Button variant="outline" onClick={handleReset} className="w-full">
									Create another
								</Button>
							</div>
						)}

						{flowState === 'error' && (
							<div className="space-y-3">
								<div className="rounded-md bg-destructive/10 p-3">
									<p className="text-sm text-destructive">{error}</p>
								</div>
								<Button variant="outline" onClick={handleReset} className="w-full">
									Try again
								</Button>
							</div>
						)}
					</div>
				</PopoverContent>
			</Popover>
		</TooltipProvider>
	)
}

// Helper to extract all coordinates from a geometry
function getAllCoordinates(geometry: any): [number, number][] {
	const coords: [number, number][] = []

	function extract(g: any) {
		if (!g) return

		switch (g.type) {
			case 'Point':
				coords.push(g.coordinates as [number, number])
				break
			case 'MultiPoint':
			case 'LineString':
				for (const c of g.coordinates) {
					coords.push(c as [number, number])
				}
				break
			case 'MultiLineString':
			case 'Polygon':
				for (const ring of g.coordinates) {
					for (const c of ring) {
						coords.push(c as [number, number])
					}
				}
				break
			case 'MultiPolygon':
				for (const poly of g.coordinates) {
					for (const ring of poly) {
						for (const c of ring) {
							coords.push(c as [number, number])
						}
					}
				}
				break
			case 'GeometryCollection':
				for (const geom of g.geometries) {
					extract(geom)
				}
				break
		}
	}

	extract(geometry)
	return coords
}

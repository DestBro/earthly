import { MapPinned, MousePointerClick, Scan, Settings2 } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '../../../components/ui/select'
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '../../../components/ui/tooltip'
import { useEditorStore } from '../store'

// Feature filter presets
const FILTER_PRESETS = [
	{ label: 'Highways', value: 'highway' },
	{ label: 'Railways', value: 'railway' },
	{ label: 'Waterways', value: 'waterway' },
	{ label: 'Buildings', value: 'building' },
	{ label: 'Natural', value: 'natural' },
	{ label: 'Landuse', value: 'landuse' },
	{ label: 'Amenities', value: 'amenity' },
	{ label: 'All', value: 'all' },
] as const

interface OsmQueryPopoverProps {
	onQueryClick: () => void
	onQueryView: () => void
	onAdvanced: () => void
}

export function OsmQueryPopover({ onQueryClick, onQueryView, onAdvanced }: OsmQueryPopoverProps) {
	const osmQueryMode = useEditorStore((state) => state.osmQueryMode)
	const osmQueryFilter = useEditorStore((state) => state.osmQueryFilter)
	const setOsmQueryFilter = useEditorStore((state) => state.setOsmQueryFilter)
	const setOsmQueryMode = useEditorStore((state) => state.setOsmQueryMode)

	const isClickMode = osmQueryMode === 'click'

	const handleQueryClick = () => {
		setOsmQueryMode('click')
		onQueryClick()
	}

	const handleQueryView = () => {
		onQueryView()
	}

	return (
		<TooltipProvider delayDuration={500}>
			<Popover>
				<Tooltip>
					<TooltipTrigger asChild>
						<PopoverTrigger asChild>
							<Button
								size="icon"
								variant={isClickMode ? 'default' : 'outline'}
								aria-label="Import from OSM"
							>
								<MapPinned className="h-4 w-4" />
							</Button>
						</PopoverTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>Import from OpenStreetMap</p>
					</TooltipContent>
				</Tooltip>

				<PopoverContent className="w-64 p-3" side="bottom" align="start">
					<div className="space-y-3">
						<div className="text-sm font-medium">Import from OSM</div>

						{/* Filter selection */}
						<div className="space-y-1.5">
							<label className="text-xs text-muted-foreground">Feature Type</label>
							<Select value={osmQueryFilter} onValueChange={setOsmQueryFilter}>
								<SelectTrigger className="h-8 text-sm">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{FILTER_PRESETS.map((preset) => (
										<SelectItem key={preset.value} value={preset.value}>
											{preset.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{/* Query options */}
						<div className="space-y-1.5">
							<Button
								variant="outline"
								size="sm"
								className="w-full justify-start gap-2"
								onClick={handleQueryClick}
							>
								<MousePointerClick className="h-4 w-4" />
								Click on Map
							</Button>
							<Button
								variant="outline"
								size="sm"
								className="w-full justify-start gap-2"
								onClick={handleQueryView}
							>
								<Scan className="h-4 w-4" />
								Query Current View
							</Button>
						</div>

						{/* Divider */}
						<div className="h-px bg-border" />

						{/* Advanced */}
						<Button
							variant="ghost"
							size="sm"
							className="w-full justify-start gap-2 text-muted-foreground"
							onClick={onAdvanced}
						>
							<Settings2 className="h-4 w-4" />
							Advanced...
						</Button>
					</div>
				</PopoverContent>
			</Popover>
		</TooltipProvider>
	)
}

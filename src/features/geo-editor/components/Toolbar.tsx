import {
	ChevronDown,
	Combine,
	Copy,
	CopyPlus,
	Crosshair,
	Download,
	Edit3,
	FileUp,
	Link2,
	Magnet,
	MapPin,
	Merge,
	Minus,
	MousePointer2,
	MousePointerClick,
	Pentagon,
	PlusCircle,
	Redo2,
	RefreshCw,
	Route,
	Scan,
	Settings2,
	Share2,
	Sparkles,
	Split as SplitIcon,
	SquareDashedMousePointer,
	Trash2,
	Type,
	Undo2,
	Upload,
	UploadCloud,
	X,
	XCircle,
	Check,
} from 'lucide-react'
import type React from 'react'
import { useRef, useState } from 'react'
import { HelpPopover } from '../../../components/HelpPopover'
import { LoginSessionButtons } from '../../../components/LoginSessionButtom'
import { Button } from '../../../components/ui/button'
import { ButtonGroup } from '../../../components/ui/button-group'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover'
import { SearchBar } from '../../../components/ui/search-bar'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '../../../components/ui/select'
import { SidebarTrigger } from '../../../components/ui/sidebar'
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '../../../components/ui/tooltip'
import type { EditorMode } from '../core'
import { useEditorStore } from '../store'
import type { GeoSearchResult } from '../types'
import { CreateMapPopover } from './CreateMapPopover'
import { MapSettingsPanel } from './MapSettingsPanel'

// OSM Feature filter presets
const OSM_FILTER_PRESETS = [
	{ label: 'Highways', value: 'highway' },
	{ label: 'Railways', value: 'railway' },
	{ label: 'Waterways', value: 'waterway' },
	{ label: 'Buildings', value: 'building' },
	{ label: 'Natural', value: 'natural' },
	{ label: 'Landuse', value: 'landuse' },
	{ label: 'Amenities', value: 'amenity' },
	{ label: 'All', value: 'all' },
] as const

type ToolbarButton = {
	key: string
	icon: React.ComponentType<any>
	onClick: () => void
	disabled?: boolean
	variant?: 'default' | 'outline'
	ariaLabel: string
	description: string
}

type IconButtonRowProps = {
	buttons: ToolbarButton[]
	className?: string
	wrap?: boolean
	small?: boolean
}

function IconButtonRow({
	buttons,
	className = '',
	wrap = false,
	small = false,
}: IconButtonRowProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8 w-8' : undefined

	return (
		<TooltipProvider delayDuration={500}>
			<div
				className={`flex items-center gap-0.5 ${wrap ? 'flex-wrap justify-center' : ''} ${className}`}
			>
				{buttons.map(
					({ key, icon: Icon, variant = 'outline', disabled, onClick, ariaLabel, description }) => (
						<Tooltip key={key}>
							<TooltipTrigger asChild>
								<Button
									size="icon"
									variant={variant}
									disabled={disabled}
									aria-label={ariaLabel}
									onClick={onClick}
									className={buttonSize}
								>
									<Icon className={iconSize} />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="bottom" sideOffset={8}>
								<p>{description}</p>
							</TooltipContent>
						</Tooltip>
					),
				)}
			</div>
		</TooltipProvider>
	)
}

/** Small vertical divider for button groups */
function Divider({ className = '' }: { className?: string }) {
	return <div className={`h-5 w-px bg-gray-300 mx-0.5 ${className}`} />
}

/** Draw tools as a compact button group */
interface DrawButtonGroupProps {
	mode: EditorMode
	onModeChange: (mode: EditorMode) => void
	disabled?: boolean
	small?: boolean
}

function DrawButtonGroup({ mode, onModeChange, disabled, small }: DrawButtonGroupProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8 w-8' : 'h-9 w-9'

	const drawModes = [
		{ key: 'draw_point', icon: MapPin, label: 'Draw point' },
		{ key: 'draw_linestring', icon: Route, label: 'Draw line' },
		{ key: 'draw_polygon', icon: Pentagon, label: 'Draw polygon' },
		{ key: 'draw_annotation', icon: Type, label: 'Add annotation' },
	] as const

	return (
		<TooltipProvider delayDuration={500}>
			<ButtonGroup>
				{drawModes.map(({ key, icon: Icon, label }) => (
					<Tooltip key={key}>
						<TooltipTrigger asChild>
							<Button
								size="icon"
								variant={mode === key ? 'default' : 'outline'}
								disabled={disabled}
								onClick={() => onModeChange(key)}
								className={buttonSize}
								aria-label={label}
							>
								<Icon className={iconSize} />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="bottom" sideOffset={8}>
							<p>{label}</p>
						</TooltipContent>
					</Tooltip>
				))}
			</ButtonGroup>
		</TooltipProvider>
	)
}

/** File import/export dropdown */
interface FileDropdownProps {
	onImportClick: () => void
	onExport: () => void
	canExport?: boolean
	disabled?: boolean
	small?: boolean
}

function FileDropdown({ onImportClick, onExport, canExport, disabled, small }: FileDropdownProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8' : 'h-9'

	return (
		<TooltipProvider delayDuration={500}>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" size="sm" className={`${buttonSize} gap-1 px-2`} disabled={disabled}>
								<FileUp className={iconSize} />
								<ChevronDown className="h-3 w-3" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>Import / Export GeoJSON</p>
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="start">
					<DropdownMenuItem onClick={onImportClick}>
						<Upload className="h-4 w-4" />
						Import GeoJSON
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onExport} disabled={!canExport}>
						<Download className="h-4 w-4" />
						Export GeoJSON
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</TooltipProvider>
	)
}

/** Geometry operations dropdown (merge, split, connect, boolean) */
interface GeometryOpsDropdownProps {
	disabled?: boolean
	onMerge: () => void
	onSplit: () => void
	onConnect: () => void
	onUnion: () => void
	onDifference: () => void
	canConnect?: boolean
	canBooleanOps?: boolean
	booleanOpActive?: { type: 'union' | 'difference' }
	small?: boolean
}

function GeometryOpsDropdown({
	disabled,
	onMerge,
	onSplit,
	onConnect,
	onUnion,
	onDifference,
	canConnect,
	canBooleanOps,
	booleanOpActive,
	small,
}: GeometryOpsDropdownProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8 w-8' : 'h-9 w-9'

	return (
		<TooltipProvider delayDuration={500}>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								variant={booleanOpActive ? 'default' : 'outline'}
								size="icon"
								className={buttonSize}
								disabled={disabled}
								aria-label="Geometry operations"
							>
								<Combine className={iconSize} />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>Geometry operations</p>
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="start">
					<DropdownMenuItem onClick={onMerge}>
						<Merge className="h-4 w-4" />
						Merge to Multi
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onSplit}>
						<SplitIcon className="h-4 w-4" />
						Split Multi
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onConnect} disabled={!canConnect}>
						<Link2 className="h-4 w-4" />
						Connect Lines
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={onUnion} disabled={!canBooleanOps}>
						<Combine className="h-4 w-4" />
						Boolean Union
					</DropdownMenuItem>
					<DropdownMenuItem onClick={onDifference} disabled={!canBooleanOps}>
						<Minus className="h-4 w-4" />
						Boolean Difference
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</TooltipProvider>
	)
}

/** Smart publish button that adapts based on state */
interface PublishDropdownProps {
	canPublishNew?: boolean
	canPublishUpdate?: boolean
	canPublishCopy?: boolean
	isPublishing?: boolean
	onPublishNew?: () => void
	onPublishUpdate?: () => void
	onPublishCopy?: () => void
	small?: boolean
}

function PublishDropdown({
	canPublishNew,
	canPublishUpdate,
	canPublishCopy,
	isPublishing,
	onPublishNew,
	onPublishUpdate,
	onPublishCopy,
	small,
}: PublishDropdownProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8' : 'h-9'

	// Determine primary action based on state
	const hasPrimaryAction = canPublishUpdate || canPublishNew
	const primaryIcon = canPublishUpdate ? RefreshCw : UploadCloud
	const primaryLabel = canPublishUpdate ? 'Update' : 'Publish'
	const primaryAction = canPublishUpdate ? onPublishUpdate : onPublishNew
	const PrimaryIcon = primaryIcon

	// If no actions available, show disabled button
	if (!hasPrimaryAction && !canPublishCopy) {
		return (
			<TooltipProvider delayDuration={500}>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="default"
							size="sm"
							disabled
							className={`${buttonSize} gap-1 px-2 bg-emerald-600 hover:bg-emerald-700`}
						>
							<UploadCloud className={iconSize} />
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>Publish dataset</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		)
	}

	// Show dropdown if fork is also available
	const showDropdown = canPublishCopy || (canPublishUpdate && canPublishNew)

	if (!showDropdown) {
		return (
			<TooltipProvider delayDuration={500}>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="default"
							size="sm"
							disabled={isPublishing}
							onClick={primaryAction}
							className={`${buttonSize} gap-1 px-2 bg-emerald-600 hover:bg-emerald-700`}
						>
							<PrimaryIcon className={iconSize} />
							{!small && <span className="text-xs">{primaryLabel}</span>}
						</Button>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>{primaryLabel} dataset</p>
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		)
	}

	return (
		<TooltipProvider delayDuration={500}>
			<DropdownMenu>
				<Tooltip>
					<TooltipTrigger asChild>
						<DropdownMenuTrigger asChild>
							<Button
								variant="default"
								size="sm"
								disabled={isPublishing}
								className={`${buttonSize} gap-1 px-2 bg-emerald-600 hover:bg-emerald-700`}
							>
								<PrimaryIcon className={iconSize} />
								{!small && <span className="text-xs">{primaryLabel}</span>}
								<ChevronDown className="h-3 w-3" />
							</Button>
						</DropdownMenuTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>Publish options</p>
					</TooltipContent>
				</Tooltip>
				<DropdownMenuContent align="end">
					{canPublishNew && (
						<DropdownMenuItem onClick={onPublishNew}>
							<UploadCloud className="h-4 w-4" />
							Publish new dataset
						</DropdownMenuItem>
					)}
					{canPublishUpdate && (
						<DropdownMenuItem onClick={onPublishUpdate}>
							<RefreshCw className="h-4 w-4" />
							Update existing
						</DropdownMenuItem>
					)}
					{canPublishCopy && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={onPublishCopy}>
								<CopyPlus className="h-4 w-4" />
								Fork as new dataset
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		</TooltipProvider>
	)
}

/** OSM Import popover */
interface OsmImportPopoverProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	osmQueryFilter: string
	onOsmFilterChange: (filter: string) => void
	onOsmClickMode: () => void
	onOsmQueryView: () => void
	onOsmAdvanced?: () => void
	isClickMode?: boolean
	small?: boolean
}

function OsmImportPopover({
	open,
	onOpenChange,
	osmQueryFilter,
	onOsmFilterChange,
	onOsmClickMode,
	onOsmQueryView,
	onOsmAdvanced,
	isClickMode,
	small,
}: OsmImportPopoverProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8 w-8' : 'h-9 w-9'

	return (
		<TooltipProvider delayDuration={500}>
			<Popover open={open} onOpenChange={onOpenChange}>
				<Tooltip>
					<TooltipTrigger asChild>
						<PopoverTrigger asChild>
							<Button
								size="icon"
								variant={isClickMode ? 'default' : 'outline'}
								className={buttonSize}
								aria-label="OSM Import"
							>
								<Sparkles className={iconSize} />
							</Button>
						</PopoverTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>OSM Import</p>
					</TooltipContent>
				</Tooltip>

				<PopoverContent className="w-64 p-3" side="bottom" align="start">
					<div className="space-y-3">
						<div className="text-sm font-medium">Import from OpenStreetMap</div>

						<div className="space-y-2">
							<div className="text-xs text-muted-foreground font-medium">Feature Type</div>
							<Select value={osmQueryFilter} onValueChange={onOsmFilterChange}>
								<SelectTrigger className="h-8 text-sm">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{OSM_FILTER_PRESETS.map((preset) => (
										<SelectItem key={preset.value} value={preset.value}>
											{preset.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<div className="flex gap-1">
								<Button
									variant="outline"
									size="sm"
									className="flex-1 gap-1.5 text-xs"
									onClick={onOsmClickMode}
								>
									<MousePointerClick className="h-3.5 w-3.5" />
									Click on Map
								</Button>
								<Button
									variant="outline"
									size="sm"
									className="flex-1 gap-1.5 text-xs"
									onClick={onOsmQueryView}
								>
									<Scan className="h-3.5 w-3.5" />
									Query View
								</Button>
							</div>
							{onOsmAdvanced && (
								<Button
									variant="ghost"
									size="sm"
									className="w-full justify-start gap-2 text-xs text-muted-foreground"
									onClick={onOsmAdvanced}
								>
									<Settings2 className="h-3.5 w-3.5" />
									Advanced...
								</Button>
							)}
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</TooltipProvider>
	)
}

/** Session button with accent color for create/cancel */
interface SessionButtonProps {
	viewMode: 'edit' | 'view'
	onStartNew?: () => void
	onCancel?: () => void
	small?: boolean
}

function SessionButton({ viewMode, onStartNew, onCancel, small }: SessionButtonProps) {
	const iconSize = small ? 'h-3.5 w-3.5' : 'h-4 w-4'
	const buttonSize = small ? 'h-8 w-8' : 'h-9 w-9'

	const isEditing = viewMode === 'edit'

	return (
		<TooltipProvider delayDuration={500}>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						size="icon"
						variant={isEditing ? 'destructive' : 'default'}
						onClick={isEditing ? onCancel : onStartNew}
						className={`${buttonSize} ${!isEditing ? 'bg-violet-600 hover:bg-violet-700' : ''}`}
						aria-label={isEditing ? 'Cancel editing' : 'New dataset'}
					>
						{isEditing ? (
							<XCircle className={iconSize} />
						) : (
							<PlusCircle className={iconSize} />
						)}
					</Button>
				</TooltipTrigger>
				<TooltipContent side="bottom" sideOffset={8}>
					<p>{isEditing ? 'Discard changes and exit' : 'Start a new dataset'}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}

interface DatasetActionsProps {
	onExport?: () => void
	canExport?: boolean
	onImport?: (file: File) => void
	onClear?: () => void
	canClear?: boolean
	onPublishNew?: () => void
	canPublishNew?: boolean
	onPublishUpdate?: () => void
	canPublishUpdate?: boolean
	onPublishCopy?: () => void
	canPublishCopy?: boolean
	isPublishing?: boolean
}

interface ToolbarProps {
	datasetActions?: DatasetActionsProps
	isMobile?: boolean
	showLogin?: boolean
	onSearchResultSelect?: (result: GeoSearchResult) => void
	onInspectorDeactivate?: () => void
	onStartNewDataset?: () => void
	onCancelEditing?: () => void
	onOsmQueryClick?: () => void
	onOsmQueryView?: () => void
	onOsmAdvanced?: () => void
}

export function Toolbar({
	datasetActions,
	isMobile = false,
	showLogin = true,
	onSearchResultSelect,
	onInspectorDeactivate,
	onStartNewDataset,
	onCancelEditing,
	onOsmQueryClick,
	onOsmQueryView,
	onOsmAdvanced,
}: ToolbarProps) {
	const editor = useEditorStore((state) => state.editor)
	const mode = useEditorStore((state) => state.mode)
	const setMode = useEditorStore((state) => state.setMode)
	const snappingEnabled = useEditorStore((state) => state.snappingEnabled)
	const setSnappingEnabled = useEditorStore((state) => state.setSnappingEnabled)
	const viewMode = useEditorStore((state) => state.viewMode)
	const history = useEditorStore((state) => state.history)
	const setHistoryState = useEditorStore((state) => state.setHistoryState)

	// UI State
	const mobileToolsOpen = useEditorStore((state) => state.mobileToolsOpen)
	const mobileSearchOpen = useEditorStore((state) => state.mobileSearchOpen)
	const mobileActionsOpen = useEditorStore((state) => state.mobileActionsOpen)
	const inspectorActive = useEditorStore((state) => state.inspectorActive)
	const setInspectorActive = useEditorStore((state) => state.setInspectorActive)
	const showMapSettings = useEditorStore((state) => state.showMapSettings)
	const setShowMapSettings = useEditorStore((state) => state.setShowMapSettings)

	// Focus state for share button
	const focusedNaddr = useEditorStore((state) => state.focusedNaddr)
	const focusedType = useEditorStore((state) => state.focusedType)
	const clearFocused = useEditorStore((state) => state.clearFocused)
	const isFocused = Boolean(focusedNaddr && focusedType)

	// OSM Query state
	const osmQueryMode = useEditorStore((state) => state.osmQueryMode)
	const osmQueryFilter = useEditorStore((state) => state.osmQueryFilter)
	const setOsmQueryFilter = useEditorStore((state) => state.setOsmQueryFilter)
	const setOsmQueryMode = useEditorStore((state) => state.setOsmQueryMode)

	// Search State
	const searchQuery = useEditorStore((state) => state.searchQuery)
	const searchResults = useEditorStore((state) => state.searchResults)
	const searchLoading = useEditorStore((state) => state.searchLoading)
	const searchError = useEditorStore((state) => state.searchError)
	const setSearchQuery = useEditorStore((state) => state.setSearchQuery)
	const performSearch = useEditorStore((state) => state.performSearch)
	const clearSearch = useEditorStore((state) => state.clearSearch)

	const fileInputRef = useRef<HTMLInputElement>(null)
	const [sharePopoverOpen, setSharePopoverOpen] = useState(false)
	const [copiedUrl, setCopiedUrl] = useState(false)
	const [magicPopoverOpen, setMagicPopoverOpen] = useState(false)

	// Computed: Is editing disabled (view mode active)?
	const isEditingDisabled = viewMode !== 'edit'

	const handleModeChange = (newMode: EditorMode) => {
		if (inspectorActive) {
			setInspectorActive(false)
			onInspectorDeactivate?.()
		}
		setMode(newMode)
	}

	const handleUndo = () => {
		editor?.undo()
		setHistoryState(editor?.history.canUndo() ?? false, editor?.history.canRedo() ?? false)
	}

	const handleRedo = () => {
		editor?.redo()
		setHistoryState(editor?.history.canUndo() ?? false, editor?.history.canRedo() ?? false)
	}

	const handleToggleSnapping = () => {
		setSnappingEnabled(!snappingEnabled)
	}

	const handleToggleInspector = () => {
		if (inspectorActive) {
			setInspectorActive(false)
			onInspectorDeactivate?.()
		} else {
			setInspectorActive(true)
			if (mode !== 'select') {
				setMode('select')
			}
		}
	}

	const handleSearchSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		performSearch()
	}

	const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file && datasetActions?.onImport) {
			datasetActions.onImport(file)
		}
		if (fileInputRef.current) {
			fileInputRef.current.value = ''
		}
	}

	const handleDeleteSelected = () => {
		const selected = editor?.getSelectedFeatures()
		if (selected && selected.length > 0) {
			editor?.deleteFeatures(selected.map((f) => f.id))
		}
	}

	const handleMergeSelected = () => {
		editor?.combineSelectedFeatures()
	}

	const handleSplitSelected = () => {
		editor?.splitSelectedFeatures()
	}

	const handleDuplicate = () => {
		editor?.duplicateSelectedFeatures()
	}

	const handleBooleanUnion = () => {
		editor?.startBooleanUnion()
	}

	const handleBooleanDifference = () => {
		editor?.startBooleanDifference()
	}

	const handleConnectLines = () => {
		editor?.connectSelectedLines()
	}

	const handleCopyShareUrl = async () => {
		const url = window.location.href
		try {
			await navigator.clipboard.writeText(url)
			setCopiedUrl(true)
			setTimeout(() => setCopiedUrl(false), 2000)
		} catch (error) {
			console.error('Failed to copy URL:', error)
		}
	}

	const handleExitFocus = () => {
		clearFocused()
		window.location.hash = '/'
		setSharePopoverOpen(false)
	}

	const handleOsmClickMode = () => {
		setOsmQueryMode('click')
		onOsmQueryClick?.()
		setMagicPopoverOpen(false)
	}

	const handleOsmQueryView = () => {
		onOsmQueryView?.()
		setMagicPopoverOpen(false)
	}

	// Check if single polygon is selected (required for boolean ops)
	const selectedFeatures = editor?.getSelectedFeatures() ?? []
	const singlePolygonSelected = selectedFeatures.length === 1 && 
		(selectedFeatures[0]?.geometry.type === 'Polygon' || selectedFeatures[0]?.geometry.type === 'MultiPolygon')
	const booleanOpActive = editor?.getBooleanOperation()
	const canConnectLines = editor?.canConnectSelectedLines() ?? false

	// ============================================
	// BUTTON SECTIONS - Organized by function
	// ============================================

	// Section 1: Select
	const selectButtons: ToolbarButton[] = [
		{
			key: 'select',
			icon: MousePointer2,
			onClick: () => handleModeChange('select'),
			variant: mode === 'select' && !inspectorActive ? 'default' : 'outline',
			disabled: isEditingDisabled,
			ariaLabel: 'Select mode',
			description: 'Select and move features',
		},
		{
			key: 'box_select',
			icon: SquareDashedMousePointer,
			onClick: () => handleModeChange('box_select'),
			variant: mode === 'box_select' ? 'default' : 'outline',
			disabled: isEditingDisabled,
			ariaLabel: 'Box select mode',
			description: 'Drag to select multiple features',
		},
	]

	// Section 2: History (Undo/Redo)
	const historyButtons: ToolbarButton[] = [
		{
			key: 'undo',
			icon: Undo2,
			onClick: handleUndo,
			disabled: !history.canUndo || isEditingDisabled,
			ariaLabel: 'Undo',
			description: 'Undo last action',
		},
		{
			key: 'redo',
			icon: Redo2,
			onClick: handleRedo,
			disabled: !history.canRedo || isEditingDisabled,
			ariaLabel: 'Redo',
			description: 'Redo last action',
		},
	]

	// Section 3: Edit tools (basic operations - geometry ops are in separate dropdown)
	const editButtons: ToolbarButton[] = [
		{
			key: 'snapping',
			icon: Magnet,
			onClick: handleToggleSnapping,
			variant: snappingEnabled ? 'default' : 'outline',
			disabled: isEditingDisabled,
			ariaLabel: 'Toggle snapping',
			description: 'Snap to nearby points',
		},
		{
			key: 'edit',
			icon: Edit3,
			onClick: () => handleModeChange('edit'),
			variant: mode === 'edit' ? 'default' : 'outline',
			disabled: isEditingDisabled,
			ariaLabel: 'Edit vertices',
			description: 'Edit vertices of selected feature',
		},
		{
			key: 'delete',
			icon: Trash2,
			onClick: handleDeleteSelected,
			disabled: isEditingDisabled,
			ariaLabel: 'Delete',
			description: 'Delete selected features',
		},
		{
			key: 'duplicate',
			icon: Copy,
			onClick: handleDuplicate,
			disabled: isEditingDisabled,
			ariaLabel: 'Duplicate',
			description: 'Duplicate selected features',
		},
	]

	// Section 4: Lookup/Inspector
	const lookupButtons: ToolbarButton[] = [
		{
			key: 'reverse-lookup',
			icon: Crosshair,
			onClick: handleToggleInspector,
			variant: inspectorActive ? 'default' : 'outline',
			ariaLabel: 'Location lookup',
			description: 'Click map to get location info',
		},
	]

	// ============================================
	// MOBILE TOOLBAR
	// ============================================
	if (isMobile) {
		return (
			<>
				<div className="pointer-events-auto w-full max-w-md px-2 mx-auto">
					{mobileToolsOpen && (
						<div className="glass-panel rounded-lg p-1.5">
							{/* Row 1: Session + Select + Draw */}
							<div className="flex items-center justify-center gap-1 flex-wrap mb-1">
								<SessionButton
									viewMode={viewMode}
									onStartNew={onStartNewDataset}
									onCancel={onCancelEditing}
									small
								/>
								<Divider />
								<IconButtonRow buttons={selectButtons} small />
								<Divider />
								<DrawButtonGroup
									mode={mode}
									onModeChange={handleModeChange}
									disabled={isEditingDisabled}
									small
								/>
							</div>
							{/* Row 2: History + Edit tools + Geometry ops */}
							<div className="flex items-center justify-center gap-1 flex-wrap">
								<IconButtonRow buttons={historyButtons} small />
								<Divider />
								<IconButtonRow buttons={editButtons} small />
								<GeometryOpsDropdown
									disabled={isEditingDisabled}
									onMerge={handleMergeSelected}
									onSplit={handleSplitSelected}
									onConnect={handleConnectLines}
									onUnion={handleBooleanUnion}
									onDifference={handleBooleanDifference}
									canConnect={canConnectLines}
									canBooleanOps={singlePolygonSelected}
									booleanOpActive={booleanOpActive}
									small
								/>
							</div>
						</div>
					)}

					{mobileSearchOpen && (
						<div className="glass-panel flex flex-col gap-2 rounded-lg p-1.5">
							<div className="flex items-center gap-2">
								<SearchBar
									query={searchQuery}
									loading={searchLoading}
									placeholder="Search..."
									onSubmit={(e) => {
										e.preventDefault()
										handleSearchSubmit(e)
									}}
									onQueryChange={setSearchQuery}
									onClear={clearSearch}
								/>
								<IconButtonRow buttons={lookupButtons} small />
							</div>
							{searchResults && searchResults.length > 0 && (
								<div className="max-h-48 overflow-y-auto space-y-1 bg-white rounded-lg border border-gray-100">
									{searchResults.map((result) => (
										<button
											type="button"
											key={result.placeId}
											className="w-full text-left text-sm p-2 hover:bg-gray-50 border-b border-gray-50 last:border-0 truncate"
											onClick={() => onSearchResultSelect?.(result)}
										>
											{result.displayName}
										</button>
									))}
								</div>
							)}
							{searchError && <div className="text-xs text-red-600 px-1">{searchError}</div>}
						</div>
					)}

					{mobileActionsOpen && datasetActions && (
						<div className="glass-panel rounded-lg p-1.5">
							<div className="flex items-center justify-center gap-1 flex-wrap">
								<FileDropdown
									onImportClick={() => fileInputRef.current?.click()}
									onExport={datasetActions.onExport ?? (() => {})}
									canExport={datasetActions.canExport}
									disabled={isEditingDisabled}
									small
								/>
								<OsmImportPopover
									open={magicPopoverOpen}
									onOpenChange={setMagicPopoverOpen}
									osmQueryFilter={osmQueryFilter}
									onOsmFilterChange={setOsmQueryFilter}
									onOsmClickMode={handleOsmClickMode}
									onOsmQueryView={handleOsmQueryView}
									onOsmAdvanced={onOsmAdvanced}
									isClickMode={osmQueryMode === 'click'}
									small
								/>
								<CreateMapPopover />
								<Divider />
								<PublishDropdown
									canPublishNew={datasetActions.canPublishNew}
									canPublishUpdate={datasetActions.canPublishUpdate}
									canPublishCopy={datasetActions.canPublishCopy}
									isPublishing={datasetActions.isPublishing}
									onPublishNew={datasetActions.onPublishNew}
									onPublishUpdate={datasetActions.onPublishUpdate}
									onPublishCopy={datasetActions.onPublishCopy}
									small
								/>
								<Divider />
								<HelpPopover
									multiSelectModifier={editor?.getMultiSelectModifierLabel() ?? 'Shift'}
								/>
								<TooltipProvider delayDuration={500}>
									<Popover open={showMapSettings} onOpenChange={setShowMapSettings}>
										<Tooltip>
											<TooltipTrigger asChild>
												<PopoverTrigger asChild>
													<Button
														variant={showMapSettings ? 'default' : 'outline'}
														size="icon"
														className="h-8 w-8"
														aria-label="Settings"
													>
														<Settings2 className="h-3.5 w-3.5" />
													</Button>
												</PopoverTrigger>
											</TooltipTrigger>
											<TooltipContent side="bottom" sideOffset={8}>
												<p>Map settings</p>
											</TooltipContent>
										</Tooltip>
										<PopoverContent className="w-72" side="bottom" align="center">
											<MapSettingsPanel />
										</PopoverContent>
									</Popover>
								</TooltipProvider>
								{showLogin && <LoginSessionButtons />}
							</div>
							<input
								type="file"
								ref={fileInputRef}
								className="hidden"
								accept=".geojson,.json"
								onChange={handleFileImport}
							/>
						</div>
					)}
				</div>
			</>
		)
	}

	// ============================================
	// DESKTOP TOOLBAR
	// ============================================
	return (
		<div className="flex flex-col gap-2 pointer-events-auto">
			<div className="glass-panel flex flex-wrap items-center gap-1 rounded-lg p-1.5">
				{/* Row 1: Core editing tools */}
				<div className="flex items-center gap-1">
					{/* Sidebar toggle */}
					<SidebarTrigger className="h-9 w-9" />
					<Divider />

					{/* Session control (New Dataset / Cancel) */}
					<SessionButton
						viewMode={viewMode}
						onStartNew={onStartNewDataset}
						onCancel={onCancelEditing}
					/>
					<Divider />

					{/* Select */}
					<IconButtonRow buttons={selectButtons} />
					<Divider />

					{/* Draw */}
					<DrawButtonGroup
						mode={mode}
						onModeChange={handleModeChange}
						disabled={isEditingDisabled}
					/>
					<Divider />

					{/* History */}
					<IconButtonRow buttons={historyButtons} />
					<Divider />

					{/* Edit */}
					<IconButtonRow buttons={editButtons} />
					<GeometryOpsDropdown
						disabled={isEditingDisabled}
						onMerge={handleMergeSelected}
						onSplit={handleSplitSelected}
						onConnect={handleConnectLines}
						onUnion={handleBooleanUnion}
						onDifference={handleBooleanDifference}
						canConnect={canConnectLines}
						canBooleanOps={singlePolygonSelected}
						booleanOpActive={booleanOpActive}
					/>
				</div>

				{/* Flexible spacer - grows on wide screens, shrinks/wraps on narrow */}
				<div className="flex-1 min-w-4" />

				{/* Row 2: Search, data & publish tools */}
				<div className="flex items-center gap-1">
					{/* Search */}
					<div className="relative">
						<SearchBar
							query={searchQuery}
							loading={searchLoading}
							placeholder="Search location..."
							onSubmit={handleSearchSubmit}
							onQueryChange={setSearchQuery}
							onClear={clearSearch}
							className="w-48"
						/>
						{searchResults && searchResults.length > 0 && (
							<div className="absolute top-full left-0 mt-2 w-64 rounded-lg bg-white p-2 shadow-lg z-50 border border-gray-100">
								<div className="flex items-center justify-between border-b border-gray-100 pb-2 mb-2">
									<span className="text-xs font-medium text-gray-500">Results</span>
									<Button
										variant="ghost"
										size="sm"
										className="h-auto p-0 text-xs"
										onClick={clearSearch}
									>
										Close
									</Button>
								</div>
								<div className="max-h-60 overflow-y-auto space-y-1">
									{searchResults.map((result) => (
										<button
											type="button"
											key={result.placeId}
											className="w-full text-left text-sm p-1.5 hover:bg-gray-50 rounded truncate"
											onClick={() => onSearchResultSelect?.(result)}
										>
											{result.displayName}
										</button>
									))}
								</div>
							</div>
						)}
					</div>

					{/* Lookup */}
					<IconButtonRow buttons={lookupButtons} />
					<Divider />

					{/* File, OSM, Map & Publish */}
					<FileDropdown
						onImportClick={() => fileInputRef.current?.click()}
						onExport={datasetActions?.onExport ?? (() => {})}
						canExport={datasetActions?.canExport}
						disabled={isEditingDisabled}
					/>
					<OsmImportPopover
						open={magicPopoverOpen}
						onOpenChange={setMagicPopoverOpen}
						osmQueryFilter={osmQueryFilter}
						onOsmFilterChange={setOsmQueryFilter}
						onOsmClickMode={handleOsmClickMode}
						onOsmQueryView={handleOsmQueryView}
						onOsmAdvanced={onOsmAdvanced}
						isClickMode={osmQueryMode === 'click'}
					/>
					<CreateMapPopover />
					<PublishDropdown
						canPublishNew={datasetActions?.canPublishNew}
						canPublishUpdate={datasetActions?.canPublishUpdate}
						canPublishCopy={datasetActions?.canPublishCopy}
						isPublishing={datasetActions?.isPublishing}
						onPublishNew={datasetActions?.onPublishNew}
						onPublishUpdate={datasetActions?.onPublishUpdate}
						onPublishCopy={datasetActions?.onPublishCopy}
					/>

					{/* Share button - only visible when focused on a route */}
					{isFocused && (
						<>
							<Divider />
							<TooltipProvider delayDuration={500}>
								<Popover open={sharePopoverOpen} onOpenChange={setSharePopoverOpen}>
									<Tooltip>
										<TooltipTrigger asChild>
											<PopoverTrigger asChild>
												<Button
													variant="default"
													size="icon"
													aria-label="Share"
												>
													<Share2 className="h-4 w-4" />
												</Button>
											</PopoverTrigger>
										</TooltipTrigger>
										<TooltipContent side="bottom" sideOffset={8}>
											<p>Share this view</p>
										</TooltipContent>
									</Tooltip>
									<PopoverContent className="w-64" side="bottom" align="end">
										<div className="space-y-3">
											<div>
												<h4 className="text-sm font-semibold mb-1">Share this view</h4>
												<p className="text-xs text-gray-500">
													Others will see only this {focusedType === 'collection' ? 'collection' : 'dataset'}.
												</p>
											</div>
											<div className="flex flex-col gap-2">
												<Button
													size="sm"
													variant="outline"
													className="w-full justify-start"
													onClick={handleCopyShareUrl}
												>
													{copiedUrl ? (
														<>
															<Check className="h-4 w-4 mr-2 text-green-600" />
															Copied!
														</>
													) : (
														<>
															<Copy className="h-4 w-4 mr-2" />
															Copy link
														</>
													)}
												</Button>
												<Button
													size="sm"
													variant="ghost"
													className="w-full justify-start text-gray-600"
													onClick={handleExitFocus}
												>
													<X className="h-4 w-4 mr-2" />
													Exit focus mode
												</Button>
											</div>
										</div>
									</PopoverContent>
								</Popover>
							</TooltipProvider>
						</>
					)}
				</div>

				<input
					type="file"
					ref={fileInputRef}
					className="hidden"
					accept=".geojson,.json"
					onChange={handleFileImport}
				/>
			</div>

			{searchError && (
				<div className="rounded-lg bg-red-50 p-2 text-xs text-red-600 shadow-sm self-start">
					{searchError}
				</div>
			)}
		</div>
	)
}

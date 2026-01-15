import {
	Combine,
	Copy,
	CopyPlus,
	Crosshair,
	Download,
	Edit3,
	FilePenLine,
	Layers,
	Link2,
	Magnet,
	MapPin,
	MapPinned,
	Merge,
	Minus,
	MousePointer2,
	Pentagon,
	PlusCircle,
	Redo2,
	RefreshCw,
	Route,
	Settings2,
	Share2,
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
import { Popover, PopoverContent, PopoverTrigger } from '../../../components/ui/popover'
import { SearchBar } from '../../../components/ui/search-bar'
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '../../../components/ui/tooltip'
import type { EditorMode } from '../core'
import { useEditorStore } from '../store'
import type { GeoSearchResult } from '../types'
import { MapSettingsPanel } from './MapSettingsPanel'
import { OsmQueryPopover } from './OsmQueryPopover'

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
	const showDatasetsPanel = useEditorStore((state) => state.showDatasetsPanel)
	const setShowDatasetsPanel = useEditorStore((state) => state.setShowDatasetsPanel)
	const showInfoPanel = useEditorStore((state) => state.showInfoPanel)
	const setShowInfoPanel = useEditorStore((state) => state.setShowInfoPanel)
	const setMobileActiveState = useEditorStore((state) => state.setMobileActiveState)
	const mobileDatasetsOpen = useEditorStore((state) => state.mobileDatasetsOpen)
	const setMobileDatasetsOpen = useEditorStore((state) => state.setMobileDatasetsOpen)
	const mobileInfoOpen = useEditorStore((state) => state.mobileInfoOpen)
	const setMobileInfoOpen = useEditorStore((state) => state.setMobileInfoOpen)
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

	const handleToggleDatasets = () => {
		if (isMobile) {
			// Only close the other drawer, preserve toolbar state
			setMobileInfoOpen(false)
			setMobileDatasetsOpen(!mobileDatasetsOpen)
		} else {
			setShowDatasetsPanel(!showDatasetsPanel)
		}
	}

	const handleToggleInfo = () => {
		if (isMobile) {
			// Only close the other drawer, preserve toolbar state
			setMobileDatasetsOpen(false)
			setMobileInfoOpen(!mobileInfoOpen)
		} else {
			setShowInfoPanel(!showInfoPanel)
		}
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

	const handleToggleMapSettings = () => {
		setShowMapSettings(!showMapSettings)
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

	// Check if single polygon is selected (required for boolean ops)
	const selectedFeatures = editor?.getSelectedFeatures() ?? []
	const singlePolygonSelected = selectedFeatures.length === 1 && 
		(selectedFeatures[0]?.geometry.type === 'Polygon' || selectedFeatures[0]?.geometry.type === 'MultiPolygon')
	const booleanOpActive = editor?.getBooleanOperation()
	const canConnectLines = editor?.canConnectSelectedLines() ?? false

	const datasetsOpen = isMobile ? mobileDatasetsOpen : showDatasetsPanel
	const infoPanelOpen = isMobile ? mobileInfoOpen : showInfoPanel

	// ============================================
	// BUTTON SECTIONS - Organized by function
	// ============================================

	// Section 0: Session control (New Dataset / Cancel)
	const sessionButtons: ToolbarButton[] = viewMode === 'edit'
		? [
			{
				key: 'cancel',
				icon: XCircle,
				onClick: onCancelEditing ?? (() => {}),
				ariaLabel: 'Cancel editing',
				description: 'Discard changes and exit',
			},
		]
		: [
			{
				key: 'new-dataset',
				icon: PlusCircle,
				onClick: onStartNewDataset ?? (() => {}),
				ariaLabel: 'New dataset',
				description: 'Start a new dataset',
			},
		]

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

	// Section 2: Draw tools
	const drawButtons: ToolbarButton[] = [
		{
			key: 'point',
			icon: MapPin,
			onClick: () => handleModeChange('draw_point'),
			variant: mode === 'draw_point' ? 'default' : 'outline',
			disabled: isEditingDisabled,
			ariaLabel: 'Draw point',
			description: 'Draw a point marker',
		},
		{
			key: 'line',
			icon: Route,
			onClick: () => handleModeChange('draw_linestring'),
			variant: mode === 'draw_linestring' ? 'default' : 'outline',
			disabled: isEditingDisabled,
			ariaLabel: 'Draw line',
			description: 'Draw a line or route',
		},
		{
			key: 'polygon',
			icon: Pentagon,
			onClick: () => handleModeChange('draw_polygon'),
			variant: mode === 'draw_polygon' ? 'default' : 'outline',
			disabled: isEditingDisabled,
			ariaLabel: 'Draw polygon',
			description: 'Draw a polygon area',
		},
		{
			key: 'annotation',
			icon: Type,
			onClick: () => handleModeChange('draw_annotation'),
			variant: mode === 'draw_annotation' ? 'default' : 'outline',
			disabled: isEditingDisabled,
			ariaLabel: 'Draw annotation',
			description: 'Add a text annotation',
		},
	]

	// Section 3: History (Undo/Redo)
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

	// Section 4: Edit tools
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
			key: 'merge',
			icon: Merge,
			onClick: handleMergeSelected,
			disabled: isEditingDisabled,
			ariaLabel: 'Merge',
			description: 'Merge selected features',
		},
		{
			key: 'split',
			icon: SplitIcon,
			onClick: handleSplitSelected,
			disabled: isEditingDisabled,
			ariaLabel: 'Split',
			description: 'Split feature at vertex',
		},
		{
			key: 'duplicate',
			icon: Copy,
			onClick: handleDuplicate,
			disabled: isEditingDisabled,
			ariaLabel: 'Duplicate',
			description: 'Duplicate selected features',
		},
		{
			key: 'connect-lines',
			icon: Link2,
			onClick: handleConnectLines,
			disabled: isEditingDisabled || !canConnectLines,
			ariaLabel: 'Connect lines',
			description: 'Connect two lines at overlapping endpoints',
		},
		{
			key: 'union',
			icon: Combine,
			onClick: handleBooleanUnion,
			disabled: isEditingDisabled || !singlePolygonSelected,
			variant: booleanOpActive?.type === 'union' ? 'default' : 'outline',
			ariaLabel: 'Union',
			description: 'Union: combine two polygons',
		},
		{
			key: 'difference',
			icon: Minus,
			onClick: handleBooleanDifference,
			disabled: isEditingDisabled || !singlePolygonSelected,
			variant: booleanOpActive?.type === 'difference' ? 'default' : 'outline',
			ariaLabel: 'Difference',
			description: 'Difference: subtract second polygon',
		},
	]

	// Section 5: Lookup/Inspector
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

	// Section 6: File operations
	const fileButtons: ToolbarButton[] = [
		{
			key: 'import',
			icon: Upload,
			onClick: () => fileInputRef.current?.click(),
			ariaLabel: 'Import',
			description: 'Import GeoJSON file',
		},
		// OSM import moved to OsmQueryPopover
		{
			key: 'export',
			icon: Download,
			onClick: datasetActions?.onExport ?? (() => {}),
			disabled: !datasetActions?.canExport,
			ariaLabel: 'Export',
			description: 'Export as GeoJSON',
		},
	]

	// Section 7: Publish actions
	const publishButtons: ToolbarButton[] = [
		{
			key: 'publish-new',
			icon: UploadCloud,
			onClick: datasetActions?.onPublishNew ?? (() => {}),
			disabled: !datasetActions?.canPublishNew || datasetActions?.isPublishing,
			ariaLabel: 'Publish new',
			description: 'Publish as new dataset',
		},
		{
			key: 'publish-update',
			icon: RefreshCw,
			onClick: datasetActions?.onPublishUpdate ?? (() => {}),
			disabled: !datasetActions?.canPublishUpdate || datasetActions?.isPublishing,
			ariaLabel: 'Update',
			description: 'Update existing dataset',
		},
		{
			key: 'publish-copy',
			icon: CopyPlus,
			onClick: datasetActions?.onPublishCopy ?? (() => {}),
			disabled: !datasetActions?.canPublishCopy || datasetActions?.isPublishing,
			ariaLabel: 'Fork',
			description: 'Fork as new dataset',
		},
	]

	// Section 8: Panel toggles
	const panelButtons: ToolbarButton[] = [
		{
			key: 'datasets',
			icon: Layers,
			onClick: handleToggleDatasets,
			variant: datasetsOpen ? 'default' : 'outline',
			ariaLabel: 'Datasets',
			description: 'Toggle datasets panel',
		},
		{
			key: 'info',
			icon: FilePenLine,
			onClick: handleToggleInfo,
			variant: infoPanelOpen ? 'default' : 'outline',
			ariaLabel: 'Editor',
			description: 'Toggle editor panel',
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
								<IconButtonRow buttons={sessionButtons} small />
								<Divider />
								<IconButtonRow buttons={selectButtons} small />
								<Divider />
								<IconButtonRow buttons={drawButtons} small />
							</div>
							{/* Row 2: History + Edit tools */}
							<div className="flex items-center justify-center gap-1 flex-wrap">
								<IconButtonRow buttons={historyButtons} small />
								<Divider />
								<IconButtonRow buttons={editButtons} small />
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
								<IconButtonRow buttons={fileButtons} small />
								<Divider />
								<IconButtonRow buttons={publishButtons} small />
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
			<div className="glass-panel flex items-center gap-1 rounded-lg p-1.5">
				{/* Session control (New Dataset / Cancel) */}
				<IconButtonRow buttons={sessionButtons} />
				<Divider />

				{/* Select */}
				<IconButtonRow buttons={selectButtons} />
				<Divider />

				{/* Draw */}
				<IconButtonRow buttons={drawButtons} />
				<Divider />

				{/* History */}
				<IconButtonRow buttons={historyButtons} />
				<Divider />

				{/* Edit */}
				<IconButtonRow buttons={editButtons} />
				<Divider />

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

					{/* File & Publish */}
				<IconButtonRow buttons={fileButtons} />
				<OsmQueryPopover
					onQueryClick={onOsmQueryClick ?? (() => {})}
					onQueryView={onOsmQueryView ?? (() => {})}
					onAdvanced={onOsmAdvanced ?? (() => {})}
				/>
				<IconButtonRow buttons={publishButtons} />

				<input
					type="file"
					ref={fileInputRef}
					className="hidden"
					accept=".geojson,.json"
					onChange={handleFileImport}
				/>
				<Divider />

				{/* Panels */}
				<IconButtonRow buttons={panelButtons} />

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

				<div className="flex-1" />

				{/* Settings Popover */}
				<TooltipProvider delayDuration={500}>
					<Popover open={showMapSettings} onOpenChange={setShowMapSettings}>
						<Tooltip>
							<TooltipTrigger asChild>
								<PopoverTrigger asChild>
									<Button
										variant={showMapSettings ? 'default' : 'outline'}
										size="icon"
										aria-label="Settings"
									>
										<Settings2 className="h-4 w-4" />
									</Button>
								</PopoverTrigger>
							</TooltipTrigger>
							<TooltipContent side="bottom" sideOffset={8}>
								<p>Map settings</p>
							</TooltipContent>
						</Tooltip>
						<PopoverContent className="w-80" side="bottom" align="end">
							<MapSettingsPanel />
						</PopoverContent>
					</Popover>
				</TooltipProvider>

				<HelpPopover multiSelectModifier={editor?.getMultiSelectModifierLabel() ?? 'Shift'} />

				{showLogin && <LoginSessionButtons />}
			</div>

			{searchError && (
				<div className="rounded-lg bg-red-50 p-2 text-xs text-red-600 shadow-sm self-start">
					{searchError}
				</div>
			)}
		</div>
	)
}

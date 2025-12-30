import {
	CopyPlus,
	Crosshair,
	Download,
	Edit3,
	FilePenLine,
	Layers,
	Magnet,
	MapPin,
	Merge,
	MousePointer2,
	Pentagon,
	Redo2,
	RefreshCw,
	Route,
	Settings2,
	Split as SplitIcon,
	Trash2,
	Type,
	Undo2,
	Upload,
	UploadCloud,
} from 'lucide-react'
import type React from 'react'
import { useRef } from 'react'
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
}

export function Toolbar({
	datasetActions,
	isMobile = false,
	showLogin = true,
	onSearchResultSelect,
	onInspectorDeactivate,
}: ToolbarProps) {
	const editor = useEditorStore((state) => state.editor)
	const mode = useEditorStore((state) => state.mode)
	const setMode = useEditorStore((state) => state.setMode)
	const snappingEnabled = useEditorStore((state) => state.snappingEnabled)
	const setSnappingEnabled = useEditorStore((state) => state.setSnappingEnabled)
	const history = useEditorStore((state) => state.history)
	const setHistoryState = useEditorStore((state) => state.setHistoryState)
	const viewMode = useEditorStore((state) => state.viewMode)

	// UI State
	const showDatasetsPanel = useEditorStore((state) => state.showDatasetsPanel)
	const setShowDatasetsPanel = useEditorStore((state) => state.setShowDatasetsPanel)
	const showInfoPanel = useEditorStore((state) => state.showInfoPanel)
	const setShowInfoPanel = useEditorStore((state) => state.setShowInfoPanel)
	const setMobileActiveState = useEditorStore((state) => state.setMobileActiveState)
	const mobileDatasetsOpen = useEditorStore((state) => state.mobileDatasetsOpen)
	const mobileInfoOpen = useEditorStore((state) => state.mobileInfoOpen)
	const mobileToolsOpen = useEditorStore((state) => state.mobileToolsOpen)
	const mobileSearchOpen = useEditorStore((state) => state.mobileSearchOpen)
	const mobileActionsOpen = useEditorStore((state) => state.mobileActionsOpen)
	const inspectorActive = useEditorStore((state) => state.inspectorActive)
	const setInspectorActive = useEditorStore((state) => state.setInspectorActive)
	const showMapSettings = useEditorStore((state) => state.showMapSettings)
	const setShowMapSettings = useEditorStore((state) => state.setShowMapSettings)

	// Search State
	const searchQuery = useEditorStore((state) => state.searchQuery)
	const searchResults = useEditorStore((state) => state.searchResults)
	const searchLoading = useEditorStore((state) => state.searchLoading)
	const searchError = useEditorStore((state) => state.searchError)
	const setSearchQuery = useEditorStore((state) => state.setSearchQuery)
	const performSearch = useEditorStore((state) => state.performSearch)
	const clearSearch = useEditorStore((state) => state.clearSearch)

	const fileInputRef = useRef<HTMLInputElement>(null)

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
			setMobileActiveState(mobileDatasetsOpen ? null : 'datasets')
		} else {
			setShowDatasetsPanel(!showDatasetsPanel)
		}
	}

	const handleToggleInfo = () => {
		if (isMobile) {
			setMobileActiveState(mobileInfoOpen ? null : 'info')
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

	const datasetsOpen = isMobile ? mobileDatasetsOpen : showDatasetsPanel
	const infoPanelOpen = isMobile ? mobileInfoOpen : showInfoPanel

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
			ariaLabel: 'Select mode',
			description: 'Select and move features',
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
				<div className="pointer-events-auto w-full max-w-sm mx-auto">
					{mobileToolsOpen && (
						<div className="glass-panel rounded-lg p-2">
							{/* Row 1: Select + Draw */}
							<div className="flex items-center justify-center gap-1 flex-wrap mb-1">
								<IconButtonRow buttons={selectButtons} small />
								<Divider />
								<IconButtonRow buttons={drawButtons} small />
							</div>
							{/* Row 2: History + Edit tools */}
							<div className="flex items-center justify-center gap-1 flex-wrap mb-1">
								<IconButtonRow buttons={historyButtons} small />
								<Divider />
								<IconButtonRow buttons={editButtons} small />
							</div>
							{/* Row 3: Lookup + Settings */}
							<div className="flex items-center justify-center gap-1">
								<IconButtonRow buttons={lookupButtons} small />
								<Divider />
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
							</div>
						</div>
					)}

					{mobileSearchOpen && (
						<div className="glass-panel flex flex-col gap-2 rounded-lg p-2">
							<SearchBar
								query={searchQuery}
								loading={searchLoading}
								placeholder="Search location..."
								onSubmit={(e) => {
									e.preventDefault()
									handleSearchSubmit(e)
								}}
								onQueryChange={setSearchQuery}
								onClear={clearSearch}
							/>
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
						<div className="glass-panel rounded-lg p-2">
							<div className="flex items-center justify-center gap-1 flex-wrap">
								<IconButtonRow buttons={fileButtons} small />
								<Divider />
								<IconButtonRow buttons={publishButtons} small />
								<Divider />
								<HelpPopover
									multiSelectModifier={editor?.getMultiSelectModifierLabel() ?? 'Shift'}
								/>
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

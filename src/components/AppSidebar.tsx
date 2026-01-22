import { Database, FolderOpen, Globe, PanelTop, Pencil, Settings2 } from 'lucide-react'
import type { FeatureCollection } from 'geojson'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import { GeoDatasetsPanelContent } from './GeoDatasetsPanel'
import { GeoEditorInfoPanelContent } from './GeoEditorInfoPanel'
import { HelpPopover } from './HelpPopover'
import { LoginSessionButtons } from './LoginSessionButtom'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from './ui/sidebar'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from './ui/resizable'
import { MapSettingsPanel } from '../features/geo-editor/components/MapSettingsPanel'
import { useEditorStore } from '../features/geo-editor/store'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import type { EditorFeature } from '../features/geo-editor/core'

/** Sidebar view modes */
type SidebarViewMode = 'datasets' | 'collections' | 'combined' | 'edit'

/** Navigation items for view modes */
const viewModeNavItems: {
	mode: SidebarViewMode
	title: string
	icon: typeof Database
}[] = [
	{ mode: 'datasets', title: 'Datasets', icon: Database },
	{ mode: 'collections', title: 'Collections', icon: FolderOpen },
	{ mode: 'combined', title: 'List & Editor', icon: PanelTop },
	{ mode: 'edit', title: 'Editor', icon: Pencil },
]

interface AppSidebarProps {
	geoEvents: NDKGeoEvent[]
	collectionEvents: NDKGeoCollectionEvent[]
	activeDataset: NDKGeoEvent | null
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	collectionVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	onClearEditing: () => void
	onLoadDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onToggleCollectionVisibility: (collection: NDKGeoCollectionEvent) => void
	onToggleAllCollectionVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onZoomToCollection: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectDataset: (event: NDKGeoEvent) => void
	onInspectCollection: (collection: NDKGeoCollectionEvent, datasets: NDKGeoEvent[]) => void
	onOpenDebug: (event: NDKGeoEvent | NDKGeoCollectionEvent) => void
	onCreateCollection: () => void
	onEditCollection: (collection: NDKGeoCollectionEvent) => void
	isFocused: boolean
	onExitFocus: () => void
	multiSelectModifier?: string
	// Editor panel props
	onCommentGeometryVisibility?: (commentId: string, geojson: FeatureCollection | null) => void
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	availableFeatures?: GeoFeatureItem[]
	onMentionVisibilityToggle?: (address: string, featureId: string | undefined, visible: boolean) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	collectionEditorMode?: 'none' | 'create' | 'edit'
	editingCollection?: NDKGeoCollectionEvent | null
	onSaveCollection?: (collection: NDKGeoCollectionEvent) => void
	onCloseCollectionEditor?: () => void
	onZoomToFeature?: (feature: EditorFeature) => void
	onExitViewMode?: () => void
}

export function AppSidebar({
	geoEvents,
	collectionEvents,
	activeDataset,
	currentUserPubkey,
	datasetVisibility,
	collectionVisibility,
	isPublishing,
	deletingKey,
	onClearEditing,
	onLoadDataset,
	onToggleVisibility,
	onToggleAllVisibility,
	onToggleCollectionVisibility,
	onToggleAllCollectionVisibility,
	onZoomToDataset,
	onDeleteDataset,
	getDatasetKey,
	getDatasetName,
	onZoomToCollection,
	onInspectDataset,
	onInspectCollection,
	onOpenDebug,
	onCreateCollection,
	onEditCollection,
	isFocused,
	onExitFocus,
	multiSelectModifier = 'Shift',
	// Editor panel props
	onCommentGeometryVisibility,
	onZoomToBounds,
	availableFeatures = [],
	onMentionVisibilityToggle,
	onMentionZoomTo,
	collectionEditorMode = 'none',
	editingCollection,
	onSaveCollection,
	onCloseCollectionEditor,
	onZoomToFeature,
	onExitViewMode,
}: AppSidebarProps) {
	const { state, setOpen } = useSidebar()
	const showMapSettings = useEditorStore((state) => state.showMapSettings)
	const setShowMapSettings = useEditorStore((state) => state.setShowMapSettings)
	const viewMode = useEditorStore((state) => state.sidebarViewMode)
	const setViewMode = useEditorStore((state) => state.setSidebarViewMode)

	/** Common props for GeoDatasetsPanelContent */
	const datasetsPanelProps = {
		geoEvents,
		collectionEvents,
		activeDataset,
		currentUserPubkey,
		datasetVisibility,
		collectionVisibility,
		isPublishing,
		deletingKey,
		onClearEditing,
		onLoadDataset,
		onToggleVisibility,
		onToggleAllVisibility,
		onToggleCollectionVisibility,
		onToggleAllCollectionVisibility,
		onZoomToDataset,
		onDeleteDataset,
		getDatasetKey,
		getDatasetName,
		onZoomToCollection,
		onInspectDataset,
		onInspectCollection,
		onOpenDebug,
		onClose: () => {},
		onCreateCollection,
		onEditCollection,
		isFocused,
		onExitFocus,
	}

	/** Common props for GeoEditorInfoPanelContent */
	const editorPanelProps = {
		currentUserPubkey,
		onLoadDataset,
		onToggleVisibility,
		onZoomToDataset,
		onDeleteDataset,
		onZoomToCollection,
		deletingKey,
		onExitViewMode,
		onClose: () => {},
		getDatasetKey,
		getDatasetName,
		onCommentGeometryVisibility,
		onZoomToBounds,
		availableFeatures,
		onMentionVisibilityToggle,
		onMentionZoomTo,
		onEditCollection,
		collectionEditorMode,
		editingCollection,
		onSaveCollection,
		onCloseCollectionEditor,
		onZoomToFeature,
	}

	/** Render the main content based on view mode */
	const renderContent = () => {
		switch (viewMode) {
			case 'datasets':
				return <GeoDatasetsPanelContent mode="datasets" {...datasetsPanelProps} />

			case 'collections':
				return <GeoDatasetsPanelContent mode="collections" {...datasetsPanelProps} />

			case 'combined':
				return (
					<ResizablePanelGroup direction="vertical" className="h-full">
						<ResizablePanel id="datasets-panel" defaultSize={50} minSize={20}>
							<div className="h-full overflow-y-auto">
								<GeoDatasetsPanelContent mode="datasets" {...datasetsPanelProps} />
							</div>
						</ResizablePanel>
						<ResizableHandle withHandle />
						<ResizablePanel id="editor-panel" defaultSize={50} minSize={20}>
							<div className="h-full overflow-y-auto">
								<GeoEditorInfoPanelContent {...editorPanelProps} />
							</div>
						</ResizablePanel>
					</ResizablePanelGroup>
				)

			case 'edit':
				return <GeoEditorInfoPanelContent {...editorPanelProps} />

			default:
				return null
		}
	}

	return (
		<Sidebar
			collapsible="icon"
			className="overflow-hidden *:data-[sidebar=sidebar]:flex-row"
		>
			{/* Icon sidebar (first nested sidebar) */}
			<Sidebar
				collapsible="none"
				className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r"
			>
				<SidebarHeader>
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton size="lg" asChild className="md:h-8 md:p-0">
								<a href="/">
									<div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
										<Globe className="size-4" />
									</div>
									<div className="grid flex-1 text-left text-sm leading-tight">
										<span className="truncate font-medium">Earthly</span>
										<span className="truncate text-xs">Geo Editor</span>
									</div>
								</a>
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarHeader>

				<SidebarContent>
					<SidebarGroup>
						<SidebarGroupContent className="px-1.5 md:px-0">
							<SidebarMenu>
								{viewModeNavItems.map((item) => (
									<SidebarMenuItem key={item.mode}>
										<SidebarMenuButton
											tooltip={{ children: item.title, hidden: false }}
											onClick={() => {
												setViewMode(item.mode)
												setOpen(true)
											}}
											isActive={viewMode === item.mode}
											className="px-2.5 md:px-2"
										>
											<item.icon />
											<span>{item.title}</span>
										</SidebarMenuButton>
									</SidebarMenuItem>
								))}
							</SidebarMenu>
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>

				<SidebarFooter className="border-t border-sidebar-border">
					<div className="flex flex-col items-center gap-1 py-1">
						<Popover open={showMapSettings} onOpenChange={setShowMapSettings}>
							<PopoverTrigger asChild>
								<Button
									variant={showMapSettings ? 'default' : 'ghost'}
									size="icon"
									className="h-8 w-8"
									aria-label="Map settings"
								>
									<Settings2 className="h-4 w-4" />
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-80" side="right" align="end">
								<MapSettingsPanel />
							</PopoverContent>
						</Popover>
						<HelpPopover multiSelectModifier={multiSelectModifier} />
					</div>
				</SidebarFooter>
			</Sidebar>

			{/* Content sidebar (second nested sidebar) */}
			<Sidebar collapsible="none" className="hidden flex-1 md:flex">
				<SidebarHeader className="gap-3.5 border-b p-4">
					<div className="flex w-full items-center justify-between">
						<div className="text-foreground text-base font-medium">
							{viewModeNavItems.find((i) => i.mode === viewMode)?.title}
						</div>
						<LoginSessionButtons />
					</div>
				</SidebarHeader>

				<SidebarContent className="p-2">
					<SidebarGroup className="p-0 h-full">
						<SidebarGroupContent className="h-full">
							{renderContent()}
						</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
			</Sidebar>
		</Sidebar>
	)
}

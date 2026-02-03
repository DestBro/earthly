import {
	Database,
	FolderOpen,
	Globe,
	HelpCircle,
	Newspaper,
	PanelTop,
	Pencil,
	Settings2,
	User,
} from 'lucide-react'
import type { FeatureCollection } from 'geojson'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import { ShoutboxPanel } from './shoutbox'
import { GeoDatasetsPanelContent } from './GeoDatasetsPanel'
import { UserProfilePanel } from './UserProfilePanel'
import { GeoEditorInfoPanelContent } from './GeoEditorInfoPanel'
import { HelpPanel } from './HelpPanel'
import { LoginSessionButtons } from './LoginSessionButtom'
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
import { useRouting, type SidebarViewMode } from '../features/geo-editor/hooks/useRouting'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import type { EditorFeature } from '../features/geo-editor/core'

/** Navigation items for main view modes (shown in the main icon list) */
const mainNavItems: {
	mode: SidebarViewMode
	title: string
	icon: typeof Database
}[] = [
	{ mode: 'datasets', title: 'Datasets', icon: Database },
	{ mode: 'collections', title: 'Collections', icon: FolderOpen },
	{ mode: 'combined', title: 'List & Editor', icon: PanelTop },
	{ mode: 'edit', title: 'Editor', icon: Pencil },
	{ mode: 'user', title: 'Profile', icon: User },
]

/** Navigation items for footer (settings and help) */
const footerNavItems: {
	mode: SidebarViewMode
	title: string
	icon: typeof Settings2
}[] = [
	{ mode: 'posts', title: 'City Posts', icon: Newspaper },
	{ mode: 'settings', title: 'Settings', icon: Settings2 },
	{ mode: 'help', title: 'Help', icon: HelpCircle },
]

/** All view mode items for header title lookup */
const allViewModeItems = [...mainNavItems, ...footerNavItems]

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
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	collectionEditorMode?: 'none' | 'create' | 'edit'
	editingCollection?: NDKGeoCollectionEvent | null
	onSaveCollection?: (collection: NDKGeoCollectionEvent) => void
	onCloseCollectionEditor?: () => void
	onZoomToFeature?: (feature: EditorFeature) => void
	onExitViewMode?: () => void
	// Blossom upload props
	featureCollectionForUpload?: FeatureCollection | null
	onBlossomUploadComplete?: (result: { sha256: string; url: string; size: number }) => void
	/** NDK instance for authenticated uploads */
	ndk?: import('@nostr-dev-kit/ndk').default | null
	/** User pubkey from route (for user profile pages) */
	userPubkey?: string
	/** Callback when filtered dataset keys change (for map visibility sync) */
	onFilteredDatasetKeysChange?: (keys: Set<string>) => void
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
	// Blossom upload props
	featureCollectionForUpload,
	onBlossomUploadComplete,
	ndk,
	// User profile props
	userPubkey,
	// Filter sync
	onFilteredDatasetKeysChange,
}: AppSidebarProps) {
	const { setOpen } = useSidebar()
	const viewMode = useEditorStore((state) => state.sidebarViewMode)
	const resolvingDatasets = useEditorStore((state) => state.resolvingDatasets)
	const { navigateToView } = useRouting()

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
		onCreateCollection,
		onEditCollection,
		isFocused,
		onExitFocus,
		onFilteredDatasetKeysChange,
		resolvingDatasets,
	}

	/** Common props for UserProfilePanel */
	const userProfilePanelProps = {
		geoEvents,
		collectionEvents,
		currentUserPubkey,
		datasetVisibility,
		collectionVisibility,
		isPublishing,
		deletingKey,
		onLoadDataset,
		onToggleVisibility,
		onToggleAllVisibility,
		onZoomToDataset,
		onDeleteDataset,
		getDatasetKey,
		getDatasetName,
		onInspectDataset,
		onToggleCollectionVisibility,
		onToggleAllCollectionVisibility,
		onZoomToCollection,
		onInspectCollection,
		onEditCollection,
		onOpenDebug,
		resolvingDatasets,
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
		featureCollectionForUpload,
		onBlossomUploadComplete,
		ndk,
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

			case 'posts':
				return <ShoutboxPanel />

			case 'settings':
				return (
					<div className="p-4">
						<MapSettingsPanel />
					</div>
				)

			case 'help':
				return <HelpPanel multiSelectModifier={multiSelectModifier} />

			case 'user': {
				// Show user profile panel - use route pubkey if available, otherwise current user
				const profilePubkey = userPubkey ?? currentUserPubkey
				if (!profilePubkey) {
					return (
						<div className="p-4 text-center text-gray-500">
							<p>Connect to view your profile</p>
						</div>
					)
				}
				return <UserProfilePanel pubkey={profilePubkey} {...userProfilePanelProps} />
			}

			default:
				return null
		}
	}

	return (
		<Sidebar collapsible="icon" className="overflow-hidden *:data-[sidebar=sidebar]:flex-row">
			{/* Icon sidebar (first nested sidebar) */}
			<Sidebar collapsible="none" className="w-[calc(var(--sidebar-width-icon)+1px)]! border-r">
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
								{mainNavItems.map((item) => (
									<SidebarMenuItem key={item.mode}>
										<SidebarMenuButton
											tooltip={{ children: item.title, hidden: false }}
											onClick={() => {
												navigateToView(item.mode)
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
					<SidebarMenu>
						{footerNavItems.map((item) => (
							<SidebarMenuItem key={item.mode}>
								<SidebarMenuButton
									tooltip={{ children: item.title, hidden: false }}
									onClick={() => {
										navigateToView(item.mode)
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
				</SidebarFooter>
			</Sidebar>

			{/* Content sidebar (second nested sidebar) */}
			<Sidebar collapsible="none" className="hidden flex-1 md:flex">
				<SidebarHeader className="gap-3.5 border-b p-4">
					<div className="flex w-full items-center justify-between">
						<div className="text-foreground text-base font-medium">
							{allViewModeItems.find((i) => i.mode === viewMode)?.title}
						</div>
						<LoginSessionButtons />
					</div>
				</SidebarHeader>

				<SidebarContent className="p-2">
					<SidebarGroup className="p-0 h-full">
						<SidebarGroupContent className="h-full">{renderContent()}</SidebarGroupContent>
					</SidebarGroup>
				</SidebarContent>
			</Sidebar>
		</Sidebar>
	)
}

import {
	Database,
	FilePenLine,
	FolderOpen,
	Globe,
	HelpCircle,
	MessageCircle,
	Newspaper,
	PanelTop,
	Pencil,
	Settings2,
	User,
	Wallet,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import type { NDKMapContextEvent } from '../lib/ndk/NDKMapContextEvent'
import { ShoutboxPanel } from '../features/social/shoutbox'
import { GeoDatasetsPanelContent } from './GeoDatasetsPanel'
import { UserProfilePanel } from './UserProfilePanel'
import { GeoEditorInfoPanelContent } from './GeoEditorInfoPanel'
import { HelpPanel } from './HelpPanel'
import { LoginSessionButtons } from '../features/auth/LoginSessionButtons'
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
import { Nip60Wallet } from '../features/wallet/components/Nip60Wallet'
import { ChatPanel } from '../features/chat'
import { useEditorStore } from '../features/geo-editor/store'
import { useRouting, type SidebarViewMode } from '../features/geo-editor/hooks/useRouting'
import type { GeoFeatureItem } from './editor/GeoRichTextEditor'
import type { EditorFeature } from '../features/geo-editor/core'

type SidebarContentMode = Exclude<SidebarViewMode, 'combined'>

const META_VIEW_MODES: SidebarContentMode[] = ['posts', 'wallet', 'settings']
const SPLIT_COMPANION_ALLOWED_MODES = new Set<SidebarContentMode>([
	'datasets',
	'collections',
	'chat',
	'user',
	'help',
])

/** Navigation items for primary view modes (top icon list) */
const editorNavItem: {
	mode: SidebarViewMode
	title: string
	icon: typeof Database
} = { mode: 'edit', title: 'Editor', icon: Pencil }

const primaryNavItems: {
	mode: SidebarViewMode
	title: string
	icon: typeof Database
}[] = [
	{ mode: 'datasets', title: 'Datasets', icon: Database },
	{ mode: 'collections', title: 'Collections', icon: FolderOpen },
	{ mode: 'contexts', title: 'Contexts', icon: Globe },
	{ mode: 'context-editor', title: 'Context Editor', icon: FilePenLine },
	{ mode: 'chat', title: 'AI Chat', icon: MessageCircle },
	{ mode: 'user', title: 'Profile', icon: User },
]

/** Navigation items for utility/meta modes (footer icon list) */
const metaNavItems: {
	mode: SidebarViewMode
	title: string
	icon: typeof Settings2
}[] = [
	{ mode: 'posts', title: 'City Posts', icon: Newspaper },
	{ mode: 'wallet', title: 'Wallet', icon: Wallet },
	{ mode: 'settings', title: 'Settings', icon: Settings2 },
	{ mode: 'help', title: 'Help', icon: HelpCircle },
]

/** All view mode items for header title lookup */
const allViewModeItems = [editorNavItem, ...primaryNavItems, ...metaNavItems]

interface AppSidebarProps {
	geoEvents: NDKGeoEvent[]
	collectionEvents: NDKGeoCollectionEvent[]
	mapContextEvents: NDKMapContextEvent[]
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
	onOpenGeometryEditor?: () => void
	onZoomToCollection: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectDataset: (event: NDKGeoEvent) => void
	onInspectCollection: (collection: NDKGeoCollectionEvent, datasets: NDKGeoEvent[]) => void
	onInspectContext: (context: NDKMapContextEvent) => void
	onOpenDebug: (event: NDKGeoEvent | NDKGeoCollectionEvent | NDKMapContextEvent) => void
	onCreateCollection: () => void
	onCreateContext: () => void
	onEditCollection: (collection: NDKGeoCollectionEvent) => void
	onEditContext: (context: NDKMapContextEvent) => void
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
	contextEditorMode?: 'none' | 'create' | 'edit'
	editingContext?: NDKMapContextEvent | null
	onSaveContext?: (context: NDKMapContextEvent) => void
	onCloseContextEditor?: () => void
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
	mapContextEvents,
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
	onOpenGeometryEditor,
	onZoomToCollection,
	onInspectDataset,
	onInspectCollection,
	onInspectContext,
	onOpenDebug,
	onCreateCollection,
	onCreateContext,
	onEditCollection,
	onEditContext,
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
	contextEditorMode = 'none',
	editingContext,
	onSaveContext,
	onCloseContextEditor,
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
	const { navigateToView } = useRouting()
	const [splitWithEditor, setSplitWithEditor] = useState(viewMode === 'combined')

	useEffect(() => {
		if (viewMode === 'combined') {
			setSplitWithEditor(true)
		}
	}, [viewMode])

	const resolveContentMode = (mode: SidebarViewMode): SidebarContentMode =>
		mode === 'combined' ? 'datasets' : mode

	const contentMode = resolveContentMode(viewMode)
	const canUseSplitCompanion =
		SPLIT_COMPANION_ALLOWED_MODES.has(contentMode) && !META_VIEW_MODES.includes(contentMode)
	useEffect(() => {
		if (!canUseSplitCompanion && splitWithEditor) {
			setSplitWithEditor(false)
		}
	}, [canUseSplitCompanion, splitWithEditor])
	const showSplitCompanion = canUseSplitCompanion && splitWithEditor && contentMode !== 'edit'
	const currentTitle =
		viewMode === 'combined'
			? 'Datasets + Editor'
			: allViewModeItems.find((i) => i.mode === viewMode)?.title

	/** Common props for GeoDatasetsPanelContent */
	const datasetsPanelProps = {
		geoEvents,
		collectionEvents,
		mapContextEvents,
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
		onInspectContext,
		onOpenDebug,
		onCreateCollection,
		onCreateContext,
		onEditCollection,
		onEditContext,
		isFocused,
		onExitFocus,
		onFilteredDatasetKeysChange,
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
		onInspectCollection,
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
		contextEditorMode,
		editingContext,
		onSaveContext,
		onCloseContextEditor,
		mapContextEvents,
		onZoomToFeature,
		featureCollectionForUpload,
		onBlossomUploadComplete,
		ndk,
	}
	const splitCompanionEditorPanelProps = {
		...editorPanelProps,
		collectionEditorMode: 'none' as const,
		editingCollection: null,
		contextEditorMode: 'none' as const,
		editingContext: null,
	}

	/** Render non-editor panel content based on active mode */
	const renderPrimaryContent = (mode: SidebarContentMode) => {
		switch (mode) {
			case 'datasets':
				return <GeoDatasetsPanelContent mode="datasets" {...datasetsPanelProps} />

			case 'collections':
				return <GeoDatasetsPanelContent mode="collections" {...datasetsPanelProps} />

			case 'contexts':
				return <GeoDatasetsPanelContent mode="contexts" {...datasetsPanelProps} />

			case 'context-editor':
				return (
					<GeoEditorInfoPanelContent
						{...editorPanelProps}
						contextEditorMode={contextEditorMode !== 'none' ? contextEditorMode : 'create'}
					/>
				)

			case 'posts':
				return <ShoutboxPanel />

			case 'settings':
				return (
					<div className="p-4">
						<MapSettingsPanel />
					</div>
				)

			case 'wallet':
				return (
					<div className="p-4">
						<Nip60Wallet />
					</div>
				)

			case 'chat':
				return <ChatPanel />

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

	/** Render full content area, optionally with editor companion split */
	const renderContent = () => {
		if (contentMode === 'edit') {
			return <GeoEditorInfoPanelContent {...editorPanelProps} />
		}

		if (showSplitCompanion) {
			return (
				<ResizablePanelGroup direction="vertical" className="h-full">
					<ResizablePanel id={`${contentMode}-panel`} defaultSize={52} minSize={20}>
						<div className="h-full overflow-y-auto">{renderPrimaryContent(contentMode)}</div>
					</ResizablePanel>
					<ResizableHandle withHandle />
					<ResizablePanel id="editor-panel" defaultSize={48} minSize={20}>
						<div className="h-full overflow-y-auto">
							<GeoEditorInfoPanelContent {...splitCompanionEditorPanelProps} />
						</div>
					</ResizablePanel>
				</ResizablePanelGroup>
			)
		}

		return renderPrimaryContent(contentMode)
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
								<SidebarMenuItem key={editorNavItem.mode}>
									<SidebarMenuButton
										tooltip={{ children: editorNavItem.title, hidden: false }}
										onClick={() => {
											onOpenGeometryEditor?.()
											navigateToView(editorNavItem.mode)
											setOpen(true)
										}}
										isActive={viewMode === editorNavItem.mode}
										className="px-2.5 md:px-2 border border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100 data-[active=true]:bg-orange-600 data-[active=true]:text-white data-[active=true]:border-orange-600 font-semibold shadow-sm"
									>
										<editorNavItem.icon />
										<span>{editorNavItem.title}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>

								<SidebarMenuItem key="editor-split-toggle">
									<SidebarMenuButton
										tooltip={{
											children: 'Toggle split layout with geometry editor companion.',
											hidden: false,
										}}
										onClick={() => setSplitWithEditor((prev) => !prev)}
										isActive={splitWithEditor}
										disabled={!canUseSplitCompanion}
										className="px-2.5 md:px-2 border border-orange-200 bg-orange-50/70 text-orange-800 hover:bg-orange-100 data-[active=true]:bg-orange-600 data-[active=true]:text-white data-[active=true]:border-orange-600"
									>
										<PanelTop />
										<span>{splitWithEditor ? 'Split On' : 'Split Off'}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>

								{primaryNavItems.map((item) => (
									<SidebarMenuItem key={item.mode}>
										<SidebarMenuButton
											tooltip={{ children: item.title, hidden: false }}
											onClick={() => {
												navigateToView(item.mode)
												setOpen(true)
											}}
											isActive={
												viewMode === item.mode ||
												(viewMode === 'combined' && item.mode === 'datasets')
											}
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
						{metaNavItems.map((item) => (
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
						<div className="text-foreground text-base font-medium flex items-center gap-2">
							<span>{currentTitle}</span>
							{showSplitCompanion && (
								<span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-700">
									Split
								</span>
							)}
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

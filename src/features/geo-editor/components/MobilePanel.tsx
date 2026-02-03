import type { FeatureCollection } from 'geojson'
import { Database, FolderOpen, HelpCircle, MessageSquare, Pencil, Settings2, User } from 'lucide-react'
import { GeoDatasetsPanelContent } from '../../../components/GeoDatasetsPanel'
import { GeoEditorInfoPanelContent } from '../../../components/GeoEditorInfoPanel'
import { HelpPanel } from '../../../components/HelpPanel'
import { UserProfilePanel } from '../../../components/UserProfilePanel'
import { ShoutboxPanel } from '../../../components/shoutbox'
import { Sheet, SheetContent } from '../../../components/ui/sheet'
import { cn } from '../../../lib/utils'
import type { NDKGeoCollectionEvent } from '../../../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../../../lib/ndk/NDKGeoEvent'
import type { GeoFeatureItem } from '../../../components/editor/GeoRichTextEditor'
import type { EditorFeature } from '../core'
import type { BlossomUploadResult } from '../../../lib/blossom/blossomUpload'
import { useEditorStore } from '../store'
import { MapSettingsPanel } from './MapSettingsPanel'

export type MobilePanelTab = 'datasets' | 'collections' | 'edit' | 'profile' | 'posts' | 'settings' | 'help'

export interface MobilePanelProps {
	// Data
	geoEvents: NDKGeoEvent[]
	collectionEvents: NDKGeoCollectionEvent[]
	activeDataset: NDKGeoEvent | null
	currentUserPubkey?: string
	userPubkey?: string | null
	datasetVisibility: Record<string, boolean>
	collectionVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	isFocused: boolean
	multiSelectModifier?: string

	// Dataset callbacks
	onClearEditing: () => void
	onLoadDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onInspectDataset?: (event: NDKGeoEvent) => void
	onExitFocus?: () => void

	// Collection callbacks
	onToggleCollectionVisibility: (collection: NDKGeoCollectionEvent) => void
	onToggleAllCollectionVisibility: (visible: boolean) => void
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onCreateCollection?: () => void
	onEditCollection?: (collection: NDKGeoCollectionEvent) => void
	onOpenDebug?: (event: NDKGeoEvent | NDKGeoCollectionEvent) => void

	// Editor/Info panel callbacks
	onExitViewMode?: () => void
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
	featureCollectionForUpload?: FeatureCollection | null
	onBlossomUploadComplete?: (result: BlossomUploadResult) => void
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	ndk?: any
	/** Callback when filtered dataset keys change (for map visibility sync) */
	onFilteredDatasetKeysChange?: (keys: Set<string>) => void
}

const TAB_CONFIG: { id: MobilePanelTab; label: string; icon: typeof Database }[] = [
	{ id: 'datasets', label: 'Datasets', icon: Database },
	{ id: 'collections', label: 'Collections', icon: FolderOpen },
	{ id: 'edit', label: 'Editor', icon: Pencil },
	{ id: 'profile', label: 'Profile', icon: User },
	{ id: 'posts', label: 'Posts', icon: MessageSquare },
	{ id: 'settings', label: 'Settings', icon: Settings2 },
	{ id: 'help', label: 'Help', icon: HelpCircle },
]

export function MobilePanel(props: MobilePanelProps) {
	const {
		geoEvents,
		collectionEvents,
		activeDataset,
		currentUserPubkey,
		userPubkey,
		datasetVisibility,
		collectionVisibility,
		isPublishing,
		deletingKey,
		isFocused,
		multiSelectModifier = 'Shift',
		onClearEditing,
		onLoadDataset,
		onToggleVisibility,
		onToggleAllVisibility,
		onZoomToDataset,
		onDeleteDataset,
		getDatasetKey,
		getDatasetName,
		onInspectDataset,
		onExitFocus,
		onToggleCollectionVisibility,
		onToggleAllCollectionVisibility,
		onZoomToCollection,
		onInspectCollection,
		onCreateCollection,
		onEditCollection,
		onOpenDebug,
		onExitViewMode,
		onCommentGeometryVisibility,
		onZoomToBounds,
		availableFeatures,
		onMentionVisibilityToggle,
		onMentionZoomTo,
		collectionEditorMode,
		editingCollection,
		onSaveCollection,
		onCloseCollectionEditor,
		onZoomToFeature,
		featureCollectionForUpload,
		onBlossomUploadComplete,
		ndk,
		onFilteredDatasetKeysChange,
	} = props

	// Store state for panel
	const mobilePanelOpen = useEditorStore((state) => state.mobilePanelOpen)
	const mobilePanelTab = useEditorStore((state) => state.mobilePanelTab)
	const setMobilePanelOpen = useEditorStore((state) => state.setMobilePanelOpen)
	const setMobilePanelTab = useEditorStore((state) => state.setMobilePanelTab)
	const resolvingDatasets = useEditorStore((state) => state.resolvingDatasets)

	const handleClose = () => setMobilePanelOpen(false)

	return (
		<Sheet open={mobilePanelOpen} onOpenChange={setMobilePanelOpen} modal={false}>
			<SheetContent
				side="bottom"
				className="p-0 h-[45vh] md:hidden flex flex-col"
				onPointerDownOutside={(e) => e.preventDefault()}
				onInteractOutside={(e) => e.preventDefault()}
			>
				{/* Scrollable Tab Bar */}
				<div className="border-b border-gray-200 bg-gray-50/80 shrink-0 overflow-x-auto scrollbar-hide">
					<div className="flex min-w-max">
						{TAB_CONFIG.map((tab) => {
							const Icon = tab.icon
							const isActive = mobilePanelTab === tab.id
							return (
								<button
									key={tab.id}
									type="button"
									onClick={() => setMobilePanelTab(tab.id)}
									className={cn(
										'flex items-center justify-center gap-1 px-3 py-2.5 text-xs font-medium transition-colors whitespace-nowrap',
										isActive
											? 'text-blue-600 border-b-2 border-blue-600 bg-white'
											: 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
									)}
								>
									<Icon className="h-3.5 w-3.5" />
									<span>{tab.label}</span>
								</button>
							)
						})}
					</div>
				</div>

				{/* Tab Content */}
				<div className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
					{mobilePanelTab === 'datasets' && (
						<GeoDatasetsPanelContent
							mode="datasets"
							geoEvents={geoEvents}
							collectionEvents={collectionEvents}
							activeDataset={activeDataset}
							currentUserPubkey={currentUserPubkey}
							datasetVisibility={datasetVisibility}
							collectionVisibility={collectionVisibility}
							isPublishing={isPublishing}
							deletingKey={deletingKey}
							onClearEditing={onClearEditing}
							onLoadDataset={onLoadDataset}
							onToggleVisibility={onToggleVisibility}
							onToggleAllVisibility={onToggleAllVisibility}
							onToggleCollectionVisibility={onToggleCollectionVisibility}
							onToggleAllCollectionVisibility={onToggleAllCollectionVisibility}
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onZoomToCollection={onZoomToCollection}
							onInspectDataset={onInspectDataset}
							onInspectCollection={onInspectCollection}
							onOpenDebug={onOpenDebug}
							onCreateCollection={onCreateCollection}
							onEditCollection={onEditCollection}
							isFocused={isFocused}
							onExitFocus={onExitFocus}
							onFilteredDatasetKeysChange={onFilteredDatasetKeysChange}
							resolvingDatasets={resolvingDatasets}
						/>
					)}

					{mobilePanelTab === 'collections' && (
						<GeoDatasetsPanelContent
							mode="collections"
							geoEvents={geoEvents}
							collectionEvents={collectionEvents}
							activeDataset={activeDataset}
							currentUserPubkey={currentUserPubkey}
							datasetVisibility={datasetVisibility}
							collectionVisibility={collectionVisibility}
							isPublishing={isPublishing}
							deletingKey={deletingKey}
							onClearEditing={onClearEditing}
							onLoadDataset={onLoadDataset}
							onToggleVisibility={onToggleVisibility}
							onToggleAllVisibility={onToggleAllVisibility}
							onToggleCollectionVisibility={onToggleCollectionVisibility}
							onToggleAllCollectionVisibility={onToggleAllCollectionVisibility}
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onZoomToCollection={onZoomToCollection}
							onInspectDataset={onInspectDataset}
							onInspectCollection={onInspectCollection}
							onOpenDebug={onOpenDebug}
							onCreateCollection={onCreateCollection}
							onEditCollection={onEditCollection}
							isFocused={isFocused}
							onExitFocus={onExitFocus}
							onFilteredDatasetKeysChange={onFilteredDatasetKeysChange}
							resolvingDatasets={resolvingDatasets}
						/>
					)}

					{mobilePanelTab === 'edit' && (
						<GeoEditorInfoPanelContent
							currentUserPubkey={currentUserPubkey}
							onLoadDataset={onLoadDataset}
							onToggleVisibility={onToggleVisibility}
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							onZoomToCollection={onZoomToCollection}
							deletingKey={deletingKey}
							onExitViewMode={onExitViewMode}
							onClose={handleClose}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onCommentGeometryVisibility={onCommentGeometryVisibility}
							onZoomToBounds={onZoomToBounds}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={onMentionVisibilityToggle}
							onMentionZoomTo={onMentionZoomTo}
							onEditCollection={onEditCollection}
							collectionEditorMode={collectionEditorMode}
							editingCollection={editingCollection}
							onSaveCollection={onSaveCollection}
							onCloseCollectionEditor={onCloseCollectionEditor}
							onZoomToFeature={onZoomToFeature}
							featureCollectionForUpload={featureCollectionForUpload}
							onBlossomUploadComplete={onBlossomUploadComplete}
							ndk={ndk}
						/>
					)}

					{mobilePanelTab === 'profile' && (
						<MobileProfileContent
							pubkey={userPubkey ?? currentUserPubkey}
							geoEvents={geoEvents}
							collectionEvents={collectionEvents}
							currentUserPubkey={currentUserPubkey}
							datasetVisibility={datasetVisibility}
							collectionVisibility={collectionVisibility}
							isPublishing={isPublishing}
							deletingKey={deletingKey}
							onLoadDataset={onLoadDataset}
							onToggleVisibility={onToggleVisibility}
							onToggleAllVisibility={onToggleAllVisibility}
							onZoomToDataset={onZoomToDataset}
							onDeleteDataset={onDeleteDataset}
							getDatasetKey={getDatasetKey}
							getDatasetName={getDatasetName}
							onInspectDataset={onInspectDataset}
							onToggleCollectionVisibility={onToggleCollectionVisibility}
							onToggleAllCollectionVisibility={onToggleAllCollectionVisibility}
							onZoomToCollection={onZoomToCollection}
							onInspectCollection={onInspectCollection}
							onEditCollection={onEditCollection}
							onOpenDebug={onOpenDebug}
							resolvingDatasets={resolvingDatasets}
						/>
					)}

					{mobilePanelTab === 'posts' && (
						<div className="h-full -mx-3 -mt-2 -mb-4">
							<ShoutboxPanel />
						</div>
					)}

					{mobilePanelTab === 'settings' && (
						<div className="h-full -mx-3 -mt-2 -mb-4">
							<MapSettingsPanel />
						</div>
					)}

					{mobilePanelTab === 'help' && (
						<div className="h-full -mx-3 -mt-2 -mb-4">
							<HelpPanel multiSelectModifier={multiSelectModifier} />
						</div>
					)}
				</div>
			</SheetContent>
		</Sheet>
	)
}

interface MobileProfileContentProps {
	pubkey?: string | null
	geoEvents: NDKGeoEvent[]
	collectionEvents: NDKGeoCollectionEvent[]
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	collectionVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	onLoadDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onInspectDataset?: (event: NDKGeoEvent) => void
	onToggleCollectionVisibility: (collection: NDKGeoCollectionEvent) => void
	onToggleAllCollectionVisibility: (visible: boolean) => void
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onEditCollection?: (collection: NDKGeoCollectionEvent) => void
	onOpenDebug?: (event: NDKGeoEvent | NDKGeoCollectionEvent) => void
	resolvingDatasets?: Set<string>
}

function MobileProfileContent(props: MobileProfileContentProps) {
	const { pubkey, ...rest } = props

	if (!pubkey) {
		return (
			<div className="flex flex-col items-center justify-center h-32 text-gray-500 text-sm">
				<User className="h-8 w-8 mb-2 text-gray-400" />
				<p>Sign in to view your profile</p>
			</div>
		)
	}

	return <UserProfilePanel pubkey={pubkey} {...rest} />
}

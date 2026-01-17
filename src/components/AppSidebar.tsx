import { Globe, Settings2 } from 'lucide-react'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import { GeoDatasetsPanelContent } from './GeoDatasetsPanel'
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
	SidebarRail,
	useSidebar,
} from './ui/sidebar'
import { MapSettingsPanel } from '../features/geo-editor/components/MapSettingsPanel'
import { useEditorStore } from '../features/geo-editor/store'

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
}: AppSidebarProps) {
	const { state } = useSidebar()
	const showMapSettings = useEditorStore((state) => state.showMapSettings)
	const setShowMapSettings = useEditorStore((state) => state.setShowMapSettings)

	return (
		<Sidebar variant="floating" collapsible="offcanvas">
			<SidebarHeader className="border-b border-sidebar-border">
				<div className="flex items-center gap-2 px-2 py-1">
					<Globe className="h-5 w-5 text-primary" />
					{state === 'expanded' && (
						<span className="font-semibold text-sm">Earthly</span>
					)}
				</div>
			</SidebarHeader>

			<SidebarContent>
				<SidebarGroup className="p-0">
					<SidebarGroupContent className="p-2">
						<GeoDatasetsPanelContent
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
							onClose={() => {}}
							onCreateCollection={onCreateCollection}
							onEditCollection={onEditCollection}
							isFocused={isFocused}
							onExitFocus={onExitFocus}
						/>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			<SidebarFooter className="border-t border-sidebar-border">
				<div className="flex items-center justify-between gap-2 px-2 py-1">
					<div className="flex items-center gap-1">
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
							<PopoverContent className="w-80" side="top" align="start">
								<MapSettingsPanel />
							</PopoverContent>
						</Popover>
						<HelpPopover multiSelectModifier={multiSelectModifier} />
					</div>
					<LoginSessionButtons />
				</div>
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	)
}

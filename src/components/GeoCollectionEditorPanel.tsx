import { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import { useNDK, useNDKCurrentUser } from '@nostr-dev-kit/react'
import { X, Save, MapPin, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import { 
	GeoRichTextEditor, 
	type GeoRichTextEditorRef, 
	type GeoFeatureItem 
} from './editor/GeoRichTextEditor'
import { serializeToText, parseFromText } from './editor/GeoMentionExtension'
import { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import { nip19 } from 'nostr-tools'

interface GeoCollectionEditorPanelProps {
	initialCollection?: NDKGeoCollectionEvent | null
	onClose: () => void
	onSave: (collection: NDKGeoCollectionEvent) => void
	availableFeatures?: GeoFeatureItem[]
	className?: string
}

export function GeoCollectionEditorPanel({
	initialCollection,
	onClose,
	onSave,
	availableFeatures = [],
	className,
}: GeoCollectionEditorPanelProps) {
	const { ndk } = useNDK()
	const currentUser = useNDKCurrentUser()
	const editorRef = useRef<GeoRichTextEditorRef>(null)
	
	// Form state
	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [isSaving, setIsSaving] = useState(false)
	
	// Initialize from collection
	useEffect(() => {
		if (initialCollection) {
			const meta = initialCollection.metadata
			setName(meta.name || '')
			setDescription(initialCollection.metadata.description || '')
		} else {
			setName('')
			setDescription('')
			editorRef.current?.clear()
		}
	}, [initialCollection])

	// Extract references from description
	const referencedAddresses = useMemo(() => {
		const refs = new Set<string>()
		const pattern = /nostr:(naddr1[a-z0-9]+)(#([a-zA-Z0-9_-]+))?/g
		let match = pattern.exec(description)
		while (match !== null) {
			if (match[1]) {
				refs.add(match[1])
			}
			match = pattern.exec(description)
		}
		return Array.from(refs)
	}, [description])

	const handleSave = async () => {
		if (!ndk || !currentUser) return
		setIsSaving(true)

		try {
			const event = initialCollection 
				? NDKGeoCollectionEvent.from(initialCollection)
				: new NDKGeoCollectionEvent(ndk)
			
			// Update metadata
			event.metadata = {
				...event.metadata,
				name,
				description,
				ownerPk: currentUser.pubkey,
			}

			// Update references
			// We only use references explicitly found in the description for now
			// as per the "textual way" requirement.
			// Format for 'a' tag: "kind:pubkey:d-tag"
			const aTags: string[] = []
			
			for (const addr of referencedAddresses) {
				try {
					const decoded = nip19.decode(addr)
					if (decoded.type === 'naddr') {
						const { kind, pubkey, identifier } = decoded.data
						aTags.push(`${kind}:${pubkey}:${identifier}`)
					}
				} catch (e) {
					console.warn('Invalid naddr in description:', addr)
				}
			}
			
			event.datasetReferences = aTags
			
			await event.publishNew()
			onSave(event)
			onClose()
		} catch (error) {
			console.error('Failed to save collection:', error)
		} finally {
			setIsSaving(false)
		}
	}

	const handleDescriptionChange = useCallback((text: string) => {
		setDescription(text)
	}, [])

	const resolvedReferences = useMemo(() => {
		return referencedAddresses.map(addr => {
			const feature = availableFeatures.find(f => f.address === addr)
			return {
				address: addr,
				name: feature?.datasetName || feature?.name || 'Unknown Dataset',
			}
		})
	}, [referencedAddresses, availableFeatures])

	return (
		<div className={cn('flex flex-col h-full overflow-hidden', className)}>
			{/* Header */}
			<div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
				<h2 className="text-base font-semibold text-gray-900">
					{initialCollection ? 'Edit Collection' : 'New Collection'}
				</h2>
				<Button size="icon-xs" variant="ghost" onClick={onClose}>
					<X className="h-4 w-4" />
				</Button>
			</div>

			<div className="flex-1 overflow-y-auto">
				<div className="p-4 space-y-4">
					<div className="space-y-2">
						<Label htmlFor="collection-name">Name</Label>
						<Input
							id="collection-name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="My Awesome Collection"
						/>
					</div>

					<div className="space-y-2">
						<Label>Description</Label>
						<div className="text-xs text-gray-500 mb-1">
							Describe your collection. Mention datasets using $ or drag them here.
						</div>
						<GeoRichTextEditor
							ref={editorRef}
							initialValue={description}
							onChange={handleDescriptionChange}
							placeholder="This collection contains..."
							availableFeatures={availableFeatures}
							className="min-h-[150px]"
							rows={6}
						/>
					</div>

					{referencedAddresses.length > 0 && (
						<div className="space-y-2">
							<Label>Referenced Datasets ({referencedAddresses.length})</Label>
							<div className="bg-gray-50 rounded-md p-2 space-y-1">
								{resolvedReferences.map((ref) => (
									<div key={ref.address} className="flex items-center gap-2 text-sm text-gray-700 bg-white border border-gray-200 rounded px-2 py-1">
										<MapPin className="h-3 w-3 text-gray-400" />
										<span className="truncate flex-1">{ref.name}</span>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Footer */}
			<div className="p-4 border-t border-gray-100 flex justify-end gap-2">
				<Button variant="ghost" onClick={onClose} disabled={isSaving}>
					Cancel
				</Button>
				<Button 
					onClick={handleSave} 
					disabled={isSaving || !name.trim()}
					className="bg-emerald-600 hover:bg-emerald-700"
				>
					{isSaving ? 'Saving...' : 'Save Collection'}
				</Button>
			</div>
		</div>
	)
}

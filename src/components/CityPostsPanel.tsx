import { ExternalLink, Loader2, RefreshCw } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useMemo, useState } from 'react'
import { useSubscribe } from '@nostr-dev-kit/react'
import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { ContentViewer } from './editor/ContentViewer'

/** The npub we fetch posts from */
const EARTHLY_CITY_NPUB = 'npub182jczunncwe0jn6frpqwq3e0qjws7yqqnc3auccqv9nte2dnd63scjm4rf'

/** Hardcoded note IDs to always include */
const PINNED_NOTE_IDS = [
	'note13yj64h4ph3glgtfnxdfc694wq63m7zy5xyppev39sv9dhsl25acqyxfcp4',
	'note1twc8vewtx2w3a9tssacczv46cgpcw84ycjjv0snsqe8gjxfj0mvqvdrry5',
	'note1k8alwuwqqeh0ngyvqsptmv0h5ujkf542mcsphw82366ghva5548qnjc4jf',
]

/** Convert npub to hex pubkey */
function npubToHex(npub: string): string | null {
	try {
		const decoded = nip19.decode(npub)
		if (decoded.type === 'npub') {
			return decoded.data as string
		}
		return null
	} catch {
		return null
	}
}

/** Convert note1 IDs to hex event IDs */
function noteIdsToHex(noteIds: string[]): string[] {
	return noteIds
		.map((noteId) => {
			try {
				const decoded = nip19.decode(noteId)
				if (decoded.type === 'note') {
					return decoded.data as string
				}
				return null
			} catch {
				return null
			}
		})
		.filter((id): id is string => id !== null)
}

/** Format a timestamp to a readable date */
function formatDate(timestamp: number): string {
	const date = new Date(timestamp * 1000)
	return date.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

/** Get nevent or note1 link for a post */
function getNostrLink(event: NDKEvent): string {
	try {
		return `nostr:${nip19.neventEncode({ id: event.id, author: event.pubkey })}`
	} catch {
		return `nostr:${nip19.noteEncode(event.id)}`
	}
}

interface PostCardProps {
	event: NDKEvent
}

function PostCard({ event }: PostCardProps) {
	const content = event.content
	const createdAt = event.created_at ?? 0

	// Extract hashtags from tags
	const hashtags = event.tags
		.filter((tag) => tag[0] === 't')
		.map((tag) => tag[1])
		.filter(Boolean)

	return (
		<div className="rounded-lg border bg-card p-4 space-y-3 hover:border-primary/50 transition-colors overflow-hidden">
			{/* Header with timestamp */}
			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<span>{formatDate(createdAt)}</span>
				<a
					href={getNostrLink(event)}
					target="_blank"
					rel="noopener noreferrer"
					className="hover:text-primary flex items-center gap-1"
				>
					<ExternalLink className="h-3 w-3" />
					<span>View</span>
				</a>
			</div>

			{/* Content with embedded media */}
			<ContentViewer content={content} />

			{/* Hashtags */}
			{hashtags.length > 0 && (
				<div className="flex flex-wrap gap-1">
					{hashtags.map((tag) => (
						<span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">
							#{tag}
						</span>
					))}
				</div>
			)}
		</div>
	)
}

export function CityPostsPanel() {
	const [filterVersion, setFilterVersion] = useState(0)

	const pubkeyHex = useMemo(() => npubToHex(EARTHLY_CITY_NPUB), [])
	const pinnedEventIds = useMemo(() => noteIdsToHex(PINNED_NOTE_IDS), [])

	// Build filters for:
	// 1. Posts from the specific pubkey with #earthlycity hashtag
	// 2. Specific pinned note IDs
	const filters = useMemo<NDKFilter[]>(() => {
		// Use filterVersion to ensure new filter reference triggers re-subscription
		void filterVersion

		const result: NDKFilter[] = []

		// Filter for hashtag posts
		if (pubkeyHex) {
			result.push({
				kinds: [1],
				authors: [pubkeyHex],
				'#t': ['earthlycity'],
				limit: 50,
			})
		}

		// Filter for pinned note IDs
		if (pinnedEventIds.length > 0) {
			result.push({
				kinds: [1],
				ids: pinnedEventIds,
			})
		}

		return result
	}, [pubkeyHex, pinnedEventIds, filterVersion])

	const { events, eose } = useSubscribe(filters)

	// Sort posts by created_at descending (newest first)
	const sortedPosts = useMemo(() => {
		return [...events].sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
	}, [events])

	const handleRefresh = () => {
		setFilterVersion((prev) => prev + 1)
	}

	const isLoading = !eose && events.length === 0

	return (
		<div className="flex flex-col h-full">
			{/* Header */}
			<div className="flex items-center justify-between px-2 py-2 border-b">
				<div className="flex flex-col">
					<h3 className="font-medium text-sm">City Posts</h3>
					<p className="text-xs text-muted-foreground">Updates from Earthly City</p>
				</div>
				<Button
					variant="ghost"
					size="icon"
					onClick={handleRefresh}
					disabled={isLoading}
					className="h-8 w-8"
				>
					<RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
				</Button>
			</div>

			{/* Content */}
			<ScrollArea className="flex-1">
				<div className="p-2 space-y-3">
					{isLoading && (
						<div className="flex items-center justify-center py-8">
							<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
						</div>
					)}

					{!isLoading && sortedPosts.length === 0 && (
						<div className="text-center py-8 text-muted-foreground text-sm">
							No posts found with #earthlycity
						</div>
					)}

					{sortedPosts.map((event) => (
						<PostCard key={event.id} event={event} />
					))}

					{eose && sortedPosts.length > 0 && (
						<p className="text-xs text-center text-muted-foreground py-2">
							{sortedPosts.length} post{sortedPosts.length !== 1 ? 's' : ''} loaded
						</p>
					)}
				</div>
			</ScrollArea>
		</div>
	)
}

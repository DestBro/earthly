import { useCallback, useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { useEditorStore } from '../store'

/** Sidebar view modes that can be routed */
export type SidebarViewMode =
	| 'datasets'
	| 'collections'
	| 'combined'
	| 'edit'
	| 'posts'
	| 'settings'
	| 'help'
	| 'user'

/** All valid sidebar view mode values */
const SIDEBAR_VIEW_MODES: SidebarViewMode[] = [
	'datasets',
	'collections',
	'combined',
	'edit',
	'posts',
	'settings',
	'help',
	'user',
]

/** Aliases for sidebar views (e.g., shoutbox → posts) */
const VIEW_ALIASES: Record<string, SidebarViewMode> = {
	shoutbox: 'posts',
}

export interface RouteState {
	/** Focus type for deep-linking to specific content */
	focusType: 'none' | 'geoevent' | 'collection'
	/** Nostr address for focused content */
	naddr?: string
	/** Current sidebar view mode */
	sidebarView: SidebarViewMode
	/** User pubkey for user profile routes (hex format) */
	userPubkey?: string
}

/**
 * Check if a string is a valid sidebar view mode
 */
function isSidebarViewMode(value: string): value is SidebarViewMode {
	return SIDEBAR_VIEW_MODES.includes(value as SidebarViewMode)
}

/**
 * Parse the current hash into a RouteState
 *
 * URL patterns:
 * - #/ or #/datasets → datasets view, no focus
 * - #/posts or #/shoutbox → posts view, no focus
 * - #/{sidebarView} → specified sidebar view, no focus
 * - #/geoevent/{naddr} → datasets view (backward compat), geoevent focus
 * - #/collection/{naddr} → collections view (backward compat), collection focus
 * - #/{sidebarView}/geoevent/{naddr} → specified sidebar + geoevent focus
 * - #/{sidebarView}/collection/{naddr} → specified sidebar + collection focus
 */
function parseHash(): RouteState {
	const hash = window.location.hash.slice(1) // Remove leading #
	if (!hash || hash === '/') {
		return { focusType: 'none', sidebarView: 'datasets' }
	}

	// Split path segments: /segment1/segment2/segment3...
	const segments = hash.split('/').filter(Boolean)

	if (segments.length === 0) {
		return { focusType: 'none', sidebarView: 'datasets' }
	}

	const first = segments[0]!

	// Check for backward-compatible focus-only routes: #/geoevent/{naddr} or #/collection/{naddr}
	if (first === 'geoevent' && segments[1]) {
		return {
			focusType: 'geoevent',
			naddr: segments[1],
			sidebarView: 'datasets', // Default sidebar for geoevent focus
		}
	}
	if (first === 'collection' && segments[1]) {
		return {
			focusType: 'collection',
			naddr: segments[1],
			sidebarView: 'collections', // Default sidebar for collection focus
		}
	}

	// Handle user profile route: #/user/{npub_or_pubkey}
	if (first === 'user' && segments[1]) {
		let userPubkey = segments[1]
		// Decode npub to hex if needed
		if (userPubkey.startsWith('npub')) {
			try {
				const decoded = nip19.decode(userPubkey)
				if (decoded.type === 'npub') {
					userPubkey = decoded.data
				}
			} catch {
				// Invalid npub, use as-is
			}
		}
		return {
			focusType: 'none',
			sidebarView: 'user',
			userPubkey,
		}
	}

	// Resolve alias (e.g., shoutbox → posts)
	const resolvedFirst = VIEW_ALIASES[first] ?? first

	// Check if first segment is a sidebar view mode
	if (isSidebarViewMode(resolvedFirst)) {
		// Check for focus in remaining segments: #/{sidebarView}/geoevent/{naddr}
		if (segments[1] === 'geoevent' && segments[2]) {
			return {
				focusType: 'geoevent',
				naddr: segments[2],
				sidebarView: resolvedFirst,
			}
		}
		if (segments[1] === 'collection' && segments[2]) {
			return {
				focusType: 'collection',
				naddr: segments[2],
				sidebarView: resolvedFirst,
			}
		}

		// Just sidebar view, no focus
		return { focusType: 'none', sidebarView: resolvedFirst }
	}

	// Unknown route, default to datasets
	return { focusType: 'none', sidebarView: 'datasets' }
}

/**
 * Build a hash string from route components
 */
function buildHash(
	sidebarView: SidebarViewMode,
	focusType?: 'geoevent' | 'collection',
	naddr?: string,
): string {
	if (focusType && naddr) {
		return `/${sidebarView}/${focusType}/${naddr}`
	}
	return `/${sidebarView}`
}

/**
 * Hook for managing hash-based routing for sidebar views and focused content.
 *
 * Supports routes:
 * - #/ or #/datasets → datasets view, no focus
 * - #/{sidebarView} → specified sidebar view, no focus
 * - #/geoevent/{naddr} → backward-compatible geoevent focus
 * - #/collection/{naddr} → backward-compatible collection focus
 * - #/{sidebarView}/geoevent/{naddr} → sidebar view + geoevent focus
 * - #/{sidebarView}/collection/{naddr} → sidebar view + collection focus
 */
export function useRouting() {
	const [route, setRoute] = useState<RouteState>(parseHash)

	// Store actions
	const setFocused = useEditorStore((state) => state.setFocused)
	const clearFocused = useEditorStore((state) => state.clearFocused)
	const setSidebarViewMode = useEditorStore((state) => state.setSidebarViewMode)

	// Sync route state on hash change
	useEffect(() => {
		const handleHashChange = () => {
			const newRoute = parseHash()
			setRoute(newRoute)

			// Update store sidebar view mode
			setSidebarViewMode(newRoute.sidebarView)

			// Update store focus state
			if (newRoute.focusType === 'none') {
				clearFocused()
			} else if (newRoute.naddr) {
				setFocused(newRoute.focusType, newRoute.naddr)
			}
		}

		window.addEventListener('hashchange', handleHashChange)

		// Initial sync on mount
		const initialRoute = parseHash()
		setSidebarViewMode(initialRoute.sidebarView)
		if (initialRoute.focusType !== 'none' && initialRoute.naddr) {
			setFocused(initialRoute.focusType, initialRoute.naddr)
		}

		return () => window.removeEventListener('hashchange', handleHashChange)
	}, [setFocused, clearFocused, setSidebarViewMode])

	/**
	 * Navigate to a sidebar view (without focus)
	 */
	const navigateToView = useCallback((view: SidebarViewMode) => {
		window.location.hash = buildHash(view)
	}, [])

	/**
	 * Navigate to a focused route, preserving or setting sidebar view
	 */
	const navigateTo = useCallback(
		(focusType: 'geoevent' | 'collection', naddr: string, sidebarView?: SidebarViewMode) => {
			const currentRoute = parseHash()
			const view = sidebarView ?? currentRoute.sidebarView
			window.location.hash = buildHash(view, focusType, naddr)
		},
		[],
	)

	/**
	 * Clear focus but stay on current sidebar view
	 */
	const clearFocus = useCallback(() => {
		const currentRoute = parseHash()
		window.location.hash = buildHash(currentRoute.sidebarView)
	}, [])

	/**
	 * Navigate to datasets view with no focus (home)
	 */
	const navigateHome = useCallback(() => {
		window.location.hash = '/datasets'
	}, [])

	/**
	 * Navigate to a user's profile page
	 */
	const navigateToUser = useCallback((pubkey: string) => {
		const npub = nip19.npubEncode(pubkey)
		window.location.hash = `/user/${npub}`
	}, [])

	/**
	 * Generate naddr for a geo event
	 */
	const encodeGeoEventNaddr = useCallback(
		(event: {
			kind?: number
			pubkey: string
			datasetId?: string
			dTag?: string
		}): string | null => {
			const identifier = event.datasetId ?? event.dTag
			if (!identifier || !event.kind) return null

			try {
				return nip19.naddrEncode({
					kind: event.kind,
					pubkey: event.pubkey,
					identifier,
				})
			} catch {
				return null
			}
		},
		[],
	)

	/**
	 * Generate naddr for a collection
	 */
	const encodeCollectionNaddr = useCallback(
		(event: { kind?: number; pubkey: string; dTag?: string }): string | null => {
			const identifier = event.dTag
			if (!identifier || !event.kind) return null

			try {
				return nip19.naddrEncode({
					kind: event.kind,
					pubkey: event.pubkey,
					identifier,
				})
			} catch {
				return null
			}
		},
		[],
	)

	return {
		route,
		navigateToView,
		navigateTo,
		navigateToUser,
		clearFocus,
		navigateHome,
		encodeGeoEventNaddr,
		encodeCollectionNaddr,
		/** Whether currently focused on a geoevent or collection */
		isFocused: route.focusType !== 'none',
		/** Current sidebar view mode from the route */
		sidebarView: route.sidebarView,
		/** User pubkey from route (for user profile pages) */
		userPubkey: route.userPubkey,
	}
}

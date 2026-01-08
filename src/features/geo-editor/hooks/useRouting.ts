import { useCallback, useEffect, useState } from 'react'
import { nip19 } from 'nostr-tools'
import { useEditorStore } from '../store'

export interface RouteState {
	type: 'home' | 'geoevent' | 'collection'
	naddr?: string
}

/**
 * Parse the current hash into a RouteState
 */
function parseHash(): RouteState {
	const hash = window.location.hash.slice(1) // Remove leading #
	if (!hash || hash === '/') {
		return { type: 'home' }
	}

	// Match #/geoevent/{naddr} or #/collection/{naddr}
	const geoEventMatch = hash.match(/^\/geoevent\/(.+)$/)
	if (geoEventMatch) {
		return { type: 'geoevent', naddr: geoEventMatch[1] }
	}

	const collectionMatch = hash.match(/^\/collection\/(.+)$/)
	if (collectionMatch) {
		return { type: 'collection', naddr: collectionMatch[1] }
	}

	return { type: 'home' }
}

/**
 * Hook for managing hash-based routing for focused visibility mode.
 * Supports routes:
 * - #/ or empty: normal mode
 * - #/geoevent/{naddr}: focus on a single geo event
 * - #/collection/{naddr}: focus on a collection's datasets
 */
export function useRouting() {
	const [route, setRoute] = useState<RouteState>(parseHash)

	// Store actions
	const setFocused = useEditorStore((state) => state.setFocused)
	const clearFocused = useEditorStore((state) => state.clearFocused)

	// Sync route state on hash change
	useEffect(() => {
		const handleHashChange = () => {
			const newRoute = parseHash()
			setRoute(newRoute)

			// Update store focus state
			if (newRoute.type === 'home') {
				clearFocused()
			} else if (newRoute.naddr) {
				setFocused(newRoute.type as 'geoevent' | 'collection', newRoute.naddr)
			}
		}

		window.addEventListener('hashchange', handleHashChange)

		// Initial sync - also update store on mount
		const initialRoute = parseHash()
		if (initialRoute.type !== 'home' && initialRoute.naddr) {
			setFocused(initialRoute.type as 'geoevent' | 'collection', initialRoute.naddr)
		}

		return () => window.removeEventListener('hashchange', handleHashChange)
	}, [setFocused, clearFocused])

	/**
	 * Navigate to a focused route
	 */
	const navigateTo = useCallback(
		(type: 'geoevent' | 'collection', naddr: string) => {
			window.location.hash = `/${type}/${naddr}`
		},
		[],
	)

	/**
	 * Exit focus mode and return to home
	 */
	const navigateHome = useCallback(() => {
		window.location.hash = '/'
	}, [])

	/**
	 * Generate naddr for a geo event
	 */
	const encodeGeoEventNaddr = useCallback(
		(event: { kind?: number; pubkey: string; datasetId?: string; dTag?: string }): string | null => {
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
		navigateTo,
		navigateHome,
		encodeGeoEventNaddr,
		encodeCollectionNaddr,
		isFocused: route.type !== 'home',
	}
}

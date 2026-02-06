/**
 * Simple holder for the current user's pubkey.
 * This exists to avoid circular dependencies between storage.ts and the stores.
 * The stores set this when they initialize, and storage.ts reads from it.
 */

let currentPubkey: string | null = null

export function setCurrentPubkey(pubkey: string | null): void {
	currentPubkey = pubkey
}

export function getCurrentPubkey(): string | null {
	return currentPubkey
}

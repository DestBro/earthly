import { getCurrentPubkey } from './currentUser'

/**
 * Get a user-scoped storage key.
 * @param prefix The base key prefix
 * @param pubkey Optional pubkey override. If not provided, uses getCurrentPubkey().
 * @returns The full storage key, or null if no pubkey available
 */
function getUserScopedKey(prefix: string, pubkey?: string): string | null {
	const userPubkey = pubkey ?? getCurrentPubkey()
	if (!userPubkey) return null
	return `${prefix}_${userPubkey.slice(0, 8)}`
}

/**
 * Load JSON data from user-scoped localStorage.
 * @param prefix The base key prefix
 * @param defaultValue Default value if not found or parse fails
 * @param pubkey Optional pubkey override
 */
export function loadUserData<T>(prefix: string, defaultValue: T, pubkey?: string): T {
	try {
		const key = getUserScopedKey(prefix, pubkey)
		if (!key) return defaultValue

		const stored = localStorage.getItem(key)
		return stored ? JSON.parse(stored) : defaultValue
	} catch {
		return defaultValue
	}
}

/**
 * Save JSON data to user-scoped localStorage.
 * @param prefix The base key prefix
 * @param data The data to save
 * @param pubkey Optional pubkey override
 */
export function saveUserData<T>(prefix: string, data: T, pubkey?: string): void {
	try {
		const key = getUserScopedKey(prefix, pubkey)
		if (!key) return

		localStorage.setItem(key, JSON.stringify(data))
	} catch (e) {
		console.error(`[wallet/storage] Failed to save ${prefix}:`, e)
	}
}

/**
 * Remove user-scoped data from localStorage.
 * @param prefix The base key prefix
 * @param pubkey Optional pubkey override
 */
export function removeUserData(prefix: string, pubkey?: string): void {
	try {
		const key = getUserScopedKey(prefix, pubkey)
		if (!key) return

		localStorage.removeItem(key)
	} catch {
		// Silently ignore removal errors
	}
}

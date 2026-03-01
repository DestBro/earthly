/**
 * Default public relays that are used in addition to the main relay
 * These are used for reading events from the broader Nostr network
 */
export const DEFAULT_PUBLIC_RELAYS: string[] = [
	'wss://sendit.nosflare.com',
	'wss://nostr.mom',
	'wss://nos.lol',
	'wss://relay.nostr.net',
	'wss://relay.damus.io',
	'wss://relay.minibits.cash',
]

// Dedicated zap detection relays
export const ZAP_RELAYS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://relay.nostr.net',
	'wss://relay.minibits.cash',
	'wss://relay.coinos.io',
	'wss://nwc.primal.net',
	'wss://relay.primal.net',
]

/** Maximum content size before suggesting blossom upload (1MB) */
export const BLOSSOM_UPLOAD_THRESHOLD_BYTES = 1024 * 1024

/** Blossom server URL - always use production server for blob storage */
export const BLOSSOM_SERVER_URL = 'https://blossom.earthly.city'

/** Get blossom server URL */
export function getBlossomServerUrl(): string {
	return BLOSSOM_SERVER_URL
}

/**
 * Property keys that are internal to the editor and should not be treated
 * as user-defined custom properties.
 */
export const NON_CUSTOM_EDITOR_PROPERTY_KEYS = new Set([
	'meta',
	'active',
	'mode',
	'parent',
	'coord_path',
	'featureId',
	'importSource',
	'customProperties',
	'name',
	'description',
	'featureType',
	'text',
	'textFontSize',
	'textColor',
	'textHaloColor',
	'textHaloWidth',
])

/**
 * Earthly Nostr Event Kind Constants
 *
 * These are custom event kinds used by the Earthly application
 * for GeoJSON data storage and collaboration on Nostr.
 */

/** GeoJSON Data Event - stores FeatureCollection with spatial metadata */
export const GEO_EVENT_KIND = 37515

/** GeoJSON Collection Event - groups multiple datasets */
export const GEO_COLLECTION_KIND = 37516

/** GeoJSON Comment Event - NIP-22 threaded comments on datasets */
export const GEO_COMMENT_KIND = 37517

/** Map Layer Set Announcement - server-signed layer configuration */
export const MAP_LAYER_SET_KIND = 15000

import { EarthlyGeoServerClient } from './EarthlyGeoServerClient'

// Singleton instance of the EarthlyGeoServer client
export const earthlyGeoServer = new EarthlyGeoServerClient()

// Re-export types for convenience
export * from './EarthlyGeoServerClient'

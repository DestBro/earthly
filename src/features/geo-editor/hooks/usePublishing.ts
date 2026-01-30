import type NDK from '@nostr-dev-kit/ndk'
import type { FeatureCollection } from 'geojson'
import { useCallback, useMemo } from 'react'
import type { GeoBlobReference, NDKGeoEvent } from '../../../lib/ndk/NDKGeoEvent'
import { NDKGeoEvent as NDKGeoEventClass } from '../../../lib/ndk/NDKGeoEvent'
import type { EditorFeature } from '../core'
import { useEditorStore } from '../store'
import type { EditorBlobReference } from '../types'
import { extractCollectionMeta, sanitizeEditorProperties } from '../utils'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '../constants'

interface UsePublishingOptions {
	ndk: NDK | undefined
	currentUserPubkey: string | undefined
	getDatasetName: (event: NDKGeoEvent) => string
	getDatasetKey: (event: NDKGeoEvent) => string
}

export function usePublishing({
	ndk,
	currentUserPubkey,
	getDatasetName,
	getDatasetKey,
}: UsePublishingOptions) {
	// Store state
	const editor = useEditorStore((state) => state.editor)
	const features = useEditorStore((state) => state.features)
	const activeDataset = useEditorStore((state) => state.activeDataset)
	const collectionMeta = useEditorStore((state) => state.collectionMeta)
	const blobReferences = useEditorStore((state) => state.blobReferences)

	// Store actions
	const setIsPublishing = useEditorStore((state) => state.setIsPublishing)
	const setPublishMessage = useEditorStore((state) => state.setPublishMessage)
	const setPublishError = useEditorStore((state) => state.setPublishError)
	const setActiveDataset = useEditorStore((state) => state.setActiveDataset)
	const setCollectionMeta = useEditorStore((state) => state.setCollectionMeta)
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	
	// Blossom dialog state
	const setBlossomUploadDialogOpen = useEditorStore((state) => state.setBlossomUploadDialogOpen)
	const setPendingPublishCollection = useEditorStore((state) => state.setPendingPublishCollection)

	const serializeEditorFeature = useCallback((feature: EditorFeature) => {
		const sanitized = sanitizeEditorProperties(
			feature.properties as Record<string, any> | undefined,
		)
		return {
			type: 'Feature' as const,
			id: feature.id,
			geometry: JSON.parse(JSON.stringify(feature.geometry)),
			...(sanitized ? { properties: sanitized } : {}),
		}
	}, [])

	const serializeBlobReferences = useCallback(
		(): GeoBlobReference[] =>
			blobReferences
				.filter((reference) => reference.url)
				.map(({ scope, featureId, url, sha256, size, mimeType }: EditorBlobReference) => ({
					scope,
					featureId,
					url,
					sha256,
					size,
					mimeType,
				})),
		[blobReferences],
	)

	const buildCollectionFromEditor = useCallback((): FeatureCollection | null => {
		if (!editor) return null
		const currentFeatures = editor.getAllFeatures()
		if (currentFeatures.length === 0) return null

		const collectionName =
			collectionMeta.name ||
			(activeDataset ? getDatasetName(activeDataset) : `Geo dataset ${new Date().toLocaleString()}`)

		const collection: FeatureCollection & {
			name?: string
			description?: string
			color?: string
			properties?: Record<string, any>
		} = {
			type: 'FeatureCollection',
			features: currentFeatures.map(serializeEditorFeature) as any,
		}

		// Add external blob placeholders
		const existingIds = new Set(
			collection.features
				.map((feature) =>
					typeof feature.id === 'string'
						? feature.id
						: typeof feature.id === 'number'
							? String(feature.id)
							: undefined,
				)
				.filter((id): id is string => Boolean(id)),
		)

		blobReferences.forEach((reference) => {
			if (reference.scope !== 'feature' || !reference.featureId) return
			if (existingIds.has(reference.featureId)) return
			existingIds.add(reference.featureId)
			collection.features.push({
				type: 'Feature',
				id: reference.featureId,
				geometry: null,
				properties: {
					externalPlaceholder: true,
					blobUrl: reference.url,
				},
			} as any)
		})

		// Set collection metadata
		;(collection as any).name = collectionName
		if (collectionMeta.description) {
			;(collection as any).description = collectionMeta.description
		}
		if (collectionMeta.color) {
			;(collection as any).color = collectionMeta.color
		}

		const extraProps: Record<string, any> = {
			...collectionMeta.customProperties,
		}
		if (collectionMeta.color) extraProps.color = collectionMeta.color
		if (collectionMeta.description) extraProps.description = collectionMeta.description
		if (collectionMeta.name) extraProps.name = collectionMeta.name

		if (Object.keys(extraProps).length > 0) {
			;(collection as any).properties = {
				...(collection as any).properties,
				...extraProps,
			}
		}

		return collection
	}, [
		editor,
		collectionMeta,
		activeDataset,
		getDatasetName,
		blobReferences,
		serializeEditorFeature,
	])

	/**
	 * Calculate the serialized size of a FeatureCollection in bytes.
	 */
	const getCollectionSize = useCallback((collection: FeatureCollection): number => {
		const jsonString = JSON.stringify(collection)
		return new TextEncoder().encode(jsonString).length
	}, [])

	/**
	 * Check if the collection exceeds the size threshold.
	 */
	const isOverSizeLimit = useCallback((collection: FeatureCollection): boolean => {
		return getCollectionSize(collection) > BLOSSOM_UPLOAD_THRESHOLD_BYTES
	}, [getCollectionSize])

	/**
	 * Current collection size for display (memoized).
	 */
	const currentCollectionSize = useMemo(() => {
		const collection = buildCollectionFromEditor()
		return collection ? getCollectionSize(collection) : 0
	}, [buildCollectionFromEditor, getCollectionSize])

	const handlePublishNew = useCallback(async (options?: { skipSizeCheck?: boolean }) => {
		if (!editor) return
		setIsPublishing(true)
		setPublishMessage('Preparing dataset...')
		setPublishError(null)

		try {
			const collection = buildCollectionFromEditor()
			if (!collection) throw new Error('No features to publish')

			// Check size and optionally show blossom dialog
			if (!options?.skipSizeCheck && isOverSizeLimit(collection)) {
				setIsPublishing(false)
				setPendingPublishCollection(collection)
				setBlossomUploadDialogOpen(true)
				return
			}

			if (!ndk) {
				setPublishError('NDK is not ready.')
				return
			}

			const event = new NDKGeoEventClass(ndk)
			event.featureCollection = collection
			event.blobReferences = serializeBlobReferences()
			await event.publishNew()
			setPublishMessage('Dataset published successfully.')
			setActiveDataset(event)
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
		} catch (error) {
			console.error('Failed to publish dataset', error)
			setPublishError('Failed to publish dataset. Check console for details.')
		} finally {
			setIsPublishing(false)
		}
	}, [
		editor,
		setIsPublishing,
		setPublishMessage,
		setPublishError,
		buildCollectionFromEditor,
		isOverSizeLimit,
		setPendingPublishCollection,
		setBlossomUploadDialogOpen,
		ndk,
		serializeBlobReferences,
		setActiveDataset,
		setCollectionMeta,
		setSelectedFeatureIds,
	])

	/**
	 * Complete publishing with blossom blob reference.
	 * Creates a stub event with centroid and blob reference.
	 */
	const handlePublishWithBlossomUpload = useCallback(async (
		blobResult: { sha256: string; url: string; size: number }
	) => {
		if (!ndk) {
			setPublishError('NDK is not ready.')
			return
		}

		setIsPublishing(true)
		setPublishMessage('Publishing with external reference...')
		setPublishError(null)

		try {
			const collection = buildCollectionFromEditor()
			if (!collection) throw new Error('No features to publish')

			// Create a stub collection with metadata only
			// Include a centroid point as preview
			const stubCollection: FeatureCollection & { 
				name?: string
				description?: string 
				properties?: Record<string, any>
			} = {
				type: 'FeatureCollection',
				features: [{
					type: 'Feature',
					id: 'external-geometry-placeholder',
					geometry: null,
					properties: {
						externalPlaceholder: true,
						blobUrl: blobResult.url,
						name: 'External geometry',
					},
				} as any],
			}

			// Copy metadata from original collection
			if ((collection as any).name) stubCollection.name = (collection as any).name
			if ((collection as any).description) stubCollection.description = (collection as any).description
			if ((collection as any).properties) stubCollection.properties = (collection as any).properties

			const event = new NDKGeoEventClass(ndk)
			event.featureCollection = stubCollection

			// Add the blob reference for the full collection
			const existingRefs = serializeBlobReferences()
			event.blobReferences = [
				...existingRefs,
				{
					scope: 'collection',
					url: blobResult.url,
					sha256: blobResult.sha256,
					size: blobResult.size,
					mimeType: 'application/geo+json',
				},
			]

			await event.publishNew()
			setPublishMessage('Dataset published with external reference.')
			setActiveDataset(event)
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
			
			// Clean up dialog state
			setPendingPublishCollection(null)
			setBlossomUploadDialogOpen(false)
		} catch (error) {
			console.error('Failed to publish with blossom', error)
			setPublishError('Failed to publish. Check console for details.')
		} finally {
			setIsPublishing(false)
		}
	}, [
		ndk,
		setIsPublishing,
		setPublishMessage,
		setPublishError,
		buildCollectionFromEditor,
		serializeBlobReferences,
		setActiveDataset,
		setCollectionMeta,
		setSelectedFeatureIds,
		setPendingPublishCollection,
		setBlossomUploadDialogOpen,
	])

	const handlePublishUpdate = useCallback(async () => {
		if (!editor || !activeDataset) return
		setIsPublishing(true)
		setPublishMessage('Updating dataset...')
		setPublishError(null)

		if (currentUserPubkey !== activeDataset.pubkey) {
			setPublishError('You can only update datasets you own.')
			setIsPublishing(false)
			return
		}

		const collection = buildCollectionFromEditor()
		if (!collection) {
			setPublishError('Draw or load geometry before publishing.')
			setIsPublishing(false)
			return
		}

		try {
			const event = new NDKGeoEventClass(ndk || undefined)
			event.featureCollection = collection
			event.datasetId = activeDataset.datasetId ?? activeDataset.id
			event.hashtags = activeDataset.hashtags
			event.collectionReferences = activeDataset.collectionReferences
			event.relayHints = activeDataset.relayHints
			event.blobReferences = serializeBlobReferences()

			await event.publishUpdate(activeDataset)
			setPublishMessage('Dataset update published successfully.')
			setActiveDataset(event)
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
		} catch (error) {
			console.error('Failed to publish dataset update', error)
			setPublishError('Failed to publish dataset update. Check console for details.')
		} finally {
			setIsPublishing(false)
		}
	}, [
		editor,
		activeDataset,
		setIsPublishing,
		setPublishMessage,
		setPublishError,
		currentUserPubkey,
		buildCollectionFromEditor,
		ndk,
		serializeBlobReferences,
		setActiveDataset,
		setCollectionMeta,
		setSelectedFeatureIds,
	])

	const handlePublishCopy = useCallback(async () => {
		if (!editor) return
		setIsPublishing(true)
		setPublishMessage('Creating copy...')
		setPublishError(null)

		try {
			const collection = buildCollectionFromEditor()
			if (!collection) throw new Error('No features to publish')

			if (!ndk) {
				setPublishError('NDK is not ready.')
				return
			}

			const event = new NDKGeoEventClass(ndk)
			event.featureCollection = collection
			event.blobReferences = serializeBlobReferences()
			await event.publishNew()
			setPublishMessage('Dataset copy published successfully.')
			setActiveDataset(event)
			setCollectionMeta(extractCollectionMeta(collection))
			setSelectedFeatureIds([])
		} catch (error) {
			console.error('Failed to publish dataset copy', error)
			setPublishError('Failed to publish dataset copy. Check console for details.')
		} finally {
			setIsPublishing(false)
		}
	}, [
		editor,
		setIsPublishing,
		setPublishMessage,
		setPublishError,
		buildCollectionFromEditor,
		ndk,
		serializeBlobReferences,
		setActiveDataset,
		setCollectionMeta,
		setSelectedFeatureIds,
	])

	const handleDeleteDataset = useCallback(
		async (event: NDKGeoEvent, onClear: () => void) => {
			if (!ndk) {
				alert('NDK is not ready.')
				return
			}
			if (!event.datasetId) {
				alert('Dataset is missing a d tag and cannot be deleted.')
				return
			}
			if (!confirm(`Delete dataset "${getDatasetName(event)}"? This action cannot be undone.`)) {
				return
			}

			const key = getDatasetKey(event)
			try {
				await NDKGeoEventClass.deleteDataset(ndk, event)
				if (activeDataset && getDatasetKey(activeDataset) === key) {
					onClear()
				}
			} catch (error) {
				console.error('Failed to delete dataset', error)
				alert('Failed to delete dataset. Check console for details.')
			}
		},
		[ndk, activeDataset, getDatasetKey, getDatasetName],
	)

	// Computed permissions
	const canPublishNew = features.length > 0 && !activeDataset
	const canPublishUpdate =
		!!activeDataset && currentUserPubkey === activeDataset?.pubkey && features.length > 0
	const canPublishCopy =
		!!activeDataset && currentUserPubkey !== activeDataset?.pubkey && features.length > 0

	return {
		// Actions
		handlePublishNew,
		handlePublishUpdate,
		handlePublishCopy,
		handleDeleteDataset,
		handlePublishWithBlossomUpload,
		buildCollectionFromEditor,
		serializeBlobReferences,
		// Size helpers
		getCollectionSize,
		isOverSizeLimit,
		currentCollectionSize,
		sizeThreshold: BLOSSOM_UPLOAD_THRESHOLD_BYTES,
		// Computed
		canPublishNew,
		canPublishUpdate,
		canPublishCopy,
	}
}

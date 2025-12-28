import { useEditorStore } from '../../features/geo-editor/store'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

/**
 * Section for managing external GeoJSON blob references.
 * Allows users to attach remote GeoJSON files that will be referenced via blob tags.
 */
export function BlobReferencesSection() {
	const blobReferences = useEditorStore((state) => state.blobReferences)
	const blobDraftUrl = useEditorStore((state) => state.blobDraftUrl)
	const setBlobDraftUrl = useEditorStore((state) => state.setBlobDraftUrl)
	const blobDraftStatus = useEditorStore((state) => state.blobDraftStatus)
	const blobDraftError = useEditorStore((state) => state.blobDraftError)
	const previewingBlobReferenceId = useEditorStore((state) => state.previewingBlobReferenceId)
	const fetchBlobReference = useEditorStore((state) => state.fetchBlobReference)
	const previewBlobReference = useEditorStore((state) => state.previewBlobReference)
	const removeBlobReference = useEditorStore((state) => state.removeBlobReference)

	return (
		<section className="rounded-lg border border-gray-200 p-3 space-y-3">
			<div>
				<h4 className="text-sm font-semibold text-gray-800">External geometry references</h4>
				<p className="text-xs text-gray-500">
					Link remote GeoJSON blobs for oversized geometries. They will be referenced via blob tags
					when publishing.
				</p>
			</div>

			{/* Add new reference */}
			<div className="flex flex-col gap-2">
				<Input
					placeholder="https://example.org/dataset.geojson"
					value={blobDraftUrl}
					onChange={(e) => setBlobDraftUrl(e.target.value)}
					disabled={blobDraftStatus === 'loading'}
				/>
				<Button
					onClick={fetchBlobReference}
					disabled={!blobDraftUrl || blobDraftStatus === 'loading'}
				>
					{blobDraftStatus === 'loading' ? 'Fetching…' : 'Fetch & attach'}
				</Button>
				{blobDraftStatus === 'error' && blobDraftError && (
					<p className="text-xs text-red-600">{blobDraftError}</p>
				)}
			</div>

			{/* Reference list */}
			<div className="space-y-2">
				{blobReferences.length === 0 && (
					<p className="text-xs text-gray-500">No external references added yet.</p>
				)}
				{blobReferences.map((reference) => {
					const isPreviewing =
						previewingBlobReferenceId === reference.id && reference.status === 'ready'
					return (
						<div
							key={reference.id}
							className="rounded border border-gray-200 p-3 text-sm space-y-2 bg-white"
						>
							<div className="flex items-start justify-between gap-2">
								<div className="space-y-1">
									<div className="font-semibold text-gray-900 break-all">{reference.url}</div>
									<div className="text-[11px] text-gray-500 space-x-2">
										<span>
											Scope: {reference.scope === 'feature' ? 'Single feature' : 'Full collection'}
										</span>
										{reference.scope === 'feature' && reference.featureId && (
											<span>Feature ID: {reference.featureId}</span>
										)}
									</div>
									{reference.featureCount !== undefined && (
										<div className="text-[11px] text-gray-500 space-x-2">
											<span>Features: {reference.featureCount}</span>
											{reference.geometryTypes && reference.geometryTypes.length > 0 && (
												<span>Geometry: {reference.geometryTypes.join(', ')}</span>
											)}
										</div>
									)}
									<div className="text-[11px] text-gray-500">
										Status:{' '}
										{reference.status === 'loading'
											? 'Loading…'
											: reference.status === 'error'
												? (reference.error ?? 'Error')
												: 'Ready'}
									</div>
									{reference.status === 'error' && reference.error && (
										<div className="text-[11px] text-red-600">{reference.error}</div>
									)}
								</div>
								<Button
									variant="ghost"
									size="sm"
									className="text-red-600"
									onClick={() => removeBlobReference(reference.id)}
								>
									Remove
								</Button>
							</div>
							<div className="flex gap-2">
								<Button
									size="sm"
									variant="outline"
									onClick={() => previewBlobReference(reference.id)}
									disabled={reference.status === 'loading'}
								>
									{reference.status === 'loading'
										? 'Loading…'
										: isPreviewing
											? 'Previewing'
											: 'Preview on map'}
								</Button>
							</div>
						</div>
					)
				})}
			</div>
		</section>
	)
}

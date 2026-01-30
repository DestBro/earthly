/**
 * Blossom Upload Dialog
 * 
 * Shows a warning when dataset size exceeds the Nostr event limit
 * and offers to upload the geometry to the Blossom server.
 */

import type { FeatureCollection } from 'geojson'
import { AlertTriangle, Cloud, CloudUpload, Loader2, CheckCircle2 } from 'lucide-react'
import { useState, useMemo } from 'react'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from './ui/dialog'
import { Button } from './ui/button'
import { Progress } from './ui/progress'
import { 
	uploadGeoJsonToBlossom, 
	formatBytes, 
	type BlossomUploadResult 
} from '../lib/blossom/blossomUpload'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '../features/geo-editor/constants'

export interface BlossomUploadDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	geojson: FeatureCollection | null
	/** Called when upload completes successfully */
	onUploadComplete: (result: BlossomUploadResult) => void
	/** Called when user chooses to skip upload (only if allowSkip is true) */
	onSkip?: () => void
	/** Allow skipping the upload (for optional uploads) */
	allowSkip?: boolean
	/** Title override */
	title?: string
}

type UploadState = 'idle' | 'uploading' | 'success' | 'error'

export function BlossomUploadDialog({
	open,
	onOpenChange,
	geojson,
	onUploadComplete,
	onSkip,
	allowSkip = false,
	title = 'Dataset Size Warning',
}: BlossomUploadDialogProps) {
	const [uploadState, setUploadState] = useState<UploadState>('idle')
	const [uploadProgress, setUploadProgress] = useState(0)
	const [uploadError, setUploadError] = useState<string | null>(null)
	const [uploadResult, setUploadResult] = useState<BlossomUploadResult | null>(null)

	// Calculate current size
	const { size, percentOfLimit, isOverLimit } = useMemo(() => {
		if (!geojson) {
			return { size: 0, percentOfLimit: 0, isOverLimit: false }
		}
		const jsonString = JSON.stringify(geojson)
		const bytes = new TextEncoder().encode(jsonString).length
		const percent = (bytes / BLOSSOM_UPLOAD_THRESHOLD_BYTES) * 100
		return {
			size: bytes,
			percentOfLimit: percent,
			isOverLimit: bytes > BLOSSOM_UPLOAD_THRESHOLD_BYTES,
		}
	}, [geojson])

	const handleUpload = async () => {
		if (!geojson) return

		setUploadState('uploading')
		setUploadError(null)
		setUploadProgress(0)

		try {
			const result = await uploadGeoJsonToBlossom(geojson, {
				onProgress: setUploadProgress,
			})
			setUploadResult(result)
			setUploadState('success')
			onUploadComplete(result)
		} catch (error) {
			setUploadError(error instanceof Error ? error.message : 'Upload failed')
			setUploadState('error')
		}
	}

	const handleClose = () => {
		// Reset state when closing
		setUploadState('idle')
		setUploadProgress(0)
		setUploadError(null)
		setUploadResult(null)
		onOpenChange(false)
	}

	const handleSkip = () => {
		handleClose()
		onSkip?.()
	}

	return (
		<Dialog open={open} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						{uploadState === 'success' ? (
							<CheckCircle2 className="h-5 w-5 text-green-500" />
						) : isOverLimit ? (
							<AlertTriangle className="h-5 w-5 text-amber-500" />
						) : (
							<Cloud className="h-5 w-5 text-blue-500" />
						)}
						{uploadState === 'success' ? 'Upload Complete' : title}
					</DialogTitle>
					<DialogDescription>
						{uploadState === 'success' ? (
							'Your geometry has been uploaded to Blossom and will be referenced in the Nostr event.'
						) : isOverLimit ? (
							<>
								Your dataset is <strong>{formatBytes(size)}</strong>, which exceeds
								the <strong>{formatBytes(BLOSSOM_UPLOAD_THRESHOLD_BYTES)}</strong> limit
								for Nostr events.
							</>
						) : (
							<>
								Upload your geometry to Blossom for external storage. 
								Current size: <strong>{formatBytes(size)}</strong>
							</>
						)}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{/* Size progress bar */}
					{uploadState === 'idle' && (
						<div className="space-y-2">
							<div className="flex justify-between text-xs text-muted-foreground">
								<span>Dataset size</span>
								<span>{Math.round(percentOfLimit)}% of limit</span>
							</div>
							<Progress 
								value={Math.min(percentOfLimit, 100)} 
								className={percentOfLimit > 100 ? '[&>div]:bg-amber-500' : ''}
							/>
							{percentOfLimit > 100 && (
								<p className="text-xs text-amber-600">
									⚠️ {Math.round(percentOfLimit - 100)}% over the limit
								</p>
							)}
						</div>
					)}

					{/* Upload progress */}
					{uploadState === 'uploading' && (
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="h-4 w-4 animate-spin" />
								Uploading to Blossom...
							</div>
							<Progress value={uploadProgress} />
						</div>
					)}

					{/* Success state */}
					{uploadState === 'success' && uploadResult && (
						<div className="space-y-2 rounded-md bg-green-50 p-3 text-sm">
							<p className="font-medium text-green-800">
								Uploaded successfully!
							</p>
							<p className="text-xs text-green-700 break-all">
								{uploadResult.url}
							</p>
							<p className="text-xs text-green-600">
								Size: {formatBytes(uploadResult.size)}
							</p>
						</div>
					)}

					{/* Error state */}
					{uploadState === 'error' && uploadError && (
						<div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
							{uploadError}
						</div>
					)}

					{/* Info text */}
					{uploadState === 'idle' && (
						<div className="text-xs text-muted-foreground">
							<p>
								Uploading to Blossom stores the full geometry externally. 
								The Nostr event will contain a reference link and metadata for discovery.
							</p>
						</div>
					)}
				</div>

				<DialogFooter className="gap-2 sm:gap-0">
					{uploadState === 'idle' && (
						<>
							{allowSkip && onSkip && (
								<Button variant="outline" onClick={handleSkip}>
									Skip
								</Button>
							)}
							<Button variant="ghost" onClick={handleClose}>
								Cancel
							</Button>
							<Button onClick={handleUpload} className="gap-2">
								<CloudUpload className="h-4 w-4" />
								Upload to Blossom
							</Button>
						</>
					)}
					{uploadState === 'uploading' && (
						<Button disabled>
							<Loader2 className="h-4 w-4 animate-spin mr-2" />
							Uploading...
						</Button>
					)}
					{uploadState === 'success' && (
						<Button onClick={handleClose}>
							Done
						</Button>
					)}
					{uploadState === 'error' && (
						<>
							<Button variant="outline" onClick={handleClose}>
								Cancel
							</Button>
							<Button onClick={handleUpload}>
								Retry
							</Button>
						</>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}

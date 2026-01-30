/**
 * Dataset Size Indicator
 * 
 * Shows the current dataset size with a progress bar relative to the upload threshold.
 * Displays a warning when over limit and offers to upload to Blossom.
 */

import { AlertTriangle, CloudUpload, CheckCircle2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Progress } from '../ui/progress'
import { Button } from '../ui/button'
import { 
	BLOSSOM_UPLOAD_THRESHOLD_BYTES, 
} from '../../features/geo-editor/constants'
import { 
	formatBytes, 
	uploadGeoJsonToBlossom,
	type BlossomUploadResult 
} from '../../lib/blossom/blossomUpload'
import type { FeatureCollection } from 'geojson'
import { cn } from '@/lib/utils'

interface DatasetSizeIndicatorProps {
	/** The current feature collection to measure */
	featureCollection: FeatureCollection | null
	/** Called when upload completes successfully */
	onUploadComplete?: (result: BlossomUploadResult) => void
	/** Show compact version */
	compact?: boolean
	className?: string
}

export function DatasetSizeIndicator({
	featureCollection,
	onUploadComplete,
	compact = false,
	className,
}: DatasetSizeIndicatorProps) {
	const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle')
	const [uploadError, setUploadError] = useState<string | null>(null)

	const { size, percentOfLimit, isOverLimit } = useMemo(() => {
		if (!featureCollection) {
			return { size: 0, percentOfLimit: 0, isOverLimit: false }
		}
		const jsonString = JSON.stringify(featureCollection)
		const bytes = new TextEncoder().encode(jsonString).length
		const percent = (bytes / BLOSSOM_UPLOAD_THRESHOLD_BYTES) * 100
		return {
			size: bytes,
			percentOfLimit: percent,
			isOverLimit: bytes > BLOSSOM_UPLOAD_THRESHOLD_BYTES,
		}
	}, [featureCollection])

	const handleUpload = async () => {
		if (!featureCollection) return

		setUploadState('uploading')
		setUploadError(null)

		try {
			const result = await uploadGeoJsonToBlossom(featureCollection)
			setUploadState('success')
			onUploadComplete?.(result)
		} catch (error) {
			setUploadError(error instanceof Error ? error.message : 'Upload failed')
			setUploadState('error')
		}
	}

	// Don't show if no data
	if (!featureCollection || size === 0) {
		return null
	}

	// Compact version - just shows warning icon when over limit
	if (compact) {
		if (!isOverLimit) return null
		return (
			<div className={cn('flex items-center gap-1 text-amber-600', className)}>
				<AlertTriangle className="h-3 w-3" />
				<span className="text-[10px]">{formatBytes(size)} / {formatBytes(BLOSSOM_UPLOAD_THRESHOLD_BYTES)}</span>
			</div>
		)
	}

	return (
		<div className={cn('space-y-2 rounded-md border p-2', 
			isOverLimit ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50',
			className
		)}>
			{/* Header */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-1.5">
					{isOverLimit ? (
						<AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
					) : (
						<CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
					)}
					<span className="text-xs font-medium">
						{isOverLimit ? 'Dataset too large' : 'Dataset size OK'}
					</span>
				</div>
				<span className="text-[10px] text-gray-500">
					{formatBytes(size)} / {formatBytes(BLOSSOM_UPLOAD_THRESHOLD_BYTES)}
				</span>
			</div>

			{/* Progress bar */}
			<Progress 
				value={Math.min(percentOfLimit, 100)} 
				className={cn(
					'h-1.5',
					percentOfLimit > 100 && '[&>div]:bg-amber-500',
					percentOfLimit <= 100 && '[&>div]:bg-green-500'
				)}
			/>

			{/* Warning message and upload button */}
			{isOverLimit && (
				<div className="space-y-2">
					<p className="text-[10px] text-amber-700">
						This dataset exceeds the Nostr event limit. 
						Upload to Blossom to store externally.
					</p>
					
					{uploadState === 'idle' && (
						<Button 
							size="sm" 
							variant="outline"
							onClick={handleUpload}
							className="w-full gap-1.5 h-7 text-xs border-amber-300 hover:bg-amber-100"
						>
							<CloudUpload className="h-3 w-3" />
							Upload to Blossom
						</Button>
					)}

					{uploadState === 'uploading' && (
						<Button size="sm" disabled className="w-full h-7 text-xs">
							Uploading...
						</Button>
					)}

					{uploadState === 'success' && (
						<div className="text-[10px] text-green-600 flex items-center gap-1">
							<CheckCircle2 className="h-3 w-3" />
							Uploaded successfully! Ready to publish.
						</div>
					)}

					{uploadState === 'error' && uploadError && (
						<div className="space-y-1">
							<p className="text-[10px] text-red-600">{uploadError}</p>
							<Button 
								size="sm" 
								variant="outline"
								onClick={handleUpload}
								className="w-full h-7 text-xs"
							>
								Retry
							</Button>
						</div>
					)}
				</div>
			)}
		</div>
	)
}

/**
 * Hook to get the current dataset size info for use in other components.
 */
export function useDatasetSize(featureCollection: FeatureCollection | null) {
	return useMemo(() => {
		if (!featureCollection) {
			return { size: 0, percentOfLimit: 0, isOverLimit: false, formattedSize: '0 B' }
		}
		const jsonString = JSON.stringify(featureCollection)
		const bytes = new TextEncoder().encode(jsonString).length
		const percent = (bytes / BLOSSOM_UPLOAD_THRESHOLD_BYTES) * 100
		return {
			size: bytes,
			percentOfLimit: percent,
			isOverLimit: bytes > BLOSSOM_UPLOAD_THRESHOLD_BYTES,
			formattedSize: formatBytes(bytes),
		}
	}, [featureCollection])
}

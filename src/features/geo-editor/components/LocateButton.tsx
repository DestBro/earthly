import { Loader2, Locate, LocateFixed, LocateOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../../../components/ui/button'
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '../../../components/ui/tooltip'

type LocateStatus = 'idle' | 'loading' | 'tracking' | 'error'

interface LocateButtonProps {
	onLocate: (coords: { lat: number; lon: number; accuracy?: number } | null) => void
	className?: string
}

export function LocateButton({ onLocate, className = '' }: LocateButtonProps) {
	const [status, setStatus] = useState<LocateStatus>('idle')
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const watchIdRef = useRef<number | null>(null)

	// Clean up watch on unmount
	useEffect(() => {
		return () => {
			if (watchIdRef.current !== null) {
				navigator.geolocation.clearWatch(watchIdRef.current)
				watchIdRef.current = null
			}
		}
	}, [])

	const stopTracking = useCallback(() => {
		if (watchIdRef.current !== null) {
			navigator.geolocation.clearWatch(watchIdRef.current)
			watchIdRef.current = null
		}
		setStatus('idle')
		onLocate(null) // Clear the marker
	}, [onLocate])

	const startTracking = useCallback(() => {
		if (!navigator.geolocation) {
			setStatus('error')
			setErrorMessage('Geolocation is not supported by your browser')
			setTimeout(() => {
				setStatus('idle')
				setErrorMessage(null)
			}, 3000)
			return
		}

		setStatus('loading')
		setErrorMessage(null)

		// Start watching position for continuous updates
		watchIdRef.current = navigator.geolocation.watchPosition(
			(position) => {
				const { latitude, longitude, accuracy } = position.coords
				setStatus('tracking')
				onLocate({ lat: latitude, lon: longitude, accuracy })
			},
			(error) => {
				setStatus('error')
				switch (error.code) {
					case error.PERMISSION_DENIED:
						setErrorMessage('Location permission denied')
						break
					case error.POSITION_UNAVAILABLE:
						setErrorMessage('Location unavailable')
						break
					case error.TIMEOUT:
						setErrorMessage('Location request timed out')
						break
					default:
						setErrorMessage('Failed to get location')
				}
				// Reset error after a delay
				setTimeout(() => {
					setStatus('idle')
					setErrorMessage(null)
				}, 3000)
				// Clear the watch on error
				if (watchIdRef.current !== null) {
					navigator.geolocation.clearWatch(watchIdRef.current)
					watchIdRef.current = null
				}
			},
			{
				enableHighAccuracy: true,
				timeout: 10000,
				maximumAge: 5000,
			},
		)
	}, [onLocate])

	const handleClick = useCallback(() => {
		if (status === 'tracking') {
			stopTracking()
		} else if (status === 'idle' || status === 'error') {
			startTracking()
		}
	}, [status, startTracking, stopTracking])

	const getIcon = () => {
		switch (status) {
			case 'loading':
				return <Loader2 className="h-5 w-5 animate-spin" />
			case 'tracking':
				return <LocateFixed className="h-5 w-5" />
			case 'error':
				return <LocateOff className="h-5 w-5" />
			default:
				return <Locate className="h-5 w-5" />
		}
	}

	const getVariant = () => {
		switch (status) {
			case 'tracking':
				return 'default'
			case 'error':
				return 'destructive'
			default:
				return 'outline'
		}
	}

	const getTooltipText = () => {
		if (errorMessage) return errorMessage
		switch (status) {
			case 'loading':
				return 'Getting location...'
			case 'tracking':
				return 'Stop tracking'
			default:
				return 'Track my location'
		}
	}

	return (
		<TooltipProvider delayDuration={300}>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant={getVariant()}
						size="icon"
						className={`shadow-lg h-10 w-10 rounded-full bg-white/95 backdrop-blur hover:bg-white ${className}`}
						onClick={handleClick}
						disabled={status === 'loading'}
						aria-label={status === 'tracking' ? 'Stop tracking location' : 'Track my location'}
					>
						{getIcon()}
					</Button>
				</TooltipTrigger>
				<TooltipContent side="left" sideOffset={8}>
					<p>{getTooltipText()}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	)
}

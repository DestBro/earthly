import { useState } from 'react'
import type { FeaturePopupData } from '../components/FeaturePopup'

export function useFeaturePopup() {
	const [featurePopupData, setFeaturePopupData] = useState<FeaturePopupData | null>(null)

	return {
		featurePopupData,
		setFeaturePopupData,
	}
}

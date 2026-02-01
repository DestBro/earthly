import { useCallback, useState } from 'react'
import {
	DEFAULT_FILTER_STATE,
	type FilterActions,
	type FilterState,
	type SortConfig,
} from './types'

export function useFilterState(): FilterState & FilterActions {
	const [state, setState] = useState<FilterState>(DEFAULT_FILTER_STATE)

	const setSearchQuery = useCallback((query: string) => {
		setState((prev) => ({ ...prev, searchQuery: query }))
	}, [])

	const setSortConfig = useCallback((sortConfig: SortConfig) => {
		setState((prev) => ({ ...prev, sortConfig }))
	}, [])

	const setDisplayLimit = useCallback((limit: number) => {
		setState((prev) => ({ ...prev, displayLimit: limit }))
	}, [])

	const resetFilters = useCallback(() => {
		setState(DEFAULT_FILTER_STATE)
	}, [])

	return {
		...state,
		setSearchQuery,
		setSortConfig,
		setDisplayLimit,
		resetFilters,
	}
}

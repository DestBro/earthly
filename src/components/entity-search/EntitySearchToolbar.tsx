import { ArrowDownAZ, ArrowUpZA, Clock } from 'lucide-react'
import {
	LIMIT_OPTIONS,
	type FilterActions,
	type FilterState,
	type SortDirection,
	type SortField,
} from '@/components/data-filter/types'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { EntitySearchInput } from './EntitySearchInput'

interface EntitySearchToolbarProps extends FilterState, FilterActions {
	totalCount: number
	filteredCount: number
	displayedCount: number
	hasMore: boolean
	placeholder?: string
}

const SORT_OPTIONS: {
	value: `${SortField}-${SortDirection}`
	label: string
	icon: typeof Clock
}[] = [
	{ value: 'recency-desc', label: 'Newest', icon: Clock },
	{ value: 'recency-asc', label: 'Oldest', icon: Clock },
	{ value: 'name-asc', label: 'A-Z', icon: ArrowDownAZ },
	{ value: 'name-desc', label: 'Z-A', icon: ArrowUpZA },
]

export function EntitySearchToolbar({
	searchQuery,
	sortConfig,
	displayLimit,
	setSearchQuery,
	setSortConfig,
	setDisplayLimit,
	totalCount,
	filteredCount,
	displayedCount,
	placeholder,
}: EntitySearchToolbarProps) {
	const sortValue = `${sortConfig.field}-${sortConfig.direction}` as const

	const handleSortChange = (value: string) => {
		const [field, direction] = value.split('-') as [SortField, SortDirection]
		setSortConfig({ field, direction })
	}

	return (
		<div className="flex items-center gap-1.5">
			<EntitySearchInput
				value={searchQuery}
				onChange={setSearchQuery}
				placeholder={placeholder}
				compact
				className="flex-1 min-w-0"
			/>
			<Select value={sortValue} onValueChange={handleSortChange}>
				<SelectTrigger size="sm" className="w-[75px] h-7 text-xs">
					<SelectValue placeholder="Sort" />
				</SelectTrigger>
				<SelectContent>
					{SORT_OPTIONS.map((opt) => (
						<SelectItem key={opt.value} value={opt.value}>
							<span className="flex items-center gap-1.5">
								<opt.icon className="h-3 w-3" />
								{opt.label}
							</span>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<Select value={String(displayLimit)} onValueChange={(v) => setDisplayLimit(Number(v))}>
				<SelectTrigger size="sm" className="w-[70px] h-7 text-xs">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{LIMIT_OPTIONS.map((limit) => (
						<SelectItem key={limit} value={String(limit)}>
							Show {limit}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<span className="text-[11px] text-gray-500 whitespace-nowrap">
				{displayedCount}/{filteredCount}
				{filteredCount !== totalCount && ` (${totalCount})`}
			</span>
		</div>
	)
}

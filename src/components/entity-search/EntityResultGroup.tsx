import type { EntitySearchResultGroup } from './types'
import type { ReactNode } from 'react'

interface EntityResultGroupProps {
	group: EntitySearchResultGroup
	children: ReactNode
}

export function EntityResultGroup({ group, children }: EntityResultGroupProps) {
	return (
		<div>
			<div className="flex items-center justify-between px-2 py-1">
				<span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
					{group.label}
				</span>
				<span className="text-[10px] text-muted-foreground">
					{group.filteredCount}/{group.totalCount}
				</span>
			</div>
			{children}
		</div>
	)
}

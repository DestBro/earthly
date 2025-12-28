import { HelpCircle } from 'lucide-react'
import { Button } from './ui/button'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'

interface HelpPopoverProps {
	multiSelectModifier?: string
}

export function HelpPopover({ multiSelectModifier = 'Shift' }: HelpPopoverProps) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button size="icon" variant="ghost" aria-label="Help & shortcuts">
					<HelpCircle className="h-4 w-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72 text-xs" align="end">
				<div className="space-y-3">
					<div>
						<h4 className="font-semibold text-gray-900 mb-1">Selection</h4>
						<ul className="text-gray-600 space-y-0.5">
							<li>• Click a feature to select it</li>
							<li>
								• Hold <strong>{multiSelectModifier}</strong> to multi-select
							</li>
							<li>• Drag to box-select</li>
						</ul>
					</div>

					<div>
						<h4 className="font-semibold text-gray-900 mb-1">Drawing</h4>
						<ul className="text-gray-600 space-y-0.5">
							<li>• Click to add points</li>
							<li>
								• Double-click or <strong>Enter</strong> to finish
							</li>
							<li>
								• <strong>Escape</strong> to cancel
							</li>
						</ul>
					</div>

					<div>
						<h4 className="font-semibold text-gray-900 mb-1">Keyboard Shortcuts</h4>
						<div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-gray-600">
							<span>
								<kbd className="px-1 bg-gray-100 rounded">⌘/Ctrl+Z</kbd>
							</span>
							<span>Undo</span>
							<span>
								<kbd className="px-1 bg-gray-100 rounded">⌘/Ctrl+⇧+Z</kbd>
							</span>
							<span>Redo</span>
							<span>
								<kbd className="px-1 bg-gray-100 rounded">Delete</kbd>
							</span>
							<span>Delete selected</span>
							<span>
								<kbd className="px-1 bg-gray-100 rounded">Enter</kbd>
							</span>
							<span>Finish drawing</span>
							<span>
								<kbd className="px-1 bg-gray-100 rounded">Esc</kbd>
							</span>
							<span>Cancel</span>
						</div>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	)
}

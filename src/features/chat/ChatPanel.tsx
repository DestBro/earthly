import { useState, useEffect, useRef } from 'react'
import { useChatStore } from './store'
import { useNip60Store } from '@/lib/stores/nip60'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import {
	Loader2,
	Send,
	Trash2,
	Wallet,
	Bot,
	User,
	AlertCircle,
	Wrench,
	MapPin,
	ToggleLeft,
	ToggleRight,
	Server,
} from 'lucide-react'
import type { ChatMessage, ToolCall, ProviderType } from './routstr'
import { cn } from '@/lib/utils'

export function ChatPanel() {
	const {
		messages,
		models,
		selectedModel,
		modelsLoading,
		modelsError,
		isStreaming,
		streamingContent,
		executingTools,
		toolsEnabled,
		error,
		totalSpent,
		provider,
		customEndpoint,
		customApiKey,
		setProvider,
		setCustomEndpoint,
		setCustomApiKey,
		loadModels,
		setSelectedModel,
		setToolsEnabled,
		sendMessage,
		clearMessages,
		cancelStream,
	} = useChatStore()

	const { status: walletStatus, balance: walletBalance } = useNip60Store()

	const [input, setInput] = useState('')
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	// Load models on mount
	useEffect(() => {
		if (models.length === 0 && !modelsLoading && !modelsError) {
			loadModels()
		}
	}, [models.length, modelsLoading, modelsError, loadModels])

	// Auto-scroll to bottom when messages change
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messages, streamingContent])

	// Auto-resize textarea
	useEffect(() => {
		if (textareaRef.current) {
			textareaRef.current.style.height = 'auto'
			textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`
		}
	}, [input])

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!input.trim() || isStreaming) return

		const message = input.trim()
		setInput('')
		await sendMessage(message)
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			handleSubmit(e)
		}
	}

	const selectedModelData = models.find((m) => m.id === selectedModel)
	const isWalletRequired = provider === 'routstr'
	const canSend = !!selectedModel && (!isWalletRequired || walletStatus === 'ready')

	return (
		<div className="flex flex-col h-full">
			{/* Header with provider, model picker and wallet info */}
			<div className="p-3 border-b space-y-2">
				{/* Provider selector */}
				<div className="flex items-center gap-2">
					<Select
						value={provider}
						onValueChange={(v) => setProvider(v as ProviderType)}
						disabled={isStreaming}
					>
						<SelectTrigger className="flex-1">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="routstr">Routstr (paid)</SelectItem>
							<SelectItem value="lmstudio">LM Studio</SelectItem>
							<SelectItem value="ollama">Ollama</SelectItem>
							<SelectItem value="custom">Custom endpoint</SelectItem>
						</SelectContent>
					</Select>
					<Button
						variant="ghost"
						size="icon"
						onClick={clearMessages}
						disabled={messages.length === 0 || isStreaming}
						title="Clear chat"
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>

				{/* Custom endpoint config */}
				{provider === 'custom' && (
					<div className="space-y-1.5">
						<Input
							placeholder="http://localhost:8080/v1"
							value={customEndpoint}
							onChange={(e) => setCustomEndpoint(e.target.value)}
							disabled={isStreaming}
							className="text-xs h-7"
						/>
						<Input
							placeholder="API key (optional)"
							type="password"
							value={customApiKey}
							onChange={(e) => setCustomApiKey(e.target.value)}
							disabled={isStreaming}
							className="text-xs h-7"
						/>
						<Button
							variant="outline"
							size="sm"
							className="h-7 text-xs w-full"
							onClick={loadModels}
							disabled={!customEndpoint || isStreaming}
						>
							Connect
						</Button>
					</div>
				)}

				{/* Model picker */}
				<div className="flex items-center gap-2">
					<Select
						value={selectedModel || ''}
						onValueChange={setSelectedModel}
						disabled={modelsLoading || isStreaming}
					>
						<SelectTrigger className="flex-1">
							<SelectValue placeholder={modelsLoading ? 'Loading models...' : 'Select model'} />
						</SelectTrigger>
						<SelectContent>
							{models.map((model) => (
								<SelectItem key={model.id} value={model.id}>
									<div className="flex flex-col">
										<span>{model.name}</span>
										{isWalletRequired && (model.pricing.input > 0 || model.pricing.output > 0) && (
											<span className="text-xs text-muted-foreground">
												{model.pricing.input}/{model.pricing.output} sats/M tokens
											</span>
										)}
									</div>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{/* Wallet status / provider info and tools toggle */}
				<div className="flex items-center justify-between text-sm">
					{isWalletRequired ? (
						<div className="flex items-center gap-1.5 text-muted-foreground">
							<Wallet className="h-3.5 w-3.5" />
							{walletStatus === 'ready' ? (
								<span>{walletBalance.toLocaleString()} sats</span>
							) : walletStatus === 'initializing' ? (
								<span className="flex items-center gap-1">
									<Loader2 className="h-3 w-3 animate-spin" />
									Loading...
								</span>
							) : (
								<span className="text-destructive">Wallet not connected</span>
							)}
						</div>
					) : (
						<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
							<Server className="h-3.5 w-3.5" />
							<span>Local - free</span>
						</div>
					)}
					<div className="flex items-center gap-2">
						{totalSpent > 0 && (
							<span className="text-xs text-muted-foreground">Spent: {totalSpent} sats</span>
						)}
						<button
							type="button"
							onClick={() => setToolsEnabled(!toolsEnabled)}
							className={cn(
								'flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors',
								toolsEnabled
									? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
									: 'bg-muted text-muted-foreground',
							)}
							title={
								toolsEnabled
									? 'Geo + map editor tools enabled (GPT/Claude models recommended)'
									: 'Geo tools disabled - click to enable'
							}
						>
							<MapPin className="h-3 w-3" />
							<span>Tools</span>
							{toolsEnabled ? (
								<ToggleRight className="h-3.5 w-3.5" />
							) : (
								<ToggleLeft className="h-3.5 w-3.5" />
							)}
						</button>
					</div>
				</div>

				{/* Errors */}
				{modelsError && (
					<div className="flex items-center gap-1.5 text-xs text-destructive">
						<AlertCircle className="h-3.5 w-3.5" />
						{modelsError}
						<Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={loadModels}>
							Retry
						</Button>
					</div>
				)}
			</div>

			{/* Messages */}
			<div className="flex-1 overflow-y-auto p-3 space-y-4">
				{messages.length === 0 && !isStreaming ? (
					<div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground p-4">
						<Bot className="h-12 w-12 mb-4 opacity-50" />
						<p className="text-sm font-medium">AI Chat</p>
						<p className="text-xs mt-1">
							{isWalletRequired
								? 'Pay per message with eCash. Unused funds are refunded automatically.'
								: 'Running locally \u2014 no payment required.'}
						</p>
						{selectedModelData && <p className="text-xs mt-2">Using {selectedModelData.name}</p>}
						{toolsEnabled && (
							<p className="text-xs mt-2 text-orange-600 dark:text-orange-400">
								<MapPin className="inline h-3 w-3 mr-1" />
								Geo tools enabled (search, OSM queries, and import directly into the editor)
							</p>
						)}
					</div>
				) : (
					<>
						{messages.map((message, index) => (
							<MessageBubble key={index} message={message} />
						))}

						{/* Streaming message */}
						{isStreaming && streamingContent && (
							<MessageBubble
								message={{ role: 'assistant', content: streamingContent }}
								isStreaming
							/>
						)}

						{/* Streaming/executing indicator */}
						{isStreaming && !streamingContent && (
							<div className="flex gap-2">
								<div
									className={cn(
										'flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center',
										executingTools ? 'bg-orange-100 dark:bg-orange-900' : 'bg-muted',
									)}
								>
									{executingTools ? (
										<Wrench className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
									) : (
										<Bot className="h-3.5 w-3.5" />
									)}
								</div>
								<div
									className={cn(
										'rounded-lg px-3 py-2 text-sm flex items-center gap-2',
										executingTools
											? 'bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800'
											: 'bg-muted',
									)}
								>
									<span className="animate-pulse">
										{executingTools ? 'Executing map tools...' : 'Thinking...'}
									</span>
									<Loader2 className="h-4 w-4 animate-spin" />
								</div>
							</div>
						)}

						<div ref={messagesEndRef} />
					</>
				)}
			</div>

			{/* Error display */}
			{error && (
				<div className="px-3 py-2 text-xs text-destructive bg-destructive/10 border-t">{error}</div>
			)}

			{/* Input */}
			<form onSubmit={handleSubmit} className="p-3 border-t">
				<div className="flex gap-2">
					<textarea
						ref={textareaRef}
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder={
							!selectedModel
								? 'Select a model...'
								: isWalletRequired && walletStatus !== 'ready'
									? 'Connect wallet to chat...'
									: 'Type a message...'
						}
						disabled={isStreaming || !canSend}
						className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[38px] max-h-[150px]"
						rows={1}
					/>
					{isStreaming ? (
						<Button
							type="button"
							variant="destructive"
							size="icon"
							onClick={cancelStream}
							title="Stop"
						>
							<span className="h-3 w-3 bg-current" />
						</Button>
					) : (
						<Button type="submit" size="icon" disabled={!input.trim() || !canSend} title="Send">
							<Send className="h-4 w-4" />
						</Button>
					)}
				</div>
			</form>
		</div>
	)
}

interface MessageBubbleProps {
	message: ChatMessage
	isStreaming?: boolean
}

interface ParsedAssistantContent {
	answerText: string
	reasoningBlocks: string[]
}

function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
	const isUser = message.role === 'user'
	const isTool = message.role === 'tool'
	const isAssistant = message.role === 'assistant'
	const hasToolCalls =
		message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0
	const parsedAssistantContent: ParsedAssistantContent = isAssistant
		? parseAssistantContent(message.content || '')
		: { answerText: message.content || '', reasoningBlocks: [] }

	// Tool result message
	if (isTool) {
		return (
			<div className="flex gap-2 ml-8">
				<div className="flex-shrink-0 h-5 w-5 rounded flex items-center justify-center bg-blue-100 dark:bg-blue-900">
					<MapPin className="h-3 w-3 text-blue-600 dark:text-blue-400" />
				</div>
				<div className="rounded-lg px-3 py-2 max-w-[85%] text-xs bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
					<p className="font-medium text-blue-700 dark:text-blue-300 mb-1">Tool Result</p>
					<pre className="whitespace-pre-wrap break-words text-muted-foreground overflow-x-auto max-h-32 overflow-y-auto">
						{truncateToolResult(message.content || '')}
					</pre>
				</div>
			</div>
		)
	}

	// Assistant message with tool calls
	if (hasToolCalls) {
		return (
			<div className="space-y-2">
				{(parsedAssistantContent.answerText ||
					parsedAssistantContent.reasoningBlocks.length > 0) && (
					<div className="flex gap-2">
						<div className="flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center bg-muted">
							<Bot className="h-3.5 w-3.5" />
						</div>
						<div className="max-w-[85%] space-y-2">
							{parsedAssistantContent.answerText && (
								<div className="rounded-lg px-3 py-2 text-sm bg-muted">
									<p className="whitespace-pre-wrap break-words">
										{parsedAssistantContent.answerText}
									</p>
								</div>
							)}
							{parsedAssistantContent.reasoningBlocks.length > 0 && (
								<ReasoningDisclosure blocks={parsedAssistantContent.reasoningBlocks} />
							)}
						</div>
					</div>
				)}
				<div className="flex gap-2 ml-8">
					<div className="flex-shrink-0 h-5 w-5 rounded flex items-center justify-center bg-orange-100 dark:bg-orange-900">
						<Wrench className="h-3 w-3 text-orange-600 dark:text-orange-400" />
					</div>
					<div className="text-xs text-muted-foreground">
						{message.tool_calls?.map((tc: ToolCall) => (
							<span
								key={tc.id}
								className="inline-flex items-center gap-1 bg-orange-50 dark:bg-orange-950 px-2 py-1 rounded mr-1"
							>
								<Wrench className="h-3 w-3" />
								{tc.function.name}
							</span>
						))}
					</div>
				</div>
			</div>
		)
	}

	// Regular user message
	if (isUser) {
		return (
			<div className="flex gap-2 flex-row-reverse">
				<div className="flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center bg-primary text-primary-foreground">
					<User className="h-3.5 w-3.5" />
				</div>
				<div
					className={cn(
						'rounded-lg px-3 py-2 max-w-[85%] text-sm bg-primary text-primary-foreground',
						isStreaming && 'animate-pulse',
					)}
				>
					<p className="whitespace-pre-wrap break-words">{message.content}</p>
				</div>
			</div>
		)
	}

	// Regular assistant message
	return (
		<div className="flex gap-2">
			<div className="flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center bg-muted">
				<Bot className="h-3.5 w-3.5" />
			</div>
			<div className="max-w-[85%] space-y-2">
				{parsedAssistantContent.answerText && (
					<div
						className={cn('rounded-lg px-3 py-2 text-sm bg-muted', isStreaming && 'animate-pulse')}
					>
						<p className="whitespace-pre-wrap break-words">{parsedAssistantContent.answerText}</p>
					</div>
				)}
				{parsedAssistantContent.reasoningBlocks.length > 0 && (
					<ReasoningDisclosure blocks={parsedAssistantContent.reasoningBlocks} />
				)}
			</div>
		</div>
	)
}

function ReasoningDisclosure({ blocks }: { blocks: string[] }) {
	const [isOpen, setIsOpen] = useState(false)
	const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
	const scrollRef = useRef<HTMLDivElement>(null)
	const collapsedScrollRef = useRef<HTMLDivElement>(null)
	const lines = blocks
		.flatMap((block) => block.split(/\r?\n/))
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0)
	const occurrenceByLine = new Map<string, number>()
	const keyedLines = lines.map((line) => {
		const nextCount = (occurrenceByLine.get(line) ?? 0) + 1
		occurrenceByLine.set(line, nextCount)
		return {
			line,
			key: `${line}:${nextCount}`,
		}
	})

	useEffect(() => {
		if (!isOpen || !autoScrollEnabled || !scrollRef.current) return
		scrollRef.current.scrollTop = scrollRef.current.scrollHeight
	}, [isOpen, autoScrollEnabled, keyedLines.length])

	useEffect(() => {
		if (isOpen || !collapsedScrollRef.current) return
		collapsedScrollRef.current.scrollTop = collapsedScrollRef.current.scrollHeight
	}, [isOpen, keyedLines.length])

	if (lines.length === 0) return null

	const toggleAutoScroll = () => {
		const next = !autoScrollEnabled
		setAutoScrollEnabled(next)
		if (next && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight
		}
	}

	return (
		<div className="rounded-md border border-orange-200/80 dark:border-orange-900/60 bg-orange-50/50 dark:bg-orange-950/20">
			<div className="flex items-center justify-between gap-2 px-2 py-1.5">
				<button
					type="button"
					onClick={() => setIsOpen((prev) => !prev)}
					className="cursor-pointer select-none text-xs font-medium text-orange-700 dark:text-orange-300"
					aria-expanded={isOpen}
				>
					<span className="mr-1">{isOpen ? '▾' : '▸'}</span>
					Reasoning ({lines.length} lines)
				</button>
				{isOpen && (
					<button
						type="button"
						onClick={toggleAutoScroll}
						className={cn(
							'text-[10px] px-2 py-0.5 rounded border',
							autoScrollEnabled
								? 'border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 bg-orange-100/70 dark:bg-orange-900/30'
								: 'border-muted-foreground/30 text-muted-foreground bg-background/70',
						)}
						title="Keep view pinned to the latest reasoning line"
					>
						Auto-scroll: {autoScrollEnabled ? 'On' : 'Off'}
					</button>
				)}
			</div>
			{!isOpen ? (
				<div className="px-2 pb-2">
					<div
						ref={collapsedScrollRef}
						className="max-h-[3.25rem] overflow-y-auto rounded border border-orange-200/70 dark:border-orange-900/50 bg-background/80 dark:bg-black/20 p-2 font-mono text-[11px] leading-relaxed"
					>
						{keyedLines.map(({ line, key }, index) => {
							const prefix = index === lines.length - 1 ? '└' : '├'
							return (
								<div key={`collapsed-${key}`} className="flex gap-2">
									<span className="select-none text-orange-500/90 dark:text-orange-400/90">
										{prefix}
									</span>
									<span className="min-w-0 whitespace-pre-wrap break-words text-foreground/85">
										{line}
									</span>
								</div>
							)
						})}
					</div>
				</div>
			) : (
				<div className="px-2 pb-2">
					<div
						ref={scrollRef}
						className="max-h-44 overflow-y-auto rounded border border-orange-200/70 dark:border-orange-900/50 bg-background/80 dark:bg-black/20 p-2 font-mono text-[11px] leading-relaxed"
					>
						{keyedLines.map(({ line, key }, index) => {
							const prefix = index === lines.length - 1 ? '└' : '├'
							return (
								<div key={key} className="flex gap-2">
									<span className="select-none text-orange-500/90 dark:text-orange-400/90">
										{prefix}
									</span>
									<span className="whitespace-pre-wrap break-words text-foreground/85">{line}</span>
								</div>
							)
						})}
					</div>
				</div>
			)}
		</div>
	)
}

function parseAssistantContent(content: string): ParsedAssistantContent {
	const reasoningBlocks: string[] = []
	let answerText = content

	const closedTagPatterns = [
		/\[think\]([\s\S]*?)\[\/think\]/gi,
		/\[reasoning\]([\s\S]*?)\[\/reasoning\]/gi,
		/\[analysis\]([\s\S]*?)\[\/analysis\]/gi,
		/<think>([\s\S]*?)<\/think>/gi,
		/<reasoning>([\s\S]*?)<\/reasoning>/gi,
		/<analysis>([\s\S]*?)<\/analysis>/gi,
	]

	for (const pattern of closedTagPatterns) {
		answerText = answerText.replace(pattern, (_, inner: string) => {
			const normalized = inner.trim()
			if (normalized) reasoningBlocks.push(normalized)
			return ''
		})
	}

	// Streaming responses may include an opening reasoning tag before the closing tag arrives.
	const trailing = extractTrailingReasoning(answerText)
	if (trailing.reasoning) {
		reasoningBlocks.push(trailing.reasoning)
		answerText = trailing.answerText
	}

	return {
		answerText: answerText.replace(/\n{3,}/g, '\n\n').trim(),
		reasoningBlocks,
	}
}

function extractTrailingReasoning(content: string): {
	answerText: string
	reasoning: string | null
} {
	const tagPairs = [
		{ open: '[think]', close: '[/think]' },
		{ open: '[reasoning]', close: '[/reasoning]' },
		{ open: '[analysis]', close: '[/analysis]' },
		{ open: '<think>', close: '</think>' },
		{ open: '<reasoning>', close: '</reasoning>' },
		{ open: '<analysis>', close: '</analysis>' },
	]

	const lower = content.toLowerCase()
	let selected: { index: number; open: string } | null = null

	for (const pair of tagPairs) {
		const openIndex = lower.lastIndexOf(pair.open)
		const closeIndex = lower.lastIndexOf(pair.close)
		if (openIndex !== -1 && closeIndex < openIndex) {
			if (!selected || openIndex > selected.index) {
				selected = { index: openIndex, open: pair.open }
			}
		}
	}

	if (!selected) {
		return { answerText: content, reasoning: null }
	}

	const reasoning = content.slice(selected.index + selected.open.length).trim()
	if (!reasoning) {
		return { answerText: content.slice(0, selected.index), reasoning: null }
	}

	return {
		answerText: content.slice(0, selected.index),
		reasoning,
	}
}

function truncateToolResult(content: string, maxLength = 500): string {
	if (content.length <= maxLength) return content
	return `${content.slice(0, maxLength)}\n... (truncated)`
}

import { useState, useEffect, useRef } from 'react'
import { useChatStore } from './store'
import { useNip60Store } from '@/lib/stores/nip60'
import { Button } from '@/components/ui/button'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Loader2, Send, Trash2, Wallet, Bot, User, AlertCircle } from 'lucide-react'
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
		error,
		totalSpent,
		loadModels,
		setSelectedModel,
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
		if (models.length === 0 && !modelsLoading) {
			loadModels()
		}
	}, [models.length, modelsLoading, loadModels])

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

	return (
		<div className="flex flex-col h-full">
			{/* Header with model picker and wallet info */}
			<div className="p-3 border-b space-y-2">
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
										<span className="text-xs text-muted-foreground">
											{model.pricing.input}/{model.pricing.output} sats/M tokens
										</span>
									</div>
								</SelectItem>
							))}
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

				{/* Wallet status */}
				<div className="flex items-center justify-between text-sm">
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
					{totalSpent > 0 && (
						<span className="text-xs text-muted-foreground">Spent: {totalSpent} sats</span>
					)}
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
						<p className="text-sm font-medium">AI Chat with Bitcoin</p>
						<p className="text-xs mt-1">
							Pay per message with eCash. Unused funds are refunded automatically.
						</p>
						{selectedModelData && (
							<p className="text-xs mt-2">
								Using {selectedModelData.name}
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

						{/* Streaming indicator */}
						{isStreaming && !streamingContent && (
							<div className="flex items-center gap-2 text-muted-foreground">
								<Bot className="h-4 w-4" />
								<div className="flex items-center gap-1">
									<span className="animate-pulse">Thinking</span>
									<Loader2 className="h-3 w-3 animate-spin" />
								</div>
							</div>
						)}

						<div ref={messagesEndRef} />
					</>
				)}
			</div>

			{/* Error display */}
			{error && (
				<div className="px-3 py-2 text-xs text-destructive bg-destructive/10 border-t">
					{error}
				</div>
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
							walletStatus !== 'ready'
								? 'Connect wallet to chat...'
								: !selectedModel
									? 'Select a model...'
									: 'Type a message...'
						}
						disabled={isStreaming || walletStatus !== 'ready' || !selectedModel}
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
						<Button
							type="submit"
							size="icon"
							disabled={!input.trim() || walletStatus !== 'ready' || !selectedModel}
							title="Send"
						>
							<Send className="h-4 w-4" />
						</Button>
					)}
				</div>
			</form>
		</div>
	)
}

interface MessageBubbleProps {
	message: { role: string; content: string }
	isStreaming?: boolean
}

function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
	const isUser = message.role === 'user'

	return (
		<div className={cn('flex gap-2', isUser && 'flex-row-reverse')}>
			<div
				className={cn(
					'flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center',
					isUser ? 'bg-primary text-primary-foreground' : 'bg-muted',
				)}
			>
				{isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
			</div>
			<div
				className={cn(
					'rounded-lg px-3 py-2 max-w-[85%] text-sm',
					isUser ? 'bg-primary text-primary-foreground' : 'bg-muted',
					isStreaming && 'animate-pulse',
				)}
			>
				<p className="whitespace-pre-wrap break-words">{message.content}</p>
			</div>
		</div>
	)
}

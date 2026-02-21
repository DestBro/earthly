/**
 * Chat Store - Zustand store for Routstr AI chat
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatMessage, RoutstrModel, ToolCall, ProviderType, ProviderConfig } from './routstr'
import {
	fetchModels,
	streamChatCompletion,
	estimateTokens,
	estimateMaxCost,
	BUILTIN_PROVIDERS,
} from './routstr'
import {
	createMapContextSystemMessage,
	geoTools,
	executeToolCall,
	consumeMapSnapshot,
} from './tools'
import { nip60Actions, useNip60Store } from '@/lib/stores/nip60'
import { toast } from 'sonner'

// Default max tokens to limit cost - can be adjusted
// Lower value = lower prepayment (unused balance is refunded)
const DEFAULT_MAX_TOKENS = 512
const CONTEXT_SAFETY_TOKENS = 256
const LMSTUDIO_CONTEXT_SAFETY_TOKENS = 1536
const MIN_PROMPT_BUDGET_TOKENS = 512
const DEFAULT_LMSTUDIO_CONTEXT_TOKENS = 4096
const DEFAULT_OLLAMA_CONTEXT_TOKENS = 8192
const DEFAULT_GENERIC_CONTEXT_TOKENS = 16384
const LMSTUDIO_HARD_CONTEXT_CAP_TOKENS = 4096
const MAX_USER_MESSAGE_CHARS = 6000
const MAX_ASSISTANT_MESSAGE_CHARS = 8000
const MAX_TOOL_MESSAGE_CHARS = 12000
const MAX_SYSTEM_MESSAGE_CHARS = 1800
const BUDGET_ESTIMATE_CHARS_PER_TOKEN = 2
const MESSAGE_TOKEN_OVERHEAD = 24
const MIN_CONTEXT_TOKENS_FOR_INLINE_IMAGE = 16000

function messageContentToText(content: ChatMessage['content']): string {
	if (typeof content === 'string') return content
	if (!content) return ''

	return content
		.map((part) => {
			if (part.type === 'text') return part.text
			if (part.type === 'image_url') return part.image_url?.url ?? '[image]'
			return ''
		})
		.join(' ')
}

function truncateTextForPrompt(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text
	return `${text.slice(0, maxChars)}\n...[truncated for context window]`
}

function getMessageCharLimit(role: ChatMessage['role']): number {
	switch (role) {
		case 'tool':
			return MAX_TOOL_MESSAGE_CHARS
		case 'assistant':
			return MAX_ASSISTANT_MESSAGE_CHARS
		case 'system':
			return MAX_SYSTEM_MESSAGE_CHARS
		default:
			return MAX_USER_MESSAGE_CHARS
	}
}

function sanitizeMessageForPrompt(message: ChatMessage): ChatMessage {
	const maxChars = getMessageCharLimit(message.role)
	const { content } = message

	if (typeof content === 'string') {
		return {
			...message,
			content: truncateTextForPrompt(content, maxChars),
		}
	}

	if (!content) return message

	let remainingChars = maxChars
	const sanitizedParts = content
		.map((part) => {
			if (part.type !== 'text') return part
			if (remainingChars <= 0) {
				return null
			}

			const truncated = truncateTextForPrompt(part.text, remainingChars)
			remainingChars -= truncated.length
			return { ...part, text: truncated }
		})
		.filter((part): part is NonNullable<typeof part> => part !== null)

	return {
		...message,
		content: sanitizedParts.length > 0 ? sanitizedParts : '',
	}
}

function estimateMessageTokensForBudget(message: ChatMessage): number {
	const contentText = messageContentToText(message.content)
	const toolCallsText = message.tool_calls ? JSON.stringify(message.tool_calls) : ''
	const combined = `${contentText}${toolCallsText}`
	return Math.ceil(combined.length / BUDGET_ESTIMATE_CHARS_PER_TOKEN) + MESSAGE_TOKEN_OVERHEAD
}

function truncateMessageToTokenBudget(message: ChatMessage, budgetTokens: number): ChatMessage {
	const maxChars = Math.max(128, budgetTokens * BUDGET_ESTIMATE_CHARS_PER_TOKEN)
	const { content } = message

	if (typeof content === 'string') {
		return {
			...message,
			content: truncateTextForPrompt(content, maxChars),
		}
	}

	if (!content) {
		return {
			...message,
			content: '[content omitted for context window]',
		}
	}

	let remainingChars = maxChars
	const truncatedParts = content
		.map((part) => {
			if (remainingChars <= 0) return null

			if (part.type === 'text') {
				const truncated = truncateTextForPrompt(part.text, remainingChars)
				remainingChars -= truncated.length
				return { ...part, text: truncated }
			}

			const imageUrl = part.image_url?.url ?? ''
			if (imageUrl.length <= remainingChars) {
				remainingChars -= imageUrl.length
				return part
			}

			const placeholder = '[image omitted for context window]'
			if (placeholder.length > remainingChars) return null
			remainingChars -= placeholder.length
			return { type: 'text' as const, text: placeholder }
		})
		.filter((part): part is NonNullable<typeof part> => part !== null)

	return {
		...message,
		content: truncatedParts.length > 0 ? truncatedParts : '[content omitted for context window]',
	}
}

function getEffectiveContextTokens(model: RoutstrModel, provider: ProviderConfig): number {
	if (provider.type === 'lmstudio') {
		// LM Studio often reports the model's theoretical max context while the runtime
		// slot may be smaller (commonly 4096). Use a hard cap for safe prompt trimming.
		const reported =
			typeof model.contextLength === 'number' && model.contextLength > 0
				? model.contextLength
				: DEFAULT_LMSTUDIO_CONTEXT_TOKENS
		return Math.min(reported, LMSTUDIO_HARD_CONTEXT_CAP_TOKENS)
	}

	if (typeof model.contextLength === 'number' && model.contextLength > 0) {
		return model.contextLength
	}

	switch (provider.type) {
		case 'lmstudio':
			return DEFAULT_LMSTUDIO_CONTEXT_TOKENS
		case 'ollama':
			return DEFAULT_OLLAMA_CONTEXT_TOKENS
		default:
			return DEFAULT_GENERIC_CONTEXT_TOKENS
	}
}

function getPromptBudgetTokens(
	model: RoutstrModel,
	provider: ProviderConfig,
	maxTokens: number,
): number {
	const contextTokens = getEffectiveContextTokens(model, provider)
	const completionReserve = Math.max(64, maxTokens)
	const safetyTokens =
		provider.type === 'lmstudio' ? LMSTUDIO_CONTEXT_SAFETY_TOKENS : CONTEXT_SAFETY_TOKENS
	return Math.max(MIN_PROMPT_BUDGET_TOKENS, contextTokens - completionReserve - safetyTokens)
}

function trimMessagesToPromptBudget(messages: ChatMessage[], budgetTokens: number): ChatMessage[] {
	if (messages.length === 0) return messages
	const sanitized = messages.map(sanitizeMessageForPrompt)
	const selected: ChatMessage[] = []
	let usedTokens = 0

	for (let i = sanitized.length - 1; i >= 0; i--) {
		let candidate = sanitized[i]
		let candidateTokens = estimateMessageTokensForBudget(candidate)

		if (usedTokens + candidateTokens > budgetTokens) {
			if (selected.length === 0) {
				candidate = truncateMessageToTokenBudget(candidate, budgetTokens)
				candidateTokens = estimateMessageTokensForBudget(candidate)
				if (candidateTokens > budgetTokens) {
					candidate = {
						...candidate,
						content: '[message truncated for context window]',
					}
				}
				selected.unshift(candidate)
			}
			break
		}

		usedTokens += candidateTokens
		selected.unshift(candidate)
	}

	while (selected.length > 1 && selected[0]?.role === 'tool') {
		selected.shift()
	}

	return selected.length > 0
		? selected
		: [truncateMessageToTokenBudget(sanitized.at(-1) as ChatMessage, budgetTokens)]
}

function modelMaySupportVision(provider: ProviderConfig, modelId: string): boolean {
	const lower = modelId.toLowerCase()
	const visionHints = [
		'vision',
		'vl',
		'llava',
		'qwen2.5-vl',
		'gemma-vision',
		'pixtral',
		'gpt-4o',
		'claude-3',
	]
	const providerSupportsVisionTransport =
		provider.type === 'lmstudio' || provider.type === 'routstr' || provider.type === 'custom'
	return providerSupportsVisionTransport && visionHints.some((hint) => lower.includes(hint))
}

function tryExtractSnapshotId(toolResultContent: string): string | null {
	try {
		const parsed = JSON.parse(toolResultContent) as Record<string, unknown>
		return typeof parsed.snapshotId === 'string' ? parsed.snapshotId : null
	} catch {
		return null
	}
}

function isContextOverflowError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	const lower = message.toLowerCase()
	return (
		lower.includes('exceeds the available context size') ||
		lower.includes('cannot truncate prompt with n_keep') ||
		lower.includes('n_ctx')
	)
}

function buildEmergencyRetryMessages(conversationMessages: ChatMessage[]): ChatMessage[] {
	const sanitized = conversationMessages.map(sanitizeMessageForPrompt)
	const recentUserMessages = sanitized
		.filter((message) => message.role === 'user')
		.slice(-2)
		.map((message) => truncateMessageToTokenBudget(message, 220))
	const latestToolMessage = [...sanitized].reverse().find((message) => message.role === 'tool')

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content: [
				'Context window recovery mode.',
				'Preserve user intent from recent turns.',
				'If user asks to draw/edit map features, call tools directly with sensible defaults instead of asking to restate.',
				'Keep output concise.',
			].join(' '),
		},
	]

	if (latestToolMessage) {
		messages.push({
			role: 'system',
			content: `Most recent tool output excerpt:\n${truncateTextForPrompt(
				messageContentToText(latestToolMessage.content),
				900,
			)}`,
		})
	}

	if (recentUserMessages.length === 0) {
		messages.push({ role: 'user', content: 'Continue with a concise response.' })
		return messages
	}

	messages.push(...recentUserMessages)
	return messages
}

function resolveProvider(
	type: ProviderType,
	customEndpoint: string,
	customApiKey: string,
): ProviderConfig {
	if (type === 'custom') {
		return {
			type: 'custom',
			baseUrl: customEndpoint,
			apiKey: customApiKey || undefined,
			name: 'Custom',
			requiresPayment: false,
		}
	}
	return BUILTIN_PROVIDERS[type]
}

interface ChatState {
	// Provider
	provider: ProviderType
	customEndpoint: string
	customApiKey: string
	// Messages
	messages: ChatMessage[]
	// Models
	models: RoutstrModel[]
	selectedModel: string | null
	modelsLoading: boolean
	modelsError: string | null
	// Settings
	maxTokens: number // Max output tokens per request
	toolsEnabled: boolean // Whether to send tools with requests
	// Chat state
	isStreaming: boolean
	streamingContent: string
	pendingToolCalls: ToolCall[] // Tool calls waiting to be executed
	executingTools: boolean // Whether we're currently executing tools
	error: string | null
	// Stats
	totalSpent: number // Total sats spent in this session
	totalRefunded: number // Total sats refunded
}

interface ChatActions {
	// Provider
	setProvider: (provider: ProviderType) => void
	setCustomEndpoint: (url: string) => void
	setCustomApiKey: (key: string) => void
	// Model management
	loadModels: () => Promise<void>
	setSelectedModel: (modelId: string) => void
	// Settings
	setToolsEnabled: (enabled: boolean) => void
	// Message management
	addMessage: (message: ChatMessage) => void
	clearMessages: () => void
	// Chat actions
	sendMessage: (content: string) => Promise<void>
	cancelStream: () => void
	// Reset
	reset: () => void
}

type ChatStore = ChatState & ChatActions

const initialState: ChatState = {
	provider: 'routstr',
	customEndpoint: '',
	customApiKey: '',
	messages: [],
	models: [],
	selectedModel: null,
	modelsLoading: false,
	modelsError: null,
	maxTokens: DEFAULT_MAX_TOKENS,
	toolsEnabled: true,
	isStreaming: false,
	streamingContent: '',
	pendingToolCalls: [],
	executingTools: false,
	error: null,
	totalSpent: 0,
	totalRefunded: 0,
}

// AbortController for canceling streams
let streamAbortController: AbortController | null = null

export const useChatStore = create<ChatStore>()(
	persist(
		(set, get) => ({
			...initialState,

			setProvider: (providerType: ProviderType) => {
				set({ provider: providerType, models: [], selectedModel: null, modelsError: null })
				get().loadModels()
			},

			setCustomEndpoint: (url: string) => {
				set({ customEndpoint: url })
			},

			setCustomApiKey: (key: string) => {
				set({ customApiKey: key })
			},

			loadModels: async () => {
				const { provider, customEndpoint, customApiKey } = get()
				const providerConfig = resolveProvider(provider, customEndpoint, customApiKey)

				if (provider === 'custom' && !customEndpoint) {
					set({ modelsError: 'Enter an endpoint URL first' })
					return
				}

				set({ modelsLoading: true, modelsError: null })
				try {
					const models = await fetchModels(providerConfig)
					const selectedModel = get().selectedModel
					set({
						models,
						modelsLoading: false,
						selectedModel:
							selectedModel && models.find((m) => m.id === selectedModel)
								? selectedModel
								: (models[0]?.id ?? null),
					})
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Failed to load models'
					set({ modelsLoading: false, modelsError: message })
				}
			},

			setSelectedModel: (modelId: string) => {
				set({ selectedModel: modelId })
			},

			setToolsEnabled: (enabled: boolean) => {
				set({ toolsEnabled: enabled })
			},

			addMessage: (message: ChatMessage) => {
				set((state) => ({
					messages: [...state.messages, message],
				}))
			},

			clearMessages: () => {
				set({ messages: [], totalSpent: 0, totalRefunded: 0 })
			},

			sendMessage: async (content: string) => {
				const {
					selectedModel,
					models,
					maxTokens,
					toolsEnabled,
					provider,
					customEndpoint,
					customApiKey,
				} = get()
				const providerConfig = resolveProvider(provider, customEndpoint, customApiKey)

				if (!selectedModel) {
					toast.error('Please select a model first')
					return
				}

				const model = models.find((m) => m.id === selectedModel)
				if (!model) {
					toast.error('Selected model not found')
					return
				}

				// Check wallet status (only for paid providers)
				if (providerConfig.requiresPayment) {
					const walletState = useNip60Store.getState()
					if (walletState.status !== 'ready') {
						toast.error('Wallet not ready. Please initialize your wallet first.')
						return
					}
				}

				// Add user message immediately
				const userMessage: ChatMessage = { role: 'user', content }
				set((state) => ({
					messages: [...state.messages, userMessage],
					isStreaming: true,
					streamingContent: '',
					error: null,
					pendingToolCalls: [],
				}))

				// Helper to process refund (no-ops when refundToken is null)
				const processRefund = async (refundToken: string | null) => {
					if (refundToken) {
						console.log('[Chat] Received refund token, redeeming...')
						try {
							await nip60Actions.receiveEcash(refundToken)
						} catch (err) {
							console.error('[Chat] Failed to process refund:', err)
						}
					}
				}

				// Helper to make a streaming request
				const makeRequest = async (
					requestMessages: ChatMessage[],
				): Promise<{
					content: string
					toolCalls: ToolCall[]
					finishReason?: string
				}> => {
					let cashuToken: string | undefined

					// Payment flow only for paid providers
					if (providerConfig.requiresPayment) {
						const totalText = requestMessages
							.map((message) => messageContentToText(message.content))
							.join(' ')
						const inputTokens = estimateTokens(totalText)
						const estimatedCost = estimateMaxCost(model, inputTokens, maxTokens)

						console.log('[Chat] Cost estimate:', {
							inputTokens,
							maxOutputTokens: maxTokens,
							estimatedCost,
							modelPricing: model.pricing,
						})

						const currentWalletState = useNip60Store.getState()
						if (currentWalletState.balance < estimatedCost) {
							throw new Error(
								`Insufficient balance. Need ~${estimatedCost} sats, have ${currentWalletState.balance}`,
							)
						}

						const mint = currentWalletState.defaultMint || currentWalletState.mints[0]
						if (!mint) {
							throw new Error('No mint available for payment')
						}

						console.log(`[Chat] Generating ${estimatedCost} sat token for inference`)
						cashuToken = await nip60Actions.sendEcash(estimatedCost, mint)
						if (!cashuToken) {
							throw new Error('Failed to generate payment token')
						}

						set((state) => ({ totalSpent: state.totalSpent + estimatedCost }))
					}

					return new Promise((resolve, reject) => {
						let accumulatedContent = ''
						let accumulatedToolCalls: ToolCall[] = []
						let resultFinishReason: string | undefined

						const requestTools = toolsEnabled ? geoTools : undefined
						console.log('[Chat] Request config:', {
							provider: providerConfig.type,
							model: selectedModel,
							toolsEnabled,
							toolCount: requestTools?.length ?? 0,
							toolNames: requestTools?.map((t) => t.function.name) ?? [],
						})

						streamChatCompletion(
							{
								model: selectedModel,
								messages: requestMessages,
								stream: true,
								max_tokens: maxTokens,
								tools: requestTools,
							},
							{
								onToken: (token: string) => {
									accumulatedContent += token
									set({ streamingContent: accumulatedContent })
								},
								onToolCall: (toolCalls: ToolCall[]) => {
									console.log(
										'[Chat] Received tool calls:',
										toolCalls.map((t) => t.function.name),
									)
									accumulatedToolCalls = toolCalls
								},
								onComplete: async (refundToken: string | null, finishReason?: string) => {
									resultFinishReason = finishReason
									await processRefund(refundToken)
									resolve({
										content: accumulatedContent,
										toolCalls: accumulatedToolCalls,
										finishReason: resultFinishReason,
									})
								},
								onError: async (error: Error, refundToken?: string | null) => {
									if (refundToken) {
										console.log('[Chat] Processing refund from error response')
										await processRefund(refundToken)
									}
									reject(error)
								},
							},
							providerConfig,
							cashuToken,
						)
					})
				}

				try {
					streamAbortController = new AbortController()
					let conversationMessages = [...get().messages]
					let oneShotVisionMessages: ChatMessage[] = []
					const effectiveContextTokens = getEffectiveContextTokens(model, providerConfig)
					const canUseVision =
						modelMaySupportVision(providerConfig, selectedModel) &&
						effectiveContextTokens >= MIN_CONTEXT_TOKENS_FOR_INLINE_IMAGE
					const promptBudgetTokens = getPromptBudgetTokens(model, providerConfig, maxTokens)

					// Loop to handle tool calls (max 5 rounds to prevent infinite loops)
					for (let round = 0; round < 5; round++) {
						let requestMessages: ChatMessage[] = [...conversationMessages]
						if (oneShotVisionMessages.length > 0) {
							requestMessages.push(...oneShotVisionMessages)
							oneShotVisionMessages = []
						}

						let mapContextMessage: ChatMessage | null = null
						if (toolsEnabled) {
							mapContextMessage = createMapContextSystemMessage()
						}

						const mapContextTokens = mapContextMessage
							? estimateMessageTokensForBudget(sanitizeMessageForPrompt(mapContextMessage))
							: 0
						const conversationBudget = Math.max(
							MIN_PROMPT_BUDGET_TOKENS,
							promptBudgetTokens - mapContextTokens,
						)
						requestMessages = trimMessagesToPromptBudget(requestMessages, conversationBudget)

						if (mapContextMessage) {
							requestMessages = [sanitizeMessageForPrompt(mapContextMessage), ...requestMessages]
						}

						let result: {
							content: string
							toolCalls: ToolCall[]
							finishReason?: string
						}

						try {
							result = await makeRequest(requestMessages)
						} catch (error) {
							if (!isContextOverflowError(error)) {
								throw error
							}

							console.warn('[Chat] Context overflow detected. Retrying with reduced prompt.')
							const emergencyMessages = buildEmergencyRetryMessages(conversationMessages)
							result = await makeRequest(emergencyMessages)
						}

						// If we got tool calls, execute them and continue
						if (result.toolCalls.length > 0) {
							set({ executingTools: true, streamingContent: '' })

							// Add assistant message with tool calls
							const assistantMessage: ChatMessage = {
								role: 'assistant',
								content: result.content || null,
								tool_calls: result.toolCalls,
							}
							conversationMessages = [...conversationMessages, assistantMessage]
							set({ messages: conversationMessages })

							// Execute each tool call
							for (const toolCall of result.toolCalls) {
								console.log(`[Chat] Executing tool: ${toolCall.function.name}`)
								const toolResult = await executeToolCall(toolCall)

								// Add tool result message
								const toolMessage: ChatMessage = {
									role: 'tool',
									content: toolResult.content,
									tool_call_id: toolResult.tool_call_id,
								}
								conversationMessages = [...conversationMessages, toolMessage]
								set({ messages: conversationMessages })

								if (canUseVision && toolCall.function.name === 'capture_map_snapshot') {
									const snapshotId = tryExtractSnapshotId(toolResult.content)
									if (!snapshotId) continue

									const snapshot = consumeMapSnapshot(snapshotId)
									if (!snapshot) continue

									oneShotVisionMessages.push({
										role: 'user',
										content: [
											{
												type: 'text',
												text: 'Map snapshot for visual analysis. Use this image together with the tool outputs.',
											},
											{
												type: 'image_url',
												image_url: {
													url: snapshot.dataUrl,
												},
											},
										],
									})
								}
							}

							set({ executingTools: false })
							// Continue loop to get next response
							continue
						}

						// No tool calls - we're done
						if (result.content) {
							const assistantMessage: ChatMessage = {
								role: 'assistant',
								content: result.content,
							}
							conversationMessages = [...conversationMessages, assistantMessage]
							set({
								messages: conversationMessages,
								isStreaming: false,
								streamingContent: '',
							})
						} else {
							set({ isStreaming: false, streamingContent: '' })
						}
						break
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Failed to send message'
					set({
						isStreaming: false,
						streamingContent: '',
						executingTools: false,
						error: message,
					})
					toast.error(message)
				} finally {
					streamAbortController = null
				}
			},

			cancelStream: () => {
				if (streamAbortController) {
					streamAbortController.abort()
					streamAbortController = null
				}
				set({
					isStreaming: false,
					streamingContent: '',
				})
			},

			reset: () => {
				if (streamAbortController) {
					streamAbortController.abort()
					streamAbortController = null
				}
				set(initialState)
			},
		}),
		{
			name: 'chat-store',
			partialize: (state) => ({
				selectedModel: state.selectedModel,
				toolsEnabled: state.toolsEnabled,
				provider: state.provider,
				customEndpoint: state.customEndpoint,
				customApiKey: state.customApiKey,
			}),
		},
	),
)

// Action helpers for non-hook usage
export const chatActions = {
	setProvider: (provider: ProviderType) => useChatStore.getState().setProvider(provider),
	setCustomEndpoint: (url: string) => useChatStore.getState().setCustomEndpoint(url),
	setCustomApiKey: (key: string) => useChatStore.getState().setCustomApiKey(key),
	loadModels: () => useChatStore.getState().loadModels(),
	setSelectedModel: (modelId: string) => useChatStore.getState().setSelectedModel(modelId),
	setToolsEnabled: (enabled: boolean) => useChatStore.getState().setToolsEnabled(enabled),
	sendMessage: (content: string) => useChatStore.getState().sendMessage(content),
	clearMessages: () => useChatStore.getState().clearMessages(),
	cancelStream: () => useChatStore.getState().cancelStream(),
	reset: () => useChatStore.getState().reset(),
}

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
import { geoTools, executeToolCall } from './tools'
import { nip60Actions, useNip60Store } from '@/lib/stores/nip60'
import { toast } from 'sonner'

// Default max tokens to limit cost - can be adjusted
// Lower value = lower prepayment (unused balance is refunded)
const DEFAULT_MAX_TOKENS = 512

function resolveProvider(type: ProviderType, customEndpoint: string, customApiKey: string): ProviderConfig {
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
						selectedModel: selectedModel && models.find((m) => m.id === selectedModel)
							? selectedModel
							: models[0]?.id ?? null,
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
				const { selectedModel, models, maxTokens, toolsEnabled, provider, customEndpoint, customApiKey } = get()
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
				const makeRequest = async (requestMessages: ChatMessage[]): Promise<{
					content: string
					toolCalls: ToolCall[]
					finishReason?: string
				}> => {
					let cashuToken: string | undefined

					// Payment flow only for paid providers
					if (providerConfig.requiresPayment) {
						const totalText = requestMessages.map((m) => m.content || '').join(' ')
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
							throw new Error(`Insufficient balance. Need ~${estimatedCost} sats, have ${currentWalletState.balance}`)
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
									console.log('[Chat] Received tool calls:', toolCalls.map((t) => t.function.name))
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
					let currentMessages = [...get().messages]

					// Loop to handle tool calls (max 5 rounds to prevent infinite loops)
					for (let round = 0; round < 5; round++) {
						const result = await makeRequest(currentMessages)

						// If we got tool calls, execute them and continue
						if (result.toolCalls.length > 0) {
							set({ executingTools: true, streamingContent: '' })

							// Add assistant message with tool calls
							const assistantMessage: ChatMessage = {
								role: 'assistant',
								content: result.content || null,
								tool_calls: result.toolCalls,
							}
							currentMessages = [...currentMessages, assistantMessage]
							set({ messages: currentMessages })

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
								currentMessages = [...currentMessages, toolMessage]
								set({ messages: currentMessages })
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
							set((state) => ({
								messages: [...state.messages, assistantMessage],
								isStreaming: false,
								streamingContent: '',
							}))
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

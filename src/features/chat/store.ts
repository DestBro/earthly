/**
 * Chat Store - Zustand store for Routstr AI chat
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatMessage, RoutstrModel } from './routstr'
import {
	fetchModels,
	streamChatCompletion,
	estimateTokens,
	estimateMaxCost,
} from './routstr'
import { nip60Actions, useNip60Store } from '@/lib/stores/nip60'
import { toast } from 'sonner'

// Default max tokens to limit cost - can be adjusted
const DEFAULT_MAX_TOKENS = 1024

interface ChatState {
	// Messages
	messages: ChatMessage[]
	// Models
	models: RoutstrModel[]
	selectedModel: string | null
	modelsLoading: boolean
	modelsError: string | null
	// Settings
	maxTokens: number // Max output tokens per request
	// Chat state
	isStreaming: boolean
	streamingContent: string
	error: string | null
	// Stats
	totalSpent: number // Total sats spent in this session
	totalRefunded: number // Total sats refunded
}

interface ChatActions {
	// Model management
	loadModels: () => Promise<void>
	setSelectedModel: (modelId: string) => void
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
	messages: [],
	models: [],
	selectedModel: null,
	modelsLoading: false,
	modelsError: null,
	maxTokens: DEFAULT_MAX_TOKENS,
	isStreaming: false,
	streamingContent: '',
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

			loadModels: async () => {
				set({ modelsLoading: true, modelsError: null })
				try {
					const models = await fetchModels()
					const selectedModel = get().selectedModel
					set({
						models,
						modelsLoading: false,
						// Select first model if none selected
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

			addMessage: (message: ChatMessage) => {
				set((state) => ({
					messages: [...state.messages, message],
				}))
			},

			clearMessages: () => {
				set({ messages: [], totalSpent: 0, totalRefunded: 0 })
			},

			sendMessage: async (content: string) => {
				const { messages, selectedModel, models, maxTokens } = get()

				if (!selectedModel) {
					toast.error('Please select a model first')
					return
				}

				const model = models.find((m) => m.id === selectedModel)
				if (!model) {
					toast.error('Selected model not found')
					return
				}

				// Check wallet status
				const walletState = useNip60Store.getState()
				if (walletState.status !== 'ready') {
					toast.error('Wallet not ready. Please initialize your wallet first.')
					return
				}

				// Calculate estimated cost based on maxTokens setting
				const allMessages = [...messages, { role: 'user' as const, content }]
				const totalText = allMessages.map((m) => m.content).join(' ')
				const inputTokens = estimateTokens(totalText)
				const estimatedCost = estimateMaxCost(model, inputTokens, maxTokens)

				if (walletState.balance < estimatedCost) {
					toast.error(`Insufficient balance. Need ~${estimatedCost} sats, have ${walletState.balance}`)
					return
				}

				// Add user message immediately
				set((state) => ({
					messages: [...state.messages, { role: 'user', content }],
					isStreaming: true,
					streamingContent: '',
					error: null,
				}))

				try {
					// Get default mint for token generation
					const mint = walletState.defaultMint || walletState.mints[0]
					if (!mint) {
						throw new Error('No mint available for payment')
					}

					// Generate Cashu token for payment
					console.log(`[Chat] Generating ${estimatedCost} sat token for inference`)
					const cashuToken = await nip60Actions.sendEcash(estimatedCost, mint)
					if (!cashuToken) {
						throw new Error('Failed to generate payment token')
					}

					set((state) => ({
						totalSpent: state.totalSpent + estimatedCost,
					}))

					// Create abort controller for cancellation
					streamAbortController = new AbortController()

					// Stream the response with max_tokens to limit cost
					await streamChatCompletion(
						{
							model: selectedModel,
							messages: allMessages,
							stream: true,
							max_tokens: maxTokens,
						},
						cashuToken,
						{
							onToken: (token: string) => {
								set((state) => ({
									streamingContent: state.streamingContent + token,
								}))
							},
							onComplete: async (refundToken: string | null) => {
								const { streamingContent } = get()

								// Add assistant message
								set((state) => ({
									messages: [...state.messages, { role: 'assistant', content: streamingContent }],
									isStreaming: false,
									streamingContent: '',
								}))

								// Process refund if we got one
								if (refundToken) {
									console.log('[Chat] Received refund token, redeeming...')
									try {
										await nip60Actions.receiveEcash(refundToken)
										// We don't know exact refund amount without decoding token
										// but we can note that a refund was processed
										toast.success('Refund received')
									} catch (err) {
										console.error('[Chat] Failed to process refund:', err)
										// Don't fail the whole operation for refund issues
									}
								}
							},
							onError: (error: Error) => {
								console.error('[Chat] Stream error:', error)
								set({
									isStreaming: false,
									streamingContent: '',
									error: error.message,
								})
								toast.error(error.message)
							},
						},
					)
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Failed to send message'
					set({
						isStreaming: false,
						streamingContent: '',
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
				// Persist only model selection, not messages
				selectedModel: state.selectedModel,
			}),
		},
	),
)

// Action helpers for non-hook usage
export const chatActions = {
	loadModels: () => useChatStore.getState().loadModels(),
	setSelectedModel: (modelId: string) => useChatStore.getState().setSelectedModel(modelId),
	sendMessage: (content: string) => useChatStore.getState().sendMessage(content),
	clearMessages: () => useChatStore.getState().clearMessages(),
	cancelStream: () => useChatStore.getState().cancelStream(),
	reset: () => useChatStore.getState().reset(),
}

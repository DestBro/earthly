/**
 * Routstr API Client
 *
 * OpenAI-compatible API proxy with Cashu micropayments (RIP-01)
 * Supports X-Cashu header for stateless payments with automatic refunds
 */

export interface RoutstrModel {
	id: string
	name: string
	description?: string
	contextLength?: number
	pricing: {
		input: number // cost per 1M input tokens in sats
		output: number // cost per 1M output tokens in sats
		request: number // per-request fee in sats
	}
}

export interface ChatMessage {
	role: 'user' | 'assistant' | 'system'
	content: string
}

export interface ChatCompletionRequest {
	model: string
	messages: ChatMessage[]
	stream?: boolean
	max_tokens?: number
	temperature?: number
}

export interface ChatCompletionResponse {
	id: string
	object: string
	created: number
	model: string
	choices: {
		index: number
		message: ChatMessage
		finish_reason: string
	}[]
	usage: {
		prompt_tokens: number
		completion_tokens: number
		total_tokens: number
	}
}

export interface StreamChunk {
	id: string
	object: string
	created: number
	model: string
	choices: {
		index: number
		delta: {
			role?: string
			content?: string
		}
		finish_reason: string | null
	}[]
}

export interface RoutstrConfig {
	baseUrl: string
}

const DEFAULT_CONFIG: RoutstrConfig = {
	baseUrl: 'https://api.routstr.com/v1',
}

interface ApiModel {
	id: string
	name?: string
	description?: string
	context_length?: number
	sats_pricing?: {
		prompt?: number
		completion?: number
		request?: number
	}
}

/**
 * Fetch available models with pricing information
 */
export async function fetchModels(config: RoutstrConfig = DEFAULT_CONFIG): Promise<RoutstrModel[]> {
	const response = await fetch(`${config.baseUrl}/models`)
	if (!response.ok) {
		throw new Error(`Failed to fetch models: ${response.statusText}`)
	}
	const data = await response.json()

	// Transform OpenAI-style model list to our format
	// Pricing comes from sats_pricing.prompt/completion (per token)
	// We convert to per-million tokens for display
	return (data.data || []).map((model: ApiModel) => ({
		id: model.id,
		name: model.name || model.id,
		description: model.description,
		contextLength: model.context_length,
		pricing: {
			// sats_pricing is per-token, multiply by 1M for display
			input: Math.round((model.sats_pricing?.prompt || 0) * 1_000_000),
			output: Math.round((model.sats_pricing?.completion || 0) * 1_000_000),
			// Per-request fee in sats
			request: model.sats_pricing?.request || 0,
		},
	}))
}

// Minimum prepayment to ensure request goes through
// Server may require minimum balance beyond just token costs
const MIN_PREPAYMENT_SATS = 100

/**
 * Estimate the maximum cost for a request in sats
 * Used to determine how much ecash to include
 *
 * Note: Routstr uses prepay-and-refund model, so overpaying is safe
 * and actually required since server reserves for max possible output
 */
export function estimateMaxCost(
	model: RoutstrModel,
	inputTokens: number,
	maxOutputTokens: number = 4096,
): number {
	// Model pricing is stored as per-1M tokens, convert back to per-token
	const inputCostPerToken = model.pricing.input / 1_000_000
	const outputCostPerToken = model.pricing.output / 1_000_000

	const inputCost = inputTokens * inputCostPerToken
	const outputCost = maxOutputTokens * outputCostPerToken
	const requestFee = model.pricing.request || 0

	// Calculate total with buffer for fees and rounding
	const calculatedCost = Math.ceil(inputCost + outputCost + requestFee) + 5

	// Use minimum prepayment to ensure request succeeds
	// Unused balance is refunded via X-Cashu header
	return Math.max(MIN_PREPAYMENT_SATS, calculatedCost)
}

/**
 * Rough estimate of tokens from text (4 chars ≈ 1 token)
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}

export interface CompletionResult {
	response: ChatCompletionResponse
	refundToken: string | null
	actualCost: number
}

/**
 * Send a chat completion request with Cashu payment
 * Returns the response and any refund token
 */
export async function chatCompletion(
	request: ChatCompletionRequest,
	cashuToken: string,
	config: RoutstrConfig = DEFAULT_CONFIG,
): Promise<CompletionResult> {
	const response = await fetch(`${config.baseUrl}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Cashu': cashuToken,
		},
		body: JSON.stringify({
			...request,
			stream: false,
		}),
	})

	if (!response.ok) {
		const error = await response.text()
		throw new Error(`Chat completion failed: ${error}`)
	}

	// Get refund token from response header
	const refundToken = response.headers.get('X-Cashu')
	const data: ChatCompletionResponse = await response.json()

	// Calculate actual cost from usage
	const actualCost = data.usage?.total_tokens || 0

	return {
		response: data,
		refundToken,
		actualCost,
	}
}

export interface StreamCallbacks {
	onToken: (token: string) => void
	onComplete: (refundToken: string | null) => void
	onError: (error: Error) => void
}

/**
 * Stream a chat completion with Cashu payment
 * Calls onToken for each streamed token, onComplete with refund token when done
 */
export async function streamChatCompletion(
	request: ChatCompletionRequest,
	cashuToken: string,
	callbacks: StreamCallbacks,
	config: RoutstrConfig = DEFAULT_CONFIG,
): Promise<void> {
	const response = await fetch(`${config.baseUrl}/chat/completions`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Cashu': cashuToken,
		},
		body: JSON.stringify({
			...request,
			stream: true,
		}),
	})

	if (!response.ok) {
		const error = await response.text()
		callbacks.onError(new Error(`Stream failed: ${error}`))
		return
	}

	// Get refund token from response header (may also come at end for streaming)
	const refundToken = response.headers.get('X-Cashu')

	const reader = response.body?.getReader()
	if (!reader) {
		callbacks.onError(new Error('No response body'))
		return
	}

	const decoder = new TextDecoder()
	let buffer = ''

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			buffer += decoder.decode(value, { stream: true })
			const lines = buffer.split('\n')
			buffer = lines.pop() || ''

			for (const line of lines) {
				if (line.startsWith('data: ')) {
					const data = line.slice(6).trim()
					if (data === '[DONE]') {
						// Check for refund token in final message or use header
						callbacks.onComplete(refundToken)
						return
					}

					try {
						const chunk: StreamChunk = JSON.parse(data)
						const content = chunk.choices[0]?.delta?.content
						if (content) {
							callbacks.onToken(content)
						}

						// Some implementations include refund in the final chunk
						if (chunk.choices[0]?.finish_reason === 'stop') {
							// Refund will be in header or a subsequent message
						}
					} catch {
						// Skip malformed chunks
					}
				}
			}
		}

		callbacks.onComplete(refundToken)
	} catch (error) {
		callbacks.onError(error instanceof Error ? error : new Error(String(error)))
	}
}

/**
 * Create a balance (API key) from a Cashu token
 * Alternative to X-Cashu header for multiple requests
 */
export async function createBalance(
	cashuToken: string,
	config: RoutstrConfig = DEFAULT_CONFIG,
): Promise<{ apiKey: string; balance: number }> {
	const response = await fetch(`${config.baseUrl}/balance/create?token=${encodeURIComponent(cashuToken)}`)
	if (!response.ok) {
		const error = await response.text()
		throw new Error(`Failed to create balance: ${error}`)
	}
	return response.json()
}

/**
 * Get remaining balance for an API key
 */
export async function getBalance(
	apiKey: string,
	config: RoutstrConfig = DEFAULT_CONFIG,
): Promise<{ balance: number }> {
	const response = await fetch(`${config.baseUrl}/balance/info`, {
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	})
	if (!response.ok) {
		const error = await response.text()
		throw new Error(`Failed to get balance: ${error}`)
	}
	return response.json()
}

/**
 * Refund remaining balance as a Cashu token
 */
export async function refundBalance(
	apiKey: string,
	config: RoutstrConfig = DEFAULT_CONFIG,
): Promise<{ token: string }> {
	const response = await fetch(`${config.baseUrl}/balance/refund`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
		},
	})
	if (!response.ok) {
		const error = await response.text()
		throw new Error(`Failed to refund balance: ${error}`)
	}
	return response.json()
}

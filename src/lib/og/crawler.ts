/**
 * User agents for social media crawlers and bots that need OG meta tags
 */
const CRAWLER_USER_AGENTS = [
  // Facebook
  'facebookexternalhit',
  'Facebot',
  // Twitter/X
  'Twitterbot',
  // LinkedIn
  'LinkedInBot',
  // Discord
  'Discordbot',
  // Telegram
  'TelegramBot',
  // Slack
  'Slackbot-LinkExpanding',
  'Slackbot',
  // WhatsApp
  'WhatsApp',
  // Skype
  'SkypeUriPreview',
  // Pinterest
  'Pinterest',
  // iMessage
  'Applebot',
  // Generic
  'bot',
  'crawler',
  'spider',
  'preview',
]

/**
 * Check if a request is from a social media crawler/bot
 */
export function isCrawler(request: Request): boolean {
  const userAgent = request.headers.get('user-agent') ?? ''
  const lowerUA = userAgent.toLowerCase()

  return CRAWLER_USER_AGENTS.some((crawler) =>
    lowerUA.includes(crawler.toLowerCase()),
  )
}
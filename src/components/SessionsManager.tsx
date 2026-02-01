import {
	NDKNip07Signer,
	NDKSessionLocalStorage,
	type NDKNip46Signer,
	type NDKPrivateKeySigner,
	removeStoredSession,
	useNDKCurrentPubkey,
	useNDKSessionLogin,
	useNDKSessionLogout,
	useNDKSessionSessions,
	useNDKSessionSwitch,
	useProfileValue,
	type Hexpubkey,
} from '@nostr-dev-kit/react'
import { AppWindowIcon, KeyRoundIcon, LogOut, QrCodeIcon, User2Icon, Users } from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useRef, useState } from 'react'
import { Nip46LoginDialog } from './Nip46LoginDialog'
import { SignupDialog } from './SignupDialog'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
import { Button } from './ui/button'
import { ButtonGroup } from './ui/button-group'
import { Label } from './ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip'

/**
 * Display a session item with profile info and actions
 */
function SessionItem({
	pubkey,
	isActive,
	onSwitch,
	onLogout,
}: {
	pubkey: Hexpubkey
	isActive: boolean
	onSwitch: () => void
	onLogout: () => void
}) {
	const profile = useProfileValue(pubkey)

	// Get first 2 characters of name or pubkey for fallback
	const getFallbackText = () => {
		if (profile?.name) {
			return profile.name.substring(0, 2).toUpperCase()
		}
		if (profile?.displayName) {
			return profile.displayName.substring(0, 2).toUpperCase()
		}
		return pubkey.substring(0, 2).toUpperCase()
	}

	const displayName = profile?.name || profile?.displayName || `${pubkey.substring(0, 8)}...`
	const npub = nip19.npubEncode(pubkey)
	const shortNpub = `${npub.substring(0, 12)}...${npub.substring(npub.length - 4)}`

	const handleClick = () => {
		if (!isActive) {
			onSwitch()
		}
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if ((e.key === 'Enter' || e.key === ' ') && !isActive) {
			e.preventDefault()
			onSwitch()
		}
	}

	return (
		<div
			role="button"
			tabIndex={isActive ? -1 : 0}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
				isActive
					? 'bg-primary/10 border-primary/30'
					: 'bg-card hover:bg-muted/50 border-border cursor-pointer'
			}`}
		>
			<Avatar className="w-10 h-10">
				<AvatarImage src={profile?.image || profile?.picture} alt={displayName} />
				<AvatarFallback className="text-sm">
					{profile ? getFallbackText() : <User2Icon className="w-5 h-5" />}
				</AvatarFallback>
			</Avatar>

			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					<span className="font-medium truncate">{displayName}</span>
					{isActive && (
						<span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded">Active</span>
					)}
				</div>
				<span className="text-xs text-muted-foreground font-mono">{shortNpub}</span>
			</div>

			<div className="flex items-center gap-1">
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
							onClick={(e) => {
								e.stopPropagation()
								onLogout()
							}}
						>
							<LogOut className="h-4 w-4" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Remove this session</TooltipContent>
				</Tooltip>
			</div>
		</div>
	)
}

/**
 * Sessions manager component for managing multiple Nostr accounts
 */
export function SessionsManager() {
	const sessions = useNDKSessionSessions()
	const activePubkey = useNDKCurrentPubkey()
	const switchSession = useNDKSessionSwitch()
	const logout = useNDKSessionLogout()
	const login = useNDKSessionLogin()
	const storageRef = useRef(new NDKSessionLocalStorage())

	const [loading, setLoading] = useState(false)
	const [showSignupDialog, setShowSignupDialog] = useState(false)

	const sessionList = Array.from(sessions.entries())

	const handleSignup = async (signer: NDKPrivateKeySigner, rememberMe: boolean) => {
		try {
			await login(signer)
			if (!rememberMe) {
				const user = await signer.user()
				if (user?.pubkey) {
					await removeStoredSession(storageRef.current, user.pubkey)
				}
			}
		} catch (error) {
			console.error('Login failed:', error)
			throw error
		}
	}

	const handleNip07Login = async () => {
		try {
			setLoading(true)
			const signer = new NDKNip07Signer()
			await login(signer)
		} catch (error) {
			console.error('Extension login failed:', error)
		} finally {
			setLoading(false)
		}
	}

	const handleNip46Login = async (signer: NDKNip46Signer, rememberMe: boolean) => {
		try {
			setLoading(true)
			await login(signer)
			if (!rememberMe) {
				const user = await signer.user()
				if (user?.pubkey) {
					await removeStoredSession(storageRef.current, user.pubkey)
				}
			}
		} catch (error) {
			console.error('NIP-46 login failed:', error)
			throw error
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Users className="h-4 w-4 text-muted-foreground" />
					<Label className="text-sm font-medium">Sessions</Label>
					{sessionList.length > 0 && (
						<span className="text-xs text-muted-foreground">
							({sessionList.length} account{sessionList.length !== 1 ? 's' : ''})
						</span>
					)}
				</div>
			</div>

			{sessionList.length === 0 ? (
				<div className="text-sm text-muted-foreground italic p-4 border border-dashed rounded-lg text-center">
					No active sessions. Add an account below.
				</div>
			) : (
				<div className="space-y-2">
					{sessionList.map(([pubkey]) => (
						<SessionItem
							key={pubkey}
							pubkey={pubkey}
							isActive={pubkey === activePubkey}
							onSwitch={() => switchSession(pubkey)}
							onLogout={() => logout(pubkey)}
						/>
					))}
				</div>
			)}

			{/* Add Account Section */}
			<div className="pt-2 border-t">
				<Label className="text-xs text-muted-foreground mb-2 block">Add Account</Label>
				<ButtonGroup className="w-full">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="outline"
								size="sm"
								className="flex-1"
								onClick={() => setShowSignupDialog(true)}
							>
								<KeyRoundIcon className="w-4 h-4 mr-1" />
								Key
							</Button>
						</TooltipTrigger>
						<TooltipContent>Create or import a private key</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="outline"
								size="sm"
								className="flex-1"
								onClick={handleNip07Login}
								disabled={loading}
							>
								<AppWindowIcon className="w-4 h-4 mr-1" />
								Extension
							</Button>
						</TooltipTrigger>
						<TooltipContent>Use browser extension (NIP-07)</TooltipContent>
					</Tooltip>
					<Nip46LoginDialog
						onLogin={handleNip46Login}
						trigger={
							<Button
								variant="outline"
								size="sm"
								className="flex-1"
								disabled={loading}
								title="Use remote signer (NIP-46)"
							>
								<QrCodeIcon className="w-4 h-4 mr-1" />
								Signer
							</Button>
						}
					/>
				</ButtonGroup>
			</div>

			<p className="text-xs text-muted-foreground">
				Sessions are saved unless you uncheck "Stay logged in" when adding an account.
			</p>

			{/* Signup Dialog */}
			<SignupDialog
				open={showSignupDialog}
				onOpenChange={setShowSignupDialog}
				onConfirm={handleSignup}
			/>
		</div>
	)
}

import {
  NDKCashuWallet,
  NDKCashuDeposit,
  type NDKWalletBalance,
  type NDKWalletTransaction,
  NDKWalletStatus,
} from "@nostr-dev-kit/wallet";
import type NDK from "@nostr-dev-kit/ndk";
import { NDKRelaySet } from "@nostr-dev-kit/ndk";
import { create } from "zustand";
import {
  CashuMint,
  CashuWallet,
  getEncodedToken,
  type Proof,
} from "@cashu/cashu-ts";
import {
  loadUserData,
  saveUserData,
  getProofsForMint,
  getMintHostname,
  setCurrentPubkey,
  type PendingToken,
} from "@/lib/wallet";

const DEFAULT_MINT_KEY = "nip60_default_mint";
const PENDING_TOKENS_KEY = "nip60_pending_tokens";

// Re-export for backward compatibility
export type PendingNip60Token = PendingToken;

// Track recently spent proof secrets to prevent reuse before consolidation completes
// Key is proof secret, value is timestamp when spent
const recentlySpentProofs = new Map<string, number>();
const SPENT_PROOF_TTL = 60_000; // 60 seconds - enough time for consolidation

function markProofsAsSpent(proofs: Proof[]): void {
  const now = Date.now();
  for (const proof of proofs) {
    recentlySpentProofs.set(proof.secret, now);
  }
}

function filterOutRecentlySpent(proofs: Proof[]): Proof[] {
  const now = Date.now();
  // Clean up old entries
  for (const [secret, timestamp] of recentlySpentProofs.entries()) {
    if (now - timestamp > SPENT_PROOF_TTL) {
      recentlySpentProofs.delete(secret);
    }
  }
  // Filter out recently spent proofs
  return proofs.filter((p) => !recentlySpentProofs.has(p.secret));
}

export interface Nip60State {
  ndk: NDK | null;
  wallet: NDKCashuWallet | null;
  status: "idle" | "initializing" | "ready" | "no_wallet" | "error";
  balance: number;
  mintBalances: Record<string, number>;
  mints: string[];
  defaultMint: string | null;
  transactions: NDKWalletTransaction[];
  error: string | null;
  // Active deposit tracking
  activeDeposit: NDKCashuDeposit | null;
  depositInvoice: string | null;
  depositStatus: "idle" | "pending" | "success" | "error";
  // Pending tokens tracking (tokens generated but not yet claimed by recipient)
  pendingTokens: PendingNip60Token[];
}

interface Nip60Actions {
  initialize: (pubkey: string, ndk: NDK) => Promise<void>;
  loadTransactions: () => Promise<void>;
  subscribeToTransactions: () => void;
  createWallet: (mints: string[]) => Promise<void>;
  reset: () => void;
  getWallet: () => NDKCashuWallet | null;
  refresh: (options?: { consolidate?: boolean }) => Promise<void>;
  addMint: (mintUrl: string) => void;
  removeMint: (mintUrl: string) => void;
  publishWallet: () => Promise<void>;
  setDefaultMint: (mintUrl: string | null) => void;
  startDeposit: (amount: number, mint?: string) => Promise<string | null>;
  cancelDeposit: () => void;
  withdrawLightning: (invoice: string) => Promise<boolean>;
  sendEcash: (amount: number, mint?: string) => Promise<string | null>;
  receiveEcash: (token: string) => Promise<boolean>;
  loadPendingTokens: () => void;
  reclaimToken: (tokenId: string) => Promise<boolean>;
  removePendingToken: (tokenId: string) => void;
  getActivePendingTokens: () => PendingNip60Token[];
}

const initialState: Nip60State = {
  ndk: null,
  wallet: null,
  status: "idle",
  balance: 0,
  mintBalances: {},
  mints: [],
  defaultMint:
    typeof localStorage !== "undefined"
      ? localStorage.getItem(DEFAULT_MINT_KEY)
      : null,
  transactions: [],
  error: null,
  activeDeposit: null,
  depositInvoice: null,
  depositStatus: "idle",
  pendingTokens: [],
};

// Keep track of transaction subscription cleanup
let transactionUnsubscribe: (() => void) | null = null;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

const loadPendingTokensFromStorage = (): PendingToken[] =>
  loadUserData<PendingToken[]>(PENDING_TOKENS_KEY, []);

const savePendingTokensToStorage = (tokens: PendingToken[]): void =>
  saveUserData(PENDING_TOKENS_KEY, tokens);

/**
 * Select proofs from available proofs to meet the target amount.
 * Returns selected proofs and their total value.
 */
function selectProofs(
  proofs: Proof[],
  amount: number,
): { selected: Proof[]; total: number } {
  // Sort proofs by amount (smallest first) for better selection
  const sorted = [...proofs].sort((a, b) => a.amount - b.amount);
  const selected: Proof[] = [];
  let total = 0;

  for (const proof of sorted) {
    if (total >= amount) break;
    selected.push(proof);
    total += proof.amount;
  }

  return { selected, total };
}

/**
 * Get all mints - combines configured mints with mints that have balances
 */
function getAllMints(wallet: NDKCashuWallet): string[] {
  const configuredMints = wallet.mints ?? [];
  const balanceMints = Object.keys(wallet.mintBalances ?? {});
  // Combine and deduplicate
  return Array.from(new Set([...configuredMints, ...balanceMints]));
}

/**
 * Get accurate balances directly from wallet state.
 * wallet.state.dump() provides the source of truth for proofs and balances.
 */
function getBalancesFromState(wallet: NDKCashuWallet): {
  totalBalance: number;
  mintBalances: Record<string, number>;
} {
  const dump = wallet.state.dump();
  const mintBalances = { ...dump.balances };

  // Ensure all configured mints are present (even with 0 balance)
  for (const mint of wallet.mints ?? []) {
    if (!(mint in mintBalances)) {
      mintBalances[mint] = 0;
    }
  }

  return {
    totalBalance: dump.totalBalance,
    mintBalances,
  };
}

export const useNip60Store = create<Nip60State & Nip60Actions>()(
  (set, get) => ({
    ...initialState,

    initialize: async (pubkey: string, ndk: NDK): Promise<void> => {
      const state = get();

      // Don't re-initialize if already initializing or ready
      if (state.status === "initializing") return;
      if (state.status === "ready" && state.wallet) return;
      if (!ndk) return;

      set({ ndk, status: "initializing", error: null });

      // Set current pubkey for storage scoping
      setCurrentPubkey(pubkey);

      try {
        // First, try to fetch the existing wallet event (kind 17375)
        const walletEvent = await ndk.fetchEvent({
          kinds: [17375],
          authors: [pubkey],
        });

        let wallet: NDKCashuWallet;

        if (walletEvent) {
          // Load wallet from existing event - this decrypts and loads mints/privkeys
          const loadedWallet = await NDKCashuWallet.from(walletEvent);
          if (!loadedWallet) {
            throw new Error("Failed to load wallet from event");
          }
          wallet = loadedWallet;
        } else {
          // No wallet event found - create a new wallet instance
          wallet = new NDKCashuWallet(ndk);
        }

        // Configure the wallet's relaySet from NDK's connected relays if not already set
        if (!wallet.relaySet) {
          const relayUrls = Array.from(ndk.pool?.relays?.keys() ?? []);
          if (relayUrls.length > 0) {
            wallet.relaySet = NDKRelaySet.fromRelayUrls(relayUrls, ndk);
          }
        }

        // Store wallet in state FIRST so event handlers can use it
        set({ wallet });

        // Subscribe to balance updates
        wallet.on("balance_updated", () => {
          const { totalBalance, mintBalances } = getBalancesFromState(wallet);
          const allMints = getAllMints(wallet);
          const currentStatus = get().status;

          // If we're still initializing but receiving balance updates, mark as ready
          // This handles the case where wallet.start() hangs due to sync issues
          if (currentStatus === "initializing" && (totalBalance > 0 || allMints.length > 0)) {
            set({
              status: "ready",
              balance: totalBalance,
              mintBalances,
              mints: allMints,
            });
          } else {
            set({
              balance: totalBalance,
              mintBalances,
              mints: allMints,
            });
          }
        });

        // Listen for status changes
        wallet.on("status_changed", (status: NDKWalletStatus) => {
          if (status === NDKWalletStatus.READY) {
            const { totalBalance, mintBalances } = getBalancesFromState(wallet);
            const allMints = getAllMints(wallet);
            const hasWallet = allMints.length > 0 || totalBalance > 0;

            set({
              status: hasWallet ? "ready" : "no_wallet",
              balance: totalBalance,
              mints: allMints,
              mintBalances,
            });
          } else if (status === NDKWalletStatus.FAILED) {
            set({
              status: "error",
              error: "Wallet failed to load",
            });
          }
        });

        // Start the wallet - this subscribes to token events and loads balance
        await wallet.start({ pubkey });

        const { totalBalance, mintBalances } = getBalancesFromState(wallet);
        const allMints = getAllMints(wallet);

        // Determine if user has an existing wallet (we found a wallet event OR have mints/balance)
        const hasWallet =
          walletEvent !== null || allMints.length > 0 || totalBalance > 0;

        set({
          status: hasWallet ? "ready" : "no_wallet",
          balance: totalBalance,
          mints: allMints,
          mintBalances,
        });

        // Only load transactions if we have a wallet
        if (hasWallet) {
          void get().loadTransactions();
        }

        // Load pending tokens from localStorage
        get().loadPendingTokens();
      } catch (err) {
        console.error("[nip60] Failed to initialize wallet:", err);
        set({
          status: "error",
          error:
            err instanceof Error ? err.message : "Failed to initialize wallet",
        });
      }
    },

    loadTransactions: async (): Promise<void> => {
      const wallet = get().wallet;
      if (!wallet) {
        console.warn("[nip60] Cannot load transactions without wallet");
        return;
      }

      try {
        const txs = await wallet.fetchTransactions();
        set({ transactions: txs });

        // Subscribe to new transactions
        get().subscribeToTransactions();
      } catch (err) {
        console.error("[nip60] Failed to fetch transactions:", err);
      }
    },

    subscribeToTransactions: (): void => {
      const wallet = get().wallet;
      if (!wallet) return;

      // Clean up existing subscription
      if (transactionUnsubscribe) {
        transactionUnsubscribe();
        transactionUnsubscribe = null;
      }

      transactionUnsubscribe = wallet.subscribeTransactions(
        (tx: NDKWalletTransaction) => {
          const currentTxs = get().transactions;
          // Check if transaction already exists
          const exists = currentTxs.some((t) => t.id === tx.id);
          if (exists) return;

          // Add new transaction at the beginning (newest first)
          set({ transactions: [tx, ...currentTxs] });
        },
      );
    },

    createWallet: async (mints: string[]): Promise<void> => {
      const wallet = get().wallet;
      if (!wallet) {
        console.error(
          "[nip60] Cannot create wallet - wallet instance not initialized",
        );
        return;
      }

      try {
        const ndk = get().ndk;
        await NDKCashuWallet.create(wallet.ndk, mints);
        // Re-initialize to pick up the new wallet
        set({ ...initialState, ndk });
        if (ndk?.signer) {
          const user = await ndk.signer.user();
          if (user?.pubkey) {
            await get().initialize(user.pubkey, ndk);
          }
        }
      } catch (err) {
        console.error("[nip60] Failed to create wallet:", err);
        set({
          error: err instanceof Error ? err.message : "Failed to create wallet",
        });
      }
    },

    reset: (): void => {
      // Clean up transaction subscription
      if (transactionUnsubscribe) {
        transactionUnsubscribe();
        transactionUnsubscribe = null;
      }

      // Clear current pubkey
      setCurrentPubkey(null);

      const state = get();
      if (state.wallet) {
        state.wallet.stop();
        state.wallet.removeAllListeners?.();
      }
      set(initialState);
    },

    getWallet: (): NDKCashuWallet | null => {
      return get().wallet;
    },

    refresh: async (options?: { consolidate?: boolean }): Promise<void> => {
      const wallet = get().wallet;
      if (!wallet) {
        console.warn("[nip60] Cannot refresh without wallet");
        return;
      }

      const shouldConsolidate = options?.consolidate ?? false;

      // Consolidate tokens if requested - this checks for spent proofs
      if (shouldConsolidate) {
        try {
          await wallet.consolidateTokens();
        } catch (err) {
          console.error("[nip60] Failed to consolidate tokens:", err);
          // Continue with refresh even if consolidation fails
        }
      }

      // Get balances directly from wallet state (source of truth)
      const { totalBalance, mintBalances } = getBalancesFromState(wallet);

      set({
        balance: totalBalance,
        mintBalances,
        mints: getAllMints(wallet),
      });

      // Reload transactions
      await get().loadTransactions();
    },

    addMint: (mintUrl: string): void => {
      const wallet = get().wallet;
      if (!wallet) {
        console.warn("[nip60] Cannot add mint without wallet");
        return;
      }

      // Normalize URL
      const normalizedUrl = mintUrl.trim().replace(/\/$/, "");
      if (!normalizedUrl) return;

      // Check if already exists
      if (wallet.mints.includes(normalizedUrl)) {
        console.log("[nip60] Mint already exists:", normalizedUrl);
        return;
      }

      wallet.mints = [...wallet.mints, normalizedUrl];

      // Update store state
      set({ mints: getAllMints(wallet) });
    },

    removeMint: (mintUrl: string): void => {
      const wallet = get().wallet;
      if (!wallet) {
        console.warn("[nip60] Cannot remove mint without wallet");
        return;
      }

      wallet.mints = wallet.mints.filter((m) => m !== mintUrl);

      // Update store state - note: mints with balance will still show even after removal from config
      const currentMintBalances = get().mintBalances;
      set({
        mints: getAllMints(wallet),
        mintBalances: Object.fromEntries(
          Object.entries(currentMintBalances).filter(([m]) => m !== mintUrl),
        ),
      });
    },

    publishWallet: async (): Promise<void> => {
      const wallet = get().wallet;
      if (!wallet) {
        console.warn("[nip60] Cannot publish without wallet");
        return;
      }

      try {
        await wallet.publish();
      } catch (err) {
        console.error("[nip60] Failed to publish wallet:", err);
        throw err;
      }
    },

    setDefaultMint: (mintUrl: string | null): void => {
      if (mintUrl) {
        localStorage.setItem(DEFAULT_MINT_KEY, mintUrl);
      } else {
        localStorage.removeItem(DEFAULT_MINT_KEY);
      }
      set({ defaultMint: mintUrl });
    },

    startDeposit: async (
      amount: number,
      mint?: string,
    ): Promise<string | null> => {
      const wallet = get().wallet;
      const state = get();
      if (!wallet) {
        console.warn("[nip60] Cannot deposit without wallet");
        return null;
      }

      const targetMint = mint ?? state.defaultMint;
      if (!targetMint) {
        console.warn("[nip60] No mint specified and no default mint set");
        set({
          depositStatus: "error",
          error: "No mint specified. Please select a default mint first.",
        });
        return null;
      }

      // Ensure wallet has the target mint configured
      if (!wallet.mints.includes(targetMint)) {
        wallet.mints = [...wallet.mints, targetMint];
      }

      try {
        set({
          depositStatus: "pending",
          error: null,
        });

        const deposit = wallet.deposit(amount, targetMint);
        const invoice = await deposit.start();

        set({
          activeDeposit: deposit,
          depositInvoice: invoice ?? null,
        });

        // Listen for deposit completion
        deposit.on("success", (token) => {
          set({
            depositStatus: "success",
            activeDeposit: null,
            depositInvoice: null,
          });
          // Refresh to update balance
          void get().refresh();
        });

        deposit.on("error", (err: Error | string) => {
          console.error("[nip60] Deposit error:", err);
          set({
            depositStatus: "error",
            error: typeof err === "string" ? err : err.message,
            activeDeposit: null,
            depositInvoice: null,
          });
        });

        return invoice ?? null;
      } catch (err) {
        console.error("[nip60] Failed to start deposit:", err);
        set({
          depositStatus: "error",
          error: err instanceof Error ? err.message : "Failed to start deposit",
          activeDeposit: null,
          depositInvoice: null,
        });
        return null;
      }
    },

    cancelDeposit: (): void => {
      set({
        activeDeposit: null,
        depositInvoice: null,
        depositStatus: "idle",
      });
    },

    withdrawLightning: async (invoice: string): Promise<boolean> => {
      const wallet = get().wallet;
      if (!wallet) {
        console.warn("[nip60] Cannot withdraw without wallet");
        return false;
      }

      // Helper function to attempt withdrawal
      const attemptWithdraw = async (): Promise<boolean> => {
        const result = await wallet.lnPay({ pr: invoice });
        // Small delay to allow wallet to process the change
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Refresh to update balance
        await get().refresh();
        return true;
      };

      try {
        return await attemptWithdraw();
      } catch (err) {
        console.error("[nip60] Failed to withdraw (first attempt):", err);
        const errorMessage = err instanceof Error ? err.message : String(err);

        // Handle state sync errors - consolidate and retry
        const isStateError =
          errorMessage.toLowerCase().includes("already spent") ||
          errorMessage.toLowerCase().includes("token spent") ||
          errorMessage.toLowerCase().includes("proof not found");

        if (isStateError) {
          try {
            await wallet.consolidateTokens();
            await get().refresh();

            // Retry the withdrawal
            return await attemptWithdraw();
          } catch (retryErr) {
            console.error(
              "[nip60] Retry after consolidation failed:",
              retryErr,
            );
            // Always refresh to show accurate balance
            await get().refresh();
            throw retryErr;
          }
        }

        // Always refresh after error to sync state
        await get().refresh();
        throw err;
      }
    },

    sendEcash: async (
      amount: number,
      mint?: string,
    ): Promise<string | null> => {
      const wallet = get().wallet;
      const state = get();
      if (!wallet) {
        console.warn("[nip60] Cannot send without wallet");
        return null;
      }

      // Get current state
      const { totalBalance, mintBalances } = getBalancesFromState(wallet);

      // Determine target mint
      let targetMint = mint ?? state.defaultMint ?? undefined;

      // If no mint specified, find one with sufficient balance
      if (!targetMint) {
        targetMint = Object.keys(mintBalances).find(
          (m) => (mintBalances[m] ?? 0) >= amount,
        );
      }

      if (!targetMint) {
        throw new Error(
          `No mint with sufficient balance. Available: ${totalBalance} sats`,
        );
      }

      const mintBalance = mintBalances[targetMint] ?? 0;
      if (mintBalance < amount) {
        throw new Error(
          `Insufficient balance at ${getMintHostname(targetMint)}. Available: ${mintBalance} sats`,
        );
      }

      // Get proofs for this mint using shared utility
      const allMintProofs = getProofsForMint(wallet, targetMint);

      // Filter out proofs we've recently spent (before consolidation confirms them spent)
      const mintProofs = filterOutRecentlySpent(allMintProofs);

      if (mintProofs.length === 0) {
        throw new Error(
          `No proofs available at ${getMintHostname(targetMint)}. Try refreshing your wallet.`,
        );
      }

      // Select proofs to use
      const { selected: selectedProofs, total: selectedTotal } = selectProofs(
        mintProofs,
        amount,
      );

      if (selectedTotal < amount) {
        throw new Error(
          `Could not select enough proofs. Need ${amount}, have ${selectedTotal}`,
        );
      }

      try {
        // Create CashuWallet for mint operations
        const cashuMint = new CashuMint(targetMint);
        const cashuWallet = new CashuWallet(cashuMint);

        // Load mint keys
        await cashuWallet.loadMint();

        let tokenProofs: Proof[];
        let changeProofs: Proof[] = [];

        if (selectedTotal === amount) {
          // Exact amount - use proofs directly
          tokenProofs = selectedProofs;
        } else {
          // Need to swap for exact amount + change
          const swapResult = await cashuWallet.swap(amount, selectedProofs);
          tokenProofs = swapResult.send;
          changeProofs = swapResult.keep;
        }

        // Create the token
        const token = getEncodedToken({
          mint: targetMint,
          proofs: tokenProofs,
        });

        // Mark ALL proofs we used as spent locally to prevent reuse
        // This includes both the tokenProofs and any proofs used in the swap
        markProofsAsSpent(selectedProofs);

        // Save to pending tokens IMMEDIATELY before any state updates
        const pendingToken: PendingNip60Token = {
          id: generateId(),
          token,
          amount: tokenProofs.reduce((s, p) => s + p.amount, 0),
          mintUrl: targetMint,
          createdAt: Date.now(),
          status: "pending",
        };

        const pendingTokens = [...get().pendingTokens, pendingToken];
        savePendingTokensToStorage(pendingTokens);
        set({ pendingTokens });

        // The proofs we used are now "spent" at the mint.
        // NDKCashuWallet stores proofs in Nostr events, and the wallet will detect
        // spent proofs on the next consolidateTokens() call.
        //
        // The token is already saved to pending list, so even if state sync fails,
        // the token won't be lost - user can reclaim or share it.
        //
        // For change proofs, we need to add them back to the wallet
        if (changeProofs.length > 0) {
          try {
            // Receive the change proofs back into the wallet
            const changeToken = getEncodedToken({
              mint: targetMint,
              proofs: changeProofs,
            });
            await wallet.receiveToken(changeToken);
          } catch (changeErr) {
            console.error(
              "[nip60] Failed to add change proofs (will recover on consolidation):",
              changeErr,
            );
          }
        }

        // Consolidate to sync state (detect spent proofs)
        try {
          await wallet.consolidateTokens();
        } catch (consolidateErr) {
          console.error(
            "[nip60] Consolidation error (non-fatal):",
            consolidateErr,
          );
        }

        // Refresh to update balance display
        await get().refresh();

        return token;
      } catch (err) {
        console.error("[nip60] Failed to send eCash:", err);

        // Check if this is a "proofs already spent" error from the mint
        const errorMessage = err instanceof Error ? err.message : String(err);
        if (
          errorMessage.toLowerCase().includes("already spent") ||
          errorMessage.toLowerCase().includes("token spent")
        ) {
          try {
            await wallet.consolidateTokens();
            await get().refresh();
          } catch (consolidateErr) {
            console.error("[nip60] Consolidation failed:", consolidateErr);
          }
          throw new Error("Some proofs were already spent. Please try again.");
        }

        // Provide more user-friendly error messages
        if (err instanceof Error) {
          if (
            err.message.includes("amount preferences") ||
            err.message.includes("keyset")
          ) {
            throw new Error(
              `Cannot create exact amount of ${amount} sats. Try a different amount.`,
            );
          }
        }

        throw err;
      }
    },

    receiveEcash: async (token: string): Promise<boolean> => {
      const wallet = get().wallet;
      if (!wallet) {
        console.warn("[nip60] Cannot receive without wallet");
        return false;
      }

      try {
        await wallet.receiveToken(token);

        // Refresh to update balance
        await get().refresh();
        return true;
      } catch (err) {
        console.error("[nip60] Failed to receive eCash:", err);
        throw err;
      }
    },

    loadPendingTokens: (): void => {
      const tokens = loadPendingTokensFromStorage();
      set({ pendingTokens: tokens });
    },

    reclaimToken: async (tokenId: string): Promise<boolean> => {
      const wallet = get().wallet;
      if (!wallet) {
        throw new Error("Wallet not initialized");
      }

      const pendingToken = get().pendingTokens.find((t) => t.id === tokenId);
      if (!pendingToken) {
        throw new Error("Pending token not found");
      }

      try {
        // Try to receive the token back
        await wallet.receiveToken(pendingToken.token);

        // Update status to reclaimed
        const pendingTokens = get().pendingTokens.map((t) =>
          t.id === tokenId ? { ...t, status: "reclaimed" as const } : t,
        );
        savePendingTokensToStorage(pendingTokens);
        set({ pendingTokens });

        // Refresh balances
        await get().refresh();
        return true;
      } catch (err) {
        // Mark as claimed
        const pendingTokens = get().pendingTokens.map((t) =>
          t.id === tokenId ? { ...t, status: "claimed" as const } : t,
        );
        savePendingTokensToStorage(pendingTokens);
        set({ pendingTokens });

        return false;
      }
    },

    removePendingToken: (tokenId: string): void => {
      const pendingTokens = get().pendingTokens.filter((t) => t.id !== tokenId);
      savePendingTokensToStorage(pendingTokens);
      set({ pendingTokens });
    },

    getActivePendingTokens: (): PendingNip60Token[] => {
      return get().pendingTokens.filter((t) => t.status === "pending");
    },
  }),
);

// Action helpers for non-hook usage
export const nip60Actions = {
  initialize: (pubkey: string, ndk: NDK) =>
    useNip60Store.getState().initialize(pubkey, ndk),
  loadTransactions: () => useNip60Store.getState().loadTransactions(),
  subscribeToTransactions: () =>
    useNip60Store.getState().subscribeToTransactions(),
  createWallet: (mints: string[]) =>
    useNip60Store.getState().createWallet(mints),
  reset: () => useNip60Store.getState().reset(),
  getWallet: () => useNip60Store.getState().getWallet(),
  refresh: (options?: { consolidate?: boolean }) =>
    useNip60Store.getState().refresh(options),
  addMint: (mintUrl: string) => useNip60Store.getState().addMint(mintUrl),
  removeMint: (mintUrl: string) => useNip60Store.getState().removeMint(mintUrl),
  publishWallet: () => useNip60Store.getState().publishWallet(),
  setDefaultMint: (mintUrl: string | null) =>
    useNip60Store.getState().setDefaultMint(mintUrl),
  startDeposit: (amount: number, mint?: string) =>
    useNip60Store.getState().startDeposit(amount, mint),
  cancelDeposit: () => useNip60Store.getState().cancelDeposit(),
  withdrawLightning: (invoice: string) =>
    useNip60Store.getState().withdrawLightning(invoice),
  sendEcash: (amount: number, mint?: string) =>
    useNip60Store.getState().sendEcash(amount, mint),
  receiveEcash: (token: string) => useNip60Store.getState().receiveEcash(token),
  loadPendingTokens: () => useNip60Store.getState().loadPendingTokens(),
  reclaimToken: (tokenId: string) =>
    useNip60Store.getState().reclaimToken(tokenId),
  removePendingToken: (tokenId: string) =>
    useNip60Store.getState().removePendingToken(tokenId),
  getActivePendingTokens: () =>
    useNip60Store.getState().getActivePendingTokens(),
};

#!/usr/bin/env bun
/**
 * Event Kind Migration Script
 *
 * This script migrates Nostr GeoJSON events from old kinds to new kinds:
 * - 31991 → 37515 (GeoJSON Data Event)
 * - 30406 → 37516 (GeoJSON Collection Event)
 * - 31992 → 37517 (GeoJSON Comment Event)
 *
 * Usage:
 *   bun run scripts/migrate-event-kinds.ts
 *
 * Configure either PRIVATE_KEYS or NOSTR_CONNECT_URIS below.
 */

import { finalizeEvent, getPublicKey, nip19 } from "nostr-tools";
import { Relay } from "nostr-tools/relay";
import { BunkerSigner, parseBunkerInput } from "nostr-tools/nip46";

// ============================================================================
// CONFIGURATION - Edit these values before running
// ============================================================================

/**
 * Private keys of authors whose events should be migrated.
 * Accepts either:
 * - nsec format: "nsec1..."
 * - hex format: "abc123..."
 *
 * Add your private keys here:
 */
const PRIVATE_KEYS: string[] = [
  // "5c81b...",
];

/**
 * Nostr Connect / Bunker URIs for remote signing (NIP-46)
 * Accepts:
 * - bunker:// URIs
 * - nostrconnect:// URIs
 *
 * Example:
 *   "bunker://pubkey?relay=wss://relay.example.com&secret=..."
 *
 * Add your bunker URIs here:
 */
const NOSTR_CONNECT_URIS: string[] = [
  // 'bunker://'
];

/**
 * Source relay to fetch events from
 */
const SOURCE_RELAY = "wss://relay.wavefunc.live";

/**
 * Target relay(s) to publish migrated events to
 * By default, publishes back to the source relay
 */
const TARGET_RELAYS = [SOURCE_RELAY];

/**
 * Dry run mode - if true, events are fetched and processed but not published
 */
const DRY_RUN = false;

/**
 * Timeout for bunker connection in milliseconds
 */
const BUNKER_TIMEOUT_MS = 60000;

// ============================================================================
// KIND MAPPINGS
// ============================================================================

const OLD_KINDS = {
  GEO_EVENT: 31991,
  GEO_COLLECTION: 30406,
  GEO_COMMENT: 31992,
} as const;

const NEW_KINDS = {
  GEO_EVENT: 37515,
  GEO_COLLECTION: 37516,
  GEO_COMMENT: 37517,
} as const;

const KIND_MAPPING: Record<number, number> = {
  [OLD_KINDS.GEO_EVENT]: NEW_KINDS.GEO_EVENT,
  [OLD_KINDS.GEO_COLLECTION]: NEW_KINDS.GEO_COLLECTION,
  [OLD_KINDS.GEO_COMMENT]: NEW_KINDS.GEO_COMMENT,
};

// ============================================================================
// TYPES
// ============================================================================

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

interface UnsignedEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

interface Signer {
  type: "local" | "bunker";
  pubkey: string;
  sign: (event: UnsignedEvent) => Promise<NostrEvent>;
  close?: () => void;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Parse a private key from nsec or hex format to Uint8Array
 */
function parsePrivateKey(key: string): Uint8Array {
  if (key.startsWith("nsec1")) {
    const decoded = nip19.decode(key);
    if (decoded.type !== "nsec") {
      throw new Error(`Invalid nsec key: ${key}`);
    }
    return decoded.data;
  }
  // Assume hex format
  return hexToBytes(key);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Update kind references in tags (for addresses like "31991:pubkey:id")
 */
function migrateTagKinds(tags: string[][]): string[][] {
  return tags.map((tag) => {
    return tag.map((value) => {
      // Check for address format: "kind:pubkey:identifier"
      for (const [oldKind, newKind] of Object.entries(KIND_MAPPING)) {
        const oldPrefix = `${oldKind}:`;
        if (value.startsWith(oldPrefix)) {
          return `${newKind}:${value.slice(oldPrefix.length)}`;
        }
      }
      // Check for kind tag values like ["k", "31991"] or ["K", "31991"]
      if (tag[0] === "k" || tag[0] === "K") {
        const kindValue = parseInt(value, 10);
        if (KIND_MAPPING[kindValue]) {
          return String(KIND_MAPPING[kindValue]);
        }
      }
      return value;
    });
  });
}

/**
 * Create a local signer from a private key
 */
function createLocalSigner(privateKey: Uint8Array): Signer {
  const pubkey = getPublicKey(privateKey);
  return {
    type: "local",
    pubkey,
    sign: async (event: UnsignedEvent): Promise<NostrEvent> => {
      return finalizeEvent(event, privateKey) as NostrEvent;
    },
  };
}

/**
 * Create a bunker signer from a nostrconnect/bunker URI
 */
async function createBunkerSigner(uri: string): Promise<Signer> {
  console.log(`   🔐 Parsing bunker URI...`);

  // Parse the bunker URI (supports both bunker:// and nostrconnect://)
  const bunkerPointer = await parseBunkerInput(uri);
  if (!bunkerPointer) {
    throw new Error("Failed to parse bunker URI");
  }

  console.log(
    `   🔌 Connecting to bunker via ${bunkerPointer.relays.join(", ")}...`,
  );
  console.log(
    `   ⏳ Waiting for approval (timeout: ${BUNKER_TIMEOUT_MS / 1000}s)...`,
  );

  const clientSecretKey = crypto.getRandomValues(new Uint8Array(32));

  const bunker = BunkerSigner.fromBunker(clientSecretKey, bunkerPointer, {});

  // Connect with timeout (skip if already connected)
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("Bunker connection timeout")),
      BUNKER_TIMEOUT_MS,
    );
  });

  try {
    await Promise.race([bunker.connect(), timeoutPromise]);
  } catch (error) {
    // Ignore "already connected" error - some bunkers auto-connect
    const errorMessage = String(error);
    if (!errorMessage.includes("already connected")) {
      throw new Error(`Failed to connect to bunker: ${error}`);
    }
  }

  const pubkey = await bunker.getPublicKey();
  console.log(
    `   ✅ Connected to bunker for pubkey: ${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`,
  );

  return {
    type: "bunker",
    pubkey,
    sign: async (event: UnsignedEvent): Promise<NostrEvent> => {
      const signedEvent = await bunker.signEvent(event as any);
      return signedEvent as unknown as NostrEvent;
    },
    close: () => {
      bunker.close();
    },
  };
}

// ============================================================================
// MAIN MIGRATION LOGIC
// ============================================================================

async function fetchEventsForPubkey(
  relay: Relay,
  pubkey: string,
): Promise<NostrEvent[]> {
  const events: NostrEvent[] = [];
  const oldKinds = Object.values(OLD_KINDS);

  return new Promise((resolve, reject) => {
    const sub = relay.subscribe(
      [
        {
          authors: [pubkey],
          kinds: oldKinds,
        },
      ],
      {
        onevent(event) {
          events.push(event as NostrEvent);
        },
        oneose() {
          sub.close();
          resolve(events);
        },
        onclose(reason) {
          if (reason !== "closed by caller") {
            reject(new Error(`Subscription closed: ${reason}`));
          }
        },
      },
    );

    // Timeout after 30 seconds
    setTimeout(() => {
      sub.close();
      resolve(events);
    }, 30000);
  });
}

async function migrateEvent(
  event: NostrEvent,
  signer: Signer,
): Promise<NostrEvent | null> {
  const newKind = KIND_MAPPING[event.kind];
  if (!newKind) {
    console.log(
      `  ⏭️  Skipping event ${event.id.slice(0, 8)}... - kind ${event.kind} not in migration list`,
    );
    return null;
  }

  // Create new event with updated kind
  const unsignedEvent: UnsignedEvent = {
    pubkey: event.pubkey,
    created_at: Math.floor(Date.now() / 1000), // Use current timestamp
    kind: newKind,
    tags: migrateTagKinds(event.tags),
    content: event.content,
  };

  // Sign the new event
  const signedEvent = await signer.sign(unsignedEvent);
  return signedEvent;
}

async function publishEvent(relay: Relay, event: NostrEvent): Promise<boolean> {
  return new Promise((resolve) => {
    relay
      .publish(event)
      .then(() => {
        resolve(true);
      })
      .catch((error) => {
        console.error(`  ❌ Failed to publish: ${error}`);
        resolve(false);
      });
  });
}

async function main() {
  console.log(
    "╔════════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║           Nostr GeoJSON Event Kind Migration Script            ║",
  );
  console.log(
    "╚════════════════════════════════════════════════════════════════╝",
  );
  console.log();

  if (PRIVATE_KEYS.length === 0 && NOSTR_CONNECT_URIS.length === 0) {
    console.error("❌ No signers configured!");
    console.error("   Edit PRIVATE_KEYS or NOSTR_CONNECT_URIS in this script.");
    console.error();
    console.error("   Examples:");
    console.error("   const PRIVATE_KEYS = ['nsec1...', 'abc123...']");
    console.error(
      "   const NOSTR_CONNECT_URIS = ['bunker://pubkey?relay=...&secret=...']",
    );
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log("🔍 DRY RUN MODE - Events will be processed but not published");
    console.log("   Set DRY_RUN = false to actually publish migrated events");
    console.log();
  }

  console.log(`📡 Source relay: ${SOURCE_RELAY}`);
  console.log(`📤 Target relays: ${TARGET_RELAYS.join(", ")}`);
  console.log();
  console.log("Kind mappings:");
  console.log(
    `  • GeoJSON Data Event:    ${OLD_KINDS.GEO_EVENT} → ${NEW_KINDS.GEO_EVENT}`,
  );
  console.log(
    `  • GeoJSON Collection:    ${OLD_KINDS.GEO_COLLECTION} → ${NEW_KINDS.GEO_COLLECTION}`,
  );
  console.log(
    `  • GeoJSON Comment:       ${OLD_KINDS.GEO_COMMENT} → ${NEW_KINDS.GEO_COMMENT}`,
  );
  console.log();

  // Build signers from private keys and bunker URIs
  const signers: Signer[] = [];

  // Add local signers from private keys
  console.log("🔑 Loading signers...");
  for (const key of PRIVATE_KEYS) {
    try {
      const privateKey = parsePrivateKey(key);
      const signer = createLocalSigner(privateKey);
      signers.push(signer);
      console.log(
        `   ✅ Local key: ${signer.pubkey.slice(0, 8)}...${signer.pubkey.slice(-8)}`,
      );
    } catch (error) {
      console.error(`   ❌ Failed to parse private key: ${error}`);
      process.exit(1);
    }
  }

  // Add bunker signers from nostrconnect URIs
  for (const uri of NOSTR_CONNECT_URIS) {
    try {
      console.log(`\n🔐 Connecting to bunker...`);
      const signer = await createBunkerSigner(uri);
      signers.push(signer);
    } catch (error) {
      console.error(`   ❌ Failed to connect to bunker: ${error}`);
      console.error("   Skipping this signer...");
    }
  }

  if (signers.length === 0) {
    console.error("\n❌ No valid signers available!");
    process.exit(1);
  }

  console.log(`\n✅ Loaded ${signers.length} signer(s)`);
  console.log();

  // Connect to source relay
  console.log(`🔌 Connecting to ${SOURCE_RELAY}...`);
  let sourceRelay: Relay;
  try {
    sourceRelay = await Relay.connect(SOURCE_RELAY);
    console.log("✅ Connected to source relay");
  } catch (error) {
    console.error(`❌ Failed to connect to source relay: ${error}`);
    process.exit(1);
  }

  // Connect to target relays
  const targetRelays: Relay[] = [];
  if (!DRY_RUN) {
    for (const url of TARGET_RELAYS) {
      try {
        if (url === SOURCE_RELAY) {
          targetRelays.push(sourceRelay);
        } else {
          const relay = await Relay.connect(url);
          targetRelays.push(relay);
        }
        console.log(`✅ Connected to target relay: ${url}`);
      } catch (error) {
        console.error(`❌ Failed to connect to target relay ${url}: ${error}`);
      }
    }
  }
  console.log();

  // Process each signer
  let totalFetched = 0;
  let totalMigrated = 0;
  let totalPublished = 0;

  for (const signer of signers) {
    const signerLabel = `${signer.pubkey.slice(0, 8)}...${signer.pubkey.slice(-8)}`;
    const signerType = signer.type === "bunker" ? "🔐 bunker" : "🔑 local";
    console.log(`\n👤 Processing author: ${signerLabel} (${signerType})`);
    console.log("   Fetching events...");

    const events = await fetchEventsForPubkey(sourceRelay, signer.pubkey);
    totalFetched += events.length;
    console.log(`   Found ${events.length} events with old kinds`);

    for (const event of events) {
      const kindName =
        Object.entries(OLD_KINDS).find(([_, v]) => v === event.kind)?.[0] ||
        "UNKNOWN";
      console.log(
        `   📄 Event ${event.id.slice(0, 8)}... (kind ${event.kind} - ${kindName})`,
      );

      try {
        const migratedEvent = await migrateEvent(event, signer);
        if (!migratedEvent) continue;

        totalMigrated++;
        console.log(`      → Migrated to kind ${migratedEvent.kind}`);

        if (!DRY_RUN) {
          for (const relay of targetRelays) {
            const success = await publishEvent(relay, migratedEvent);
            if (success) {
              console.log(`      ✅ Published to ${relay.url}`);
              totalPublished++;
            }
          }
        } else {
          console.log("      🔍 (dry run - not publishing)");
        }
      } catch (error) {
        console.error(`      ❌ Failed to migrate event: ${error}`);
      }
    }
  }

  // Cleanup
  sourceRelay.close();
  for (const relay of targetRelays) {
    if (relay.url !== SOURCE_RELAY) {
      relay.close();
    }
  }
  for (const signer of signers) {
    signer.close?.();
  }

  // Summary
  console.log(
    "\n════════════════════════════════════════════════════════════════",
  );
  console.log(
    "                          SUMMARY                               ",
  );
  console.log(
    "════════════════════════════════════════════════════════════════",
  );
  console.log(`  Total events fetched:    ${totalFetched}`);
  console.log(`  Total events migrated:   ${totalMigrated}`);
  if (!DRY_RUN) {
    console.log(`  Total events published:  ${totalPublished}`);
  } else {
    console.log("  (Dry run - no events published)");
  }
  console.log();

  if (DRY_RUN && totalMigrated > 0) {
    console.log("💡 To actually publish the migrated events:");
    console.log("   1. Set DRY_RUN = false in this script");
    console.log("   2. Run the script again");
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

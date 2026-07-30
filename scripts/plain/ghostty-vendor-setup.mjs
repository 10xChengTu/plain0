// F070 VT integration gating (docs/research/2026-07-24-libghostty-terminal.md):
// `libghostty-vt-sys`'s build.rs shells out to `zig build` and, unless
// `GHOSTTY_SOURCE_DIR` points at an existing local checkout, clones the
// ~151 MiB Ghostty repository into `OUT_DIR` on every clean build. This
// script does two things, both idempotent, before any `cargo` invocation
// that touches `libghostty-vt`:
//
// 1. Pre-clones the exact pinned commit into a stable, gitignored location
//    outside `src-tauri/target` (`.ghostty-vendor/ghostty`), which
//    `src-tauri/.cargo/config.toml` points `GHOSTTY_SOURCE_DIR` at (relative
//    to the repo root). That location survives `rm -rf src-tauri/target`
//    and is only ever cloned once per machine.
// 2. Pre-warms Zig's *global* package cache (`~/.cache/zig` by default —
//    outside `target/`, and not affected by `GHOSTTY_SOURCE_DIR`) by running
//    a real `zig build` against the vendored checkout once, with the same
//    flags `libghostty-vt-sys`'s build.rs itself passes. Once every
//    dependency Ghostty's `build.zig.zon` declares (e.g. `vaxis`, `uucode`)
//    is resolved into that content-addressed cache, Zig does not attempt any
//    further network fetch for the same pinned commit — it is a pure cache
//    lookup — so `cargo test`/`cargo clippy`'s own `zig build` invocation
//    (run for real via build.rs, once per this repo's own build, not by this
//    script) never has to touch the network again.
//
// Both of Zig's own fetch paths (git+https dependencies resolved by its
// built-in HTTP client, observed here fetching `vaxis`/`uucode`) have proven
// unreliable through this machine's configured HTTP(S) proxy — and, on a
// later run, *without* the proxy too (a transient
// "HttpConnectionClosing" reset going direct). Neither direction is
// consistently broken or consistently fine; the failure is transient
// network flakiness in Zig's fetch client either way. Retrying a few times
// (proxy cleared first, since that direction succeeds far more often in
// practice, then with the ambient proxy as a fallback) reliably gets one
// attempt through, and this is the *only* place in the whole gating design
// that ever needs to retry — everything downstream of a warm global cache
// is a deterministic, network-free cache hit.
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VENDOR_DIR = join(REPO_ROOT, ".ghostty-vendor", "ghostty");
const COMMIT_STAMP_FILE = join(VENDOR_DIR, ".ghostty-commit");
const ZIG_PRIMED_STAMP_FILE = join(VENDOR_DIR, ".zig-cache-primed");
const GHOSTTY_REPO = "https://github.com/ghostty-org/ghostty.git";
// Must match `GHOSTTY_COMMIT` in the vendored `libghostty-vt-sys` crate's
// `build.rs` exactly — this is the commit libghostty-vt 0.2.1 is pinned to
// (confirmed against the crate's source and its Nix flake, both of which
// reference the same hash).
const GHOSTTY_COMMIT = "a887df42c56f6de86c0fe6da9c4eeca37931e083";
const ZIG_PREWARM_ATTEMPTS = 5;
const ZIG_PREWARM_RETRY_DELAY_MS = 3000;

const PROXY_ENV_VARS = [
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"http_proxy",
	"https_proxy",
];

function withoutProxyEnv() {
	const env = { ...process.env };
	for (const name of PROXY_ENV_VARS) {
		delete env[name];
	}
	return env;
}

function isVendoredAtPinnedCommit() {
	if (
		!existsSync(COMMIT_STAMP_FILE) ||
		!existsSync(join(VENDOR_DIR, "build.zig"))
	) {
		return false;
	}
	return readFileSync(COMMIT_STAMP_FILE, "utf8").trim() === GHOSTTY_COMMIT;
}

function isZigCachePrimedForPinnedCommit() {
	return (
		existsSync(ZIG_PRIMED_STAMP_FILE) &&
		readFileSync(ZIG_PRIMED_STAMP_FILE, "utf8").trim() === GHOSTTY_COMMIT
	);
}

function run(command, args, options) {
	execFileSync(command, args, { stdio: "inherit", ...options });
}

function cloneVendorCheckout() {
	if (existsSync(VENDOR_DIR)) {
		rmSync(VENDOR_DIR, { recursive: true, force: true });
	}
	mkdirSync(dirname(VENDOR_DIR), { recursive: true });
	console.log(
		`ghostty-vendor-setup: cloning pinned Ghostty commit ${GHOSTTY_COMMIT} into ${VENDOR_DIR} ...`,
	);
	// `--filter=blob:none --no-checkout` mirrors the fetch libghostty-vt-sys's
	// own build.rs performs when GHOSTTY_SOURCE_DIR is unset, to keep the
	// clone's transfer size down before checking out the single pinned commit.
	run("git", [
		"clone",
		"--filter=blob:none",
		"--no-checkout",
		GHOSTTY_REPO,
		VENDOR_DIR,
	]);
	run("git", ["checkout", GHOSTTY_COMMIT], { cwd: VENDOR_DIR });
	writeFileSync(COMMIT_STAMP_FILE, GHOSTTY_COMMIT);
}

// Matches the exact flags `libghostty-vt-sys`'s `build.rs` passes for a dev
// (`cargo test`/`cargo clippy`, no `--release`) build — see its
// `zig_optimize_mode()` (`DEBUG=true` -> `Debug`) and `build_vendored()`.
// `--prefix`/`--cache-dir` point at a throwaway scratch directory: this run's
// only real purpose is to populate Zig's *global* package cache as a side
// effect, not to keep the built library artifact.
function attemptZigCachePrewarm(env) {
	const scratchDir = mkdtempScratchDir();
	try {
		run(
			"zig",
			[
				"build",
				"-Demit-lib-vt=true",
				"-Doptimize=Debug",
				"-Demit-xcframework=false",
				"-Dapp-runtime=none",
				"--prefix",
				join(scratchDir, "install"),
				"--cache-dir",
				join(scratchDir, "cache"),
			],
			{ cwd: VENDOR_DIR, env },
		);
		return true;
	} catch (error) {
		console.warn(
			`ghostty-vendor-setup: zig build prewarm attempt failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	} finally {
		rmSync(scratchDir, { recursive: true, force: true });
	}
}

function mkdtempScratchDir() {
	const dir = join(tmpdir(), `plain-zig-prewarm-${process.pid}-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function sleep(ms) {
	// Node has no sync sleep primitive; a blocking wait is fine here since
	// this whole script already runs synchronously before any cargo command.
	execFileSync(process.execPath, ["-e", `setTimeout(() => {}, ${ms})`]);
}

function primeZigGlobalCache() {
	console.log(
		"ghostty-vendor-setup: priming Zig's global package cache (one-time network fetch) ...",
	);
	const envCandidates = [withoutProxyEnv(), process.env];
	for (let attempt = 1; attempt <= ZIG_PREWARM_ATTEMPTS; attempt += 1) {
		const env = envCandidates[Math.min(attempt - 1, envCandidates.length - 1)];
		const proxyState =
			env === process.env ? "with ambient proxy env" : "with proxy env cleared";
		console.log(
			`ghostty-vendor-setup: zig build prewarm attempt ${attempt}/${ZIG_PREWARM_ATTEMPTS} (${proxyState}) ...`,
		);
		if (attemptZigCachePrewarm(env)) {
			writeFileSync(ZIG_PRIMED_STAMP_FILE, GHOSTTY_COMMIT);
			console.log("ghostty-vendor-setup: zig global package cache primed.");
			return;
		}
		if (attempt < ZIG_PREWARM_ATTEMPTS) {
			sleep(ZIG_PREWARM_RETRY_DELAY_MS);
		}
	}
	throw new Error(
		`ghostty-vendor-setup: could not prime Zig's global package cache after ${ZIG_PREWARM_ATTEMPTS} attempts. ` +
			"This is required once per machine so that libghostty-vt-sys's build.rs (invoked by cargo) never needs " +
			"to fetch Zig packages over the network itself. See docs/research/2026-07-24-libghostty-terminal.md.",
	);
}

if (isVendoredAtPinnedCommit()) {
	console.log(
		`ghostty-vendor-setup: already at pinned commit ${GHOSTTY_COMMIT}, skipping clone.`,
	);
} else {
	cloneVendorCheckout();
}

if (isZigCachePrimedForPinnedCommit()) {
	console.log(
		"ghostty-vendor-setup: zig global package cache already primed, skipping.",
	);
} else {
	primeZigGlobalCache();
}

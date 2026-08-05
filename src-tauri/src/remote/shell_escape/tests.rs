//! Exhaustive hostile-input matrix for [`super::encode_posix_command_line`],
//! plus the one property this module's entire safety story rests on:
//! **round-tripping through a real `/bin/sh -c` reproduces the exact
//! original argv, byte for byte.** [`round_trip_via_real_shell`] is the one
//! harness every hostile-matrix case (and the randomized property test)
//! funnels through — it never merely inspects the encoded string's shape,
//! it hands that exact string to a real POSIX shell and observes what a real
//! shell's own parser actually recovers, exactly mirroring what a real `sshd`
//! does with `remote::remote_git`'s encoded command line (`<shell> -c
//! "<command>"`).

use std::process::Command;

use super::encode_posix_command_line;

/// The inner "echo every argument, NUL-terminated" script every round-trip
/// case reuses — see the module doc. `"$@"` (not `"$*"`) is essential: it
/// expands to each positional parameter as its own word, preserving embedded
/// spaces/newlines/etc. exactly, which is the entire point of this harness.
const ECHO_SCRIPT: &str = "for a in \"$@\"; do printf '%s\\0' \"$a\"; done";

/// Hands `hostile_args` to the real shell-encoding-and-execution round trip
/// described in the module doc, and returns exactly the argv elements a real
/// `/bin/sh` parsed back out of the encoded command line — nothing about this
/// function's own assembly of `full_argv` performs any escaping of its own;
/// [`encode_posix_command_line`] is the only thing between `full_argv` and
/// the live shell invocation, so any mis-encoding shows up here as a mismatch
/// against `hostile_args`.
///
/// `full_argv` is `["/bin/sh", "-c", ECHO_SCRIPT, "marker", ...hostile_args]`:
/// invoking `/bin/sh -c '<script>' marker arg1 arg2 …` sets the script's own
/// `$0` to `"marker"` (never read) and `"$@"` to exactly `hostile_args`, in
/// order. The *outer* `sh -c "<encoded>"` call is what actually exercises
/// [`encode_posix_command_line`]'s output — it must parse `<encoded>` back
/// into exactly `full_argv`'s tokens for the inner script to ever run at all,
/// let alone echo the right things.
fn round_trip_via_real_shell(hostile_args: &[String]) -> Vec<Vec<u8>> {
    let mut full_argv = vec![
        "/bin/sh".to_owned(),
        "-c".to_owned(),
        ECHO_SCRIPT.to_owned(),
        "marker".to_owned(),
    ];
    full_argv.extend(hostile_args.iter().cloned());

    let encoded = encode_posix_command_line(&full_argv)
        .unwrap_or_else(|error| panic!("encoding {full_argv:?} must succeed: {error:?}"));

    let output = Command::new("sh")
        .arg("-c")
        .arg(&encoded)
        .output()
        .expect("the outer `sh -c` invocation itself spawns");
    assert!(
        output.status.success(),
        "outer shell must exit successfully — encoded={encoded:?} stderr={}",
        String::from_utf8_lossy(&output.stderr)
    );

    let mut parts: Vec<Vec<u8>> = output
        .stdout
        .split(|&byte| byte == 0)
        .map(<[u8]>::to_vec)
        .collect();
    // The echo script NUL-terminates every argument (never NUL-separates), so
    // splitting on NUL always leaves exactly one trailing empty chunk after
    // the final terminator — this holds even for zero hostile args (empty
    // stdout still splits into the single empty chunk `[b""]`).
    assert_eq!(
        parts.pop(),
        Some(Vec::new()),
        "echoed stdout must end with the script's own trailing NUL terminator"
    );
    parts
}

fn assert_round_trips(hostile_args: &[&str]) {
    let owned: Vec<String> = hostile_args.iter().map(|arg| (*arg).to_owned()).collect();
    let recovered = round_trip_via_real_shell(&owned);
    let expected: Vec<Vec<u8>> = owned.iter().map(|arg| arg.as_bytes().to_vec()).collect();
    assert_eq!(
        recovered, expected,
        "round trip must reproduce the exact original argv, byte for byte"
    );
}

// --- Hostile matrix, each verified via a real `/bin/sh -c` round trip -----

#[test]
fn round_trips_an_empty_argument() {
    assert_round_trips(&[""]);
}

#[test]
fn round_trips_a_pure_whitespace_argument() {
    assert_round_trips(&["   "]);
    assert_round_trips(&["\t\t"]);
}

#[test]
fn round_trips_a_single_quote() {
    assert_round_trips(&["it's"]);
}

#[test]
fn round_trips_consecutive_single_quotes() {
    assert_round_trips(&["''"]);
    assert_round_trips(&["'''"]);
    assert_round_trips(&["a''b"]);
    assert_round_trips(&["'leading"]);
    assert_round_trips(&["trailing'"]);
}

#[test]
fn round_trips_a_double_quote() {
    assert_round_trips(&["\"hello\""]);
}

#[test]
fn round_trips_a_dollar_sign_expansion_attempt() {
    assert_round_trips(&["$HOME"]);
    assert_round_trips(&["$(whoami)"]);
    assert_round_trips(&["${PATH}"]);
}

#[test]
fn round_trips_a_backtick_command_substitution_attempt() {
    assert_round_trips(&["`id`"]);
}

#[test]
fn round_trips_an_embedded_newline() {
    // Newlines are legal, literal bytes inside a POSIX single-quoted string
    // and legal bytes in the SSH `exec` request's `command` string field —
    // this must round-trip correctly, not be rejected.
    assert_round_trips(&["line1\nline2"]);
    assert_round_trips(&["\n"]);
}

#[test]
fn round_trips_a_nul_byte_by_rejecting_it_before_any_shell_is_invoked() {
    let error = encode_posix_command_line(&["a\0b".to_owned()]).expect_err("NUL must be rejected");
    assert_eq!(error.code(), "REMOTE_SHELL_ESCAPE_INVALID");
}

#[test]
fn round_trips_shell_metacharacters() {
    assert_round_trips(&[";"]);
    assert_round_trips(&["|"]);
    assert_round_trips(&["&"]);
    assert_round_trips(&[">"]);
    assert_round_trips(&["<"]);
    assert_round_trips(&["*"]);
    assert_round_trips(&["?"]);
    assert_round_trips(&["~"]);
    assert_round_trips(&["\\"]);
    assert_round_trips(&["a;rm -rf /tmp/should-not-run"]);
    assert_round_trips(&["a|b>c<d&e"]);
}

#[test]
fn round_trips_an_argument_beginning_with_a_dash() {
    assert_round_trips(&["-rf"]);
    assert_round_trips(&["--force"]);
}

#[test]
fn round_trips_an_overlong_argument_within_the_ceiling() {
    let long = "x".repeat(50_000);
    assert_round_trips(&[long.as_str()]);
}

#[test]
fn rejects_a_command_line_that_exceeds_the_encoded_length_ceiling() {
    // Every `'` in the input becomes `'\''` (single quote -> 4 bytes) in the
    // worst case, so a run of single quotes is the fastest way to exceed
    // `MAX_ENCODED_COMMAND_LINE_BYTES` (131_072) without needing an
    // implausibly large input string.
    let hostile = "'".repeat(200_000);
    let error = encode_posix_command_line(&[hostile]).expect_err("oversized command must fail");
    assert_eq!(error.code(), "REMOTE_SHELL_ESCAPE_INVALID");
}

#[test]
fn rejects_an_empty_argv() {
    let error = encode_posix_command_line(&[]).expect_err("empty argv must fail");
    assert_eq!(error.code(), "REMOTE_SHELL_ESCAPE_INVALID");
}

#[test]
fn round_trips_a_realistic_multi_argument_git_invocation() {
    // Mirrors what `remote::remote_git` actually builds: a path argument, a
    // combined `-c key=value` token, and a subcommand with flags.
    assert_round_trips(&[
        "git",
        "-C",
        "/srv/plain projects/repo with spaces",
        "-c",
        "core.hooksPath=/dev/null",
        "status",
        "--porcelain=v2",
        "-z",
        "--branch",
        "--ignored",
    ]);
}

#[test]
fn round_trips_mixed_hostile_arguments_together_in_one_invocation() {
    assert_round_trips(&[
        "git",
        "-C",
        "/srv/repo",
        "commit",
        "--file",
        "-",
        "it's a \"message\" with $vars, `backticks`, and\nnewlines; | & > < * ? ~ \\",
    ]);
}

// --- Randomized / property-style round-trip coverage -----------------------

/// A tiny, dependency-free xorshift64* PRNG — this crate has no `rand`
/// dev-dependency, and adding one purely for a handful of randomized test
/// cases would be a heavier addition than this file's own needs justify (the
/// hostile matrix above already covers every specific adversarial byte class
/// deliberately; this generator's job is only to additionally stress
/// combinations/lengths a hand-written matrix would not think to include).
struct XorShift64(u64);

impl XorShift64 {
    fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
}

/// Generates a random argument string of 0–63 bytes: valid UTF-8 (a
/// `String`'s own type invariant), never a NUL byte, drawn from a pool that
/// deliberately overweights shell-hostile characters rather than sampling the
/// full Unicode range uniformly.
fn random_hostile_argument(rng: &mut XorShift64) -> String {
    const POOL: &[char] = &[
        'a', 'b', ' ', '\'', '"', '$', '`', '\n', '\t', ';', '|', '&', '>', '<', '*', '?', '~',
        '\\', '-', '(', ')', '{', '}', '!', '#', '0', '1',
    ];
    let length = (rng.next_u64() % 64) as usize;
    let mut value = String::with_capacity(length);
    for _ in 0..length {
        let index = (rng.next_u64() as usize) % POOL.len();
        value.push(POOL[index]);
    }
    value
}

#[test]
fn randomized_hostile_arguments_round_trip_across_many_cases() {
    let mut rng = XorShift64(0x9E37_79B9_7F4A_7C15);
    for case in 0..200 {
        let argument_count = 1 + (rng.next_u64() % 4) as usize;
        let arguments: Vec<String> = (0..argument_count)
            .map(|_| random_hostile_argument(&mut rng))
            .collect();
        let recovered = round_trip_via_real_shell(&arguments);
        let expected: Vec<Vec<u8>> = arguments
            .iter()
            .map(|arg| arg.as_bytes().to_vec())
            .collect();
        assert_eq!(
            recovered, expected,
            "randomized case {case} failed to round-trip: {arguments:?}"
        );
    }
}

// --- The type-level boundary: non-UTF-8 bytes cannot reach this function ---

/// This function's signature is `&[String]`, and `String` is guaranteed valid
/// UTF-8 by Rust's own type system — genuinely arbitrary non-UTF-8 bytes
/// (e.g. a lone `0xFF` byte, invalid in every UTF-8 position) cannot be
/// constructed into a `String` at all, so they can never reach
/// [`encode_posix_command_line`] in the first place. This test demonstrates
/// exactly where that boundary is enforced — not inside this module, but one
/// layer earlier, at `String::from_utf8`'s own fallibility — which is why
/// this module itself only needs to reason about valid-UTF-8 input.
#[test]
fn non_utf8_byte_sequences_cannot_be_constructed_into_the_string_argv_this_function_accepts() {
    let invalid_utf8 = vec![0xFF, 0xFE, 0xFD];
    assert!(
        String::from_utf8(invalid_utf8).is_err(),
        "a byte sequence that is not valid UTF-8 must fail String::from_utf8 — this is the \
         actual boundary that keeps non-UTF-8 bytes out of encode_posix_command_line, which \
         cannot even be called with them"
    );

    // A lone continuation byte and an overlong encoding are both invalid at
    // the very first byte — neither can become a `String` either.
    assert!(String::from_utf8(vec![0x80]).is_err());
    assert!(String::from_utf8(vec![0xC0, 0x80]).is_err());
}

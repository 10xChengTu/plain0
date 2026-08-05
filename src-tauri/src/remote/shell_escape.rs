//! `F220` S6: a strict, single-purpose POSIX shell single-quote encoder — the
//! one thing standing between "an argv array" and "a single command-line
//! string", which is all SSH's `exec` request wire format actually is
//! (`channel.exec(want_reply, command)`, where `command` is one opaque byte
//! string the server almost always hands to `<login-shell> -c "<command>"`;
//! there is no argv-array framing anywhere in the SSH protocol itself for
//! this request type — see `remote::remote_git`'s own module doc for the full
//! exec-channel design this encoder is the safety-critical piece of).
//!
//! `AGENTS.md`'s "启动子进程必须使用参数数组，禁止拼接 shell 字符串" is written
//! for the common case (`std::process::Command`'s own native argv API), but
//! the underlying invariant — a byte in one argument must never be
//! reinterpreted as a delimiter or an operator by whatever eventually parses
//! the command line — applies here too, even though the wire format itself
//! leaves no alternative to producing a string. This module is how that
//! invariant is upheld anyway: [`encode_posix_command_line`] takes the real
//! argv array [`remote::remote_git`] would otherwise have handed to a
//! structured spawn API, and *deterministically* encodes it into the one
//! POSIX-shell-safe string that, when re-parsed by any POSIX-conformant
//! `sh -c "<...>"`, reproduces exactly those argv elements — no more, no
//! fewer, no bytes reinterpreted.
//!
//! # Why single-quoting is sufficient, unconditionally
//!
//! POSIX shell single quotes (`'...'`) are the simplest possible quoting
//! mechanism: **every** byte between them is a literal, with the sole
//! exception that a single quote itself cannot appear inside them at all (not
//! even escaped) — there is no escape character, no variable expansion, no
//! command substitution, no glob expansion, no field splitting, inside a
//! single-quoted string, full stop. That means every metacharacter this
//! product boundary must worry about — space, tab, newline, `"`, `$`,
//! backtick, `;`, `|`, `&`, `>`, `<`, `*`, `?`, `~`, `\`, a leading `-` — is
//! already inert the moment it is wrapped in single quotes; none of them need
//! individual case-by-case handling. The **only** byte that needs special
//! treatment is the single quote character itself, which is handled by the
//! standard, universally-documented POSIX idiom: close the quote, emit an
//! escaped literal quote, reopen the quote — `'` becomes `'\''`
//! (close-quote, backslash-escaped-quote, reopen-quote). Every argument is
//! wrapped in this scheme unconditionally (even an empty string, which
//! becomes the two-byte token `''` — POSIX shells treat `''` as one empty
//! argument, not as nothing at all, confirmed by this module's own hostile
//! test matrix), so there is never a code path that tries to decide whether
//! quoting is "needed" for a particular argument and gets that decision
//! wrong.
//!
//! # What this module deliberately does not attempt
//!
//! - **Double-quote / backslash-escape encoding.** Both are strictly more
//!   complex (backslash and `$`/backtick remain special inside double quotes;
//!   backslash-escaping a bare unquoted argument requires a much larger
//!   character class than just the quote character) for zero additional
//!   capability over single-quoting — there is no input this module needs to
//!   encode that single-quoting cannot represent (see the NUL-byte exception
//!   below, which no POSIX quoting style can represent either).
//! - **Executing anything.** This module is pure, synchronous, and has no
//!   knowledge of SSH, channels, or git — it takes a `&[String]` and returns a
//!   `Result<String, CommandError>`, nothing more. [`remote::remote_git`] is
//!   the sole caller (mechanically enforced — see
//!   `scripts/plain/boundary-contracts.mjs`'s
//!   `validateShellEscapeSoleCallerBoundary`), and the sole place any encoded
//!   command line is ever handed to a live channel.
//!
//! # NUL bytes are rejected, not encoded
//!
//! A NUL byte cannot survive an SSH `exec` request's `command` field the way
//! any other byte can — the field itself is length-prefixed at the SSH
//! framing layer, so NUL is not disallowed *by SSH*, but the receiving
//! shell almost universally treats the command line as a NUL-terminated C
//! string once it reaches `execve`-family APIs (a `sh -c` argument, like any
//! other C-string-based OS argument, cannot itself contain an embedded NUL).
//! There is no POSIX shell quoting construct that can make a NUL byte survive
//! that boundary intact; [`encode_single_argument`] therefore fails closed
//! the moment it sees one, rather than silently truncating or corrupting the
//! argument. See this module's own tests for the complementary, even more
//! fundamental boundary: a `String`'s own type invariant (valid UTF-8) means
//! genuinely arbitrary non-UTF-8 bytes can never even be constructed into the
//! `&[String]` this function's signature accepts in the first place — the
//! NUL check here is this function's *own* fail-closed floor for the bytes
//! that *are* representable as a `String` but still cannot cross this
//! specific boundary safely.

use crate::error::CommandError;

use super::remote_shell_escape_invalid;

/// Defensive ceiling on the *encoded* command-line length — no measurement
/// backs this exact number (mirrors `git::exec::GIT_EXEC_OUTPUT_CAP_BYTES`'s
/// own "no measurement yet, purely defensive" precedent, cited verbatim as
/// the model for this constant): a real git invocation's argv (a handful of
/// `-c key=value` overrides, a repository path, a subcommand, and a bounded
/// number of caller-supplied pathspecs/messages this domain's own DTO layer
/// already caps well below this) never plausibly approaches 128 KiB even
/// after every argument roughly doubles in the worst case (a string of
/// nothing but single quotes, each expanding from 1 byte to 4). This exists
/// purely to reject a structurally pathological request before it is ever
/// sent to a live SSH channel, not to model any real per-command budget.
const MAX_ENCODED_COMMAND_LINE_BYTES: usize = 131_072;

/// Encodes `argv` — a real argument-vector array, exactly as it would have
/// been handed to a structured `std::process::Command::args(..)` call — into
/// a single POSIX-shell-safe command-line string: every element
/// single-quoted, space-joined, with any embedded single quote in an element
/// escaped via the standard `'\''` idiom (see the module doc's "Why
/// single-quoting is sufficient" section). Fails closed
/// (`REMOTE_SHELL_ESCAPE_INVALID`) for an empty `argv`, any element
/// containing a NUL byte, or an encoded result exceeding
/// [`MAX_ENCODED_COMMAND_LINE_BYTES`] — never silently truncates or drops an
/// argument.
pub(crate) fn encode_posix_command_line(argv: &[String]) -> Result<String, CommandError> {
    if argv.is_empty() {
        return Err(remote_shell_escape_invalid());
    }
    let mut encoded = String::new();
    for (index, argument) in argv.iter().enumerate() {
        if index > 0 {
            encoded.push(' ');
        }
        encoded.push_str(&encode_single_argument(argument)?);
    }
    if encoded.len() > MAX_ENCODED_COMMAND_LINE_BYTES {
        return Err(remote_shell_escape_invalid());
    }
    Ok(encoded)
}

/// Encodes one argument into a single-quoted POSIX shell token — see the
/// module doc for the full rationale. Every byte of `argument` other than a
/// literal single quote (`'`) is copied through unmodified inside the
/// surrounding quotes; a single quote becomes the four-byte sequence
/// `'\''`. Fails closed for a NUL byte (see the module doc's "NUL bytes are
/// rejected" section).
fn encode_single_argument(argument: &str) -> Result<String, CommandError> {
    if argument.bytes().any(|byte| byte == 0) {
        return Err(remote_shell_escape_invalid());
    }
    let mut encoded = String::with_capacity(argument.len() + 2);
    encoded.push('\'');
    for character in argument.chars() {
        if character == '\'' {
            encoded.push_str("'\\''");
        } else {
            encoded.push(character);
        }
    }
    encoded.push('\'');
    Ok(encoded)
}

#[cfg(test)]
mod tests;

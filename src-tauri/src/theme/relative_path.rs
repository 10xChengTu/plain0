//! Resolves a theme-domain relative path fragment (a `contributes.themes[].path`,
//! an `include` value, or a `tokenColors` string) against a base directory,
//! the way `resources.joinPath(dirname(themeLocation), fragment)` does
//! upstream — except every `.`/`..` segment is walked and bounds-checked
//! ourselves rather than trusted to a URI-joining helper, and every
//! `contributes.themes[].path`/`include`/`tokenColors` fragment in the wild
//! commonly carries a leading `./` (upstream's own `theme-defaults` manifests
//! do this), which [`crate::path_policy::RelativePath::parse_wire`] rejects
//! outright (a bare `.` segment is never valid there). This module is the
//! one place that reconciles the two: it resolves `.`/`..` against `base`
//! itself, then hands the fully-resolved (dot-free) wire string to
//! `RelativePath::parse_wire` for its usual charset/length/Windows-ambiguity
//! checks.
//!
//! Deliberately returns a bare `Result<RelativePath, ()>`: every call site
//! immediately maps a resolution failure to its own domain-specific error
//! code (`THEME_CONTRIBUTION_PATH_INVALID`, `THEME_INCLUDE_INVALID`, ...), so
//! this function does not get to pick one on their behalf.

use std::path::{Component, Path};

use crate::path_policy::RelativePath;

/// Resolves `fragment` (a `/`-separated wire path that may itself contain
/// `.`/`..` segments and an optional leading `./`) relative to `base` (a
/// package-relative directory, e.g. `""` for the package root, or the
/// parent directory of the document that referenced `fragment`).
///
/// A `..` that would walk above `base` (and therefore above the package
/// root, since `base` itself is always package-relative) is rejected — this
/// is the actual security boundary; every other `.`/`..` use is ordinary
/// path algebra.
pub(crate) fn resolve_theme_relative(base: &Path, fragment: &str) -> Result<RelativePath, ()> {
    if fragment.is_empty() {
        return Err(());
    }

    let mut stack: Vec<String> = Vec::new();
    for component in base.components() {
        match component {
            Component::Normal(segment) => {
                stack.push(segment.to_string_lossy().into_owned());
            }
            // `base` is always derived from an already-validated
            // `RelativePath`, whose inner `PathBuf` only ever contains
            // `Normal` components — this arm is unreachable in practice and
            // only guards against a future caller passing something else.
            _ => return Err(()),
        }
    }

    for segment in fragment.split('/') {
        match segment {
            "" => return Err(()),
            "." => {}
            ".." => {
                if stack.pop().is_none() {
                    return Err(());
                }
            }
            other => stack.push(other.to_owned()),
        }
    }

    let joined = stack.join("/");
    RelativePath::parse_wire(&joined).map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::resolve_theme_relative;

    #[test]
    fn resolves_a_leading_dot_slash_against_the_package_root() {
        let resolved = resolve_theme_relative(Path::new(""), "./themes/dark.json")
            .expect("leading ./ resolves");
        assert_eq!(resolved.as_wire(), "themes/dark.json");
    }

    #[test]
    fn resolves_a_bare_relative_fragment_with_no_leading_dot() {
        let resolved = resolve_theme_relative(Path::new(""), "themes/dark.json").expect("resolves");
        assert_eq!(resolved.as_wire(), "themes/dark.json");
    }

    #[test]
    fn resolves_relative_to_a_non_root_base_directory() {
        let resolved = resolve_theme_relative(Path::new("themes"), "./light.json")
            .expect("resolves relative to themes/");
        assert_eq!(resolved.as_wire(), "themes/light.json");
    }

    #[test]
    fn parent_segment_climbs_out_of_the_base_directory_but_not_above_the_root() {
        let resolved = resolve_theme_relative(Path::new("themes"), "../shared/base.json")
            .expect("../ from themes/ lands at the package root");
        assert_eq!(resolved.as_wire(), "shared/base.json");
    }

    #[test]
    fn parent_segment_escaping_the_package_root_is_rejected() {
        resolve_theme_relative(Path::new(""), "../escape.json")
            .expect_err("../ from the package root escapes the package");
        resolve_theme_relative(Path::new("themes"), "../../escape.json")
            .expect_err("two levels of ../ from themes/ escapes the package");
    }

    #[test]
    fn absolute_and_empty_fragments_are_rejected() {
        resolve_theme_relative(Path::new(""), "").expect_err("empty fragment");
        resolve_theme_relative(Path::new(""), "/etc/passwd").expect_err("absolute fragment");
        resolve_theme_relative(Path::new(""), "themes//dark.json")
            .expect_err("empty segment from a doubled slash");
        resolve_theme_relative(Path::new(""), "themes/").expect_err("trailing slash");
    }

    #[test]
    fn backslash_colon_and_nul_are_rejected_by_the_final_relative_path_check() {
        resolve_theme_relative(Path::new(""), "themes\\dark.json").expect_err("backslash");
        resolve_theme_relative(Path::new(""), "C:/evil.dll").expect_err("drive letter/colon");
        resolve_theme_relative(Path::new(""), "themes/da\0rk.json").expect_err("NUL byte");
    }
}

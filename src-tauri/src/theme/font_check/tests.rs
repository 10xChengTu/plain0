use super::{
    is_known_font_format, validate_font_bytes, OPENTYPE_MAGIC, TRUETYPE_COLLECTION_MAGIC,
    TRUETYPE_SFNT_MAGIC, TRUETYPE_TRUE_MAGIC, WOFF2_MAGIC, WOFF_MAGIC,
};

#[test]
fn known_format_closed_set_matches_upstream_font_format_regex() {
    for format in [
        "woff",
        "woff2",
        "truetype",
        "opentype",
        "embedded-opentype",
        "svg",
    ] {
        assert!(is_known_font_format(format), "{format} must be recognized");
    }
    for format in ["ttf", "WOFF", "", "eot", "collection", "woff3"] {
        assert!(
            !is_known_font_format(format),
            "{format} must not be recognized"
        );
    }
}

#[test]
fn each_real_magic_signature_validates_against_its_declared_format() {
    validate_font_bytes("woff", WOFF_MAGIC).expect("woff magic accepted");
    validate_font_bytes("woff2", WOFF2_MAGIC).expect("woff2 magic accepted");
    validate_font_bytes("truetype", TRUETYPE_SFNT_MAGIC).expect("sfnt v1 magic accepted");
    validate_font_bytes("truetype", TRUETYPE_TRUE_MAGIC).expect("legacy true magic accepted");
    validate_font_bytes("truetype", TRUETYPE_COLLECTION_MAGIC).expect("ttcf magic accepted");
    validate_font_bytes("opentype", OPENTYPE_MAGIC).expect("OTTO magic accepted");
}

#[test]
fn a_forged_extension_whose_content_is_actually_something_else_is_rejected() {
    let error = validate_font_bytes("woff", b"<svg></svg>").unwrap_err();
    assert_eq!(error.code(), "THEME_FONT_INVALID");
}

#[test]
fn format_and_magic_mismatch_across_real_formats_is_rejected() {
    let error = validate_font_bytes("opentype", WOFF_MAGIC).unwrap_err();
    assert_eq!(error.code(), "THEME_FONT_INVALID");
    let error = validate_font_bytes("woff", WOFF2_MAGIC).unwrap_err();
    assert_eq!(error.code(), "THEME_FONT_INVALID");
}

#[test]
fn a_truncated_file_with_no_recognizable_magic_is_rejected() {
    let error = validate_font_bytes("truetype", b"\x00\x01").unwrap_err();
    assert_eq!(error.code(), "THEME_FONT_INVALID");
    let error = validate_font_bytes("woff", b"").unwrap_err();
    assert_eq!(error.code(), "THEME_FONT_INVALID");
}

#[test]
fn embedded_opentype_has_no_recognized_magic_and_always_rejects() {
    // Deliberate: no real EOT signature exists in this closed set at all —
    // see this module's own doc comment for why.
    let error = validate_font_bytes("embedded-opentype", b"anything at all").unwrap_err();
    assert_eq!(error.code(), "THEME_FONT_INVALID");
}

#[test]
fn svg_format_dispatches_to_the_svg_sanitizer_rather_than_a_magic_check() {
    validate_font_bytes(
        "svg",
        br#"<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1"/></svg>"#,
    )
    .expect("a safe SVG glyph source validates");

    let error = validate_font_bytes("svg", b"<svg><script>alert(1)</script></svg>").unwrap_err();
    assert_eq!(error.code(), "THEME_SVG_UNSAFE");
}

#[test]
fn an_unrecognized_format_defensively_rejects_even_with_valid_bytes() {
    let error = validate_font_bytes("ttf", WOFF_MAGIC).unwrap_err();
    assert_eq!(error.code(), "THEME_FONT_INVALID");
}

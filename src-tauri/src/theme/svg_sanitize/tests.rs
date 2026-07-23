use super::sanitize_svg_bytes;

fn assert_unsafe(svg: &str) {
    let error = sanitize_svg_bytes(svg.as_bytes())
        .err()
        .unwrap_or_else(|| panic!("expected unsafe SVG to be rejected: {svg}"));
    assert_eq!(error.code(), "THEME_SVG_UNSAFE");
}

fn assert_safe(svg: &str) {
    sanitize_svg_bytes(svg.as_bytes())
        .unwrap_or_else(|error| panic!("expected safe SVG to pass ({}): {svg}", error.code()));
}

#[test]
fn rejects_a_script_element_including_namespaced_and_closing_and_uppercase_spellings() {
    assert_unsafe(r#"<svg><script>alert(1)</script></svg>"#);
    assert_unsafe(r#"<svg><SVG:SCRIPT>alert(1)</SVG:SCRIPT></svg>"#);
    assert_unsafe(r#"<svg><script src="evil.js"/></svg>"#);
    assert_unsafe(r#"<svg xmlns:evil="x"><evil:script>1</evil:script></svg>"#);
}

#[test]
fn rejects_event_handler_attributes_including_whitespace_variants() {
    assert_unsafe(r#"<svg onload="alert(1)"></svg>"#);
    assert_unsafe(r#"<svg><rect onclick ="alert(1)"/></svg>"#);
    assert_unsafe("<svg><rect onmouseover\t=\"alert(1)\"/></svg>");
}

#[test]
fn does_not_false_positive_on_ordinary_words_containing_on() {
    assert_safe(r#"<svg><title>A beacon icon, in action</title><path d="M1 1"/></svg>"#);
}

#[test]
fn rejects_foreign_object() {
    assert_unsafe(
        r#"<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml">x</body></foreignObject></svg>"#,
    );
}

#[test]
fn rejects_doctype_declarations() {
    assert_unsafe(
        r#"<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg></svg>"#,
    );
}

#[test]
fn rejects_entity_declarations_even_without_a_full_doctype_wrapper() {
    assert_unsafe(r#"<!ENTITY xxe SYSTEM "file:///etc/passwd"><svg>&xxe;</svg>"#);
}

#[test]
fn rejects_external_href_and_xlink_href_references() {
    assert_unsafe(r#"<svg><image href="http://evil.example/x.png"/></svg>"#);
    assert_unsafe(r#"<svg><image href="https://evil.example/x.png"/></svg>"#);
    assert_unsafe(r#"<svg><image href="//evil.example/x.png"/></svg>"#);
    assert_unsafe(r#"<svg><a xlink:href="javascript:alert(1)">x</a></svg>"#);
    assert_unsafe(r#"<svg><image xlink:href="data:image/png;base64,AAAA"/></svg>"#);
    assert_unsafe(r#"<svg><image href="data:text/html,<script>1</script>"/></svg>"#);
}

#[test]
fn rejects_style_import_and_external_url_references() {
    assert_unsafe(r#"<svg><style>@import url(http://evil.example/x.css);</style></svg>"#);
    assert_unsafe(r#"<svg><rect style="fill:url(http://evil.example/x.png)"/></svg>"#);
    assert_unsafe(r#"<svg><rect fill="url(https://evil.example/x.png)"/></svg>"#);
}

#[test]
fn allows_a_plain_path_only_svg() {
    assert_safe(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M1 1h14v14H1z"/></svg>"#,
    );
}

#[test]
fn allows_a_same_document_use_and_fragment_href() {
    assert_safe(r##"<svg><defs><g id="icon"></g></defs><use href="#icon"/></svg>"##);
    assert_safe(r##"<svg><use xlink:href="#icon"/></svg>"##);
}

#[test]
fn allows_an_inline_style_attribute_with_a_plain_fill_color() {
    assert_safe(r#"<svg><rect style="fill:#ff0000;stroke:none"/></svg>"#);
}

#[test]
fn allows_a_same_document_gradient_url_reference() {
    assert_safe(
        r#"<svg><defs><linearGradient id="gradient1"/></defs><rect fill="url(#gradient1)"/></svg>"#,
    );
}

#[test]
fn rejects_non_utf8_bytes() {
    let error = sanitize_svg_bytes(&[0xff, 0xfe, 0x00]).unwrap_err();
    assert_eq!(error.code(), "THEME_SVG_UNSAFE");
}

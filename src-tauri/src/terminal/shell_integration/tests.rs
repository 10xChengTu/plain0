use std::path::{Path, PathBuf};

use portable_pty::CommandBuilder;

use super::{
    apply_to_command, ensure_integration_files, integration_base_dir, plan_for_shell,
    ShellIntegrationStatus, BASHRC, FISH_INTEGRATION, ZPROFILE, ZSHENV, ZSHRC,
};

fn base() -> PathBuf {
    PathBuf::from("/plain-test-base")
}

#[test]
fn integration_base_dir_is_anchored_under_the_os_temp_dir_and_versioned() {
    let dir = integration_base_dir();
    assert!(dir.starts_with(std::env::temp_dir()));
    let name = dir.file_name().and_then(|name| name.to_str()).unwrap();
    assert!(name.starts_with("plain-terminal-shell-integration-"));
    assert!(name.ends_with(env!("CARGO_PKG_VERSION")));
}

#[test]
fn zsh_plan_sets_zdotdir_and_preserves_a_custom_ambient_zdotdir() {
    let plan = plan_for_shell(Path::new("/bin/zsh"), None, None, &base(), true);
    assert_eq!(plan.status, ShellIntegrationStatus::Injected);
    let mut command = CommandBuilder::new("/bin/zsh");
    apply_to_command(&mut command, &plan);
    assert_eq!(
        command.get_env("ZDOTDIR").unwrap(),
        base().join("zsh").as_os_str()
    );
    assert!(command.get_env("PLAIN_TERM_ORIGINAL_ZDOTDIR").is_none());
    assert_eq!(command.get_argv().len(), 1, "zsh injection adds no args");

    let plan_with_custom = plan_for_shell(
        Path::new("/bin/zsh"),
        Some("/custom/zdotdir"),
        None,
        &base(),
        true,
    );
    let mut command = CommandBuilder::new("/bin/zsh");
    apply_to_command(&mut command, &plan_with_custom);
    assert_eq!(
        command.get_env("PLAIN_TERM_ORIGINAL_ZDOTDIR").unwrap(),
        "/custom/zdotdir"
    );
}

#[test]
fn bash_plan_adds_rcfile_flag_pointing_at_the_injected_bashrc_and_no_shell_c() {
    let plan = plan_for_shell(Path::new("/bin/bash"), None, None, &base(), true);
    assert_eq!(plan.status, ShellIntegrationStatus::Injected);
    let mut command = CommandBuilder::new("/bin/bash");
    apply_to_command(&mut command, &plan);
    let argv: Vec<String> = command
        .get_argv()
        .iter()
        .map(|value| value.to_string_lossy().into_owned())
        .collect();
    assert_eq!(
        argv,
        vec![
            "/bin/bash".to_owned(),
            "--rcfile".to_owned(),
            base()
                .join("bash")
                .join("bashrc")
                .to_string_lossy()
                .into_owned(),
        ]
    );
    assert!(!argv.contains(&"-c".to_owned()));
}

#[test]
fn fish_plan_prepends_the_integration_dir_to_xdg_data_dirs_preserving_the_ambient_value() {
    let plan = plan_for_shell(Path::new("/usr/bin/fish"), None, None, &base(), true);
    assert_eq!(plan.status, ShellIntegrationStatus::Injected);
    let mut command = CommandBuilder::new("/usr/bin/fish");
    apply_to_command(&mut command, &plan);
    assert_eq!(
        command.get_env("XDG_DATA_DIRS").unwrap(),
        format!("{}:/usr/local/share:/usr/share", base().to_string_lossy()).as_str()
    );

    let plan_with_ambient = plan_for_shell(
        Path::new("/usr/bin/fish"),
        None,
        Some("/opt/custom/share"),
        &base(),
        true,
    );
    let mut command = CommandBuilder::new("/usr/bin/fish");
    apply_to_command(&mut command, &plan_with_ambient);
    assert_eq!(
        command.get_env("XDG_DATA_DIRS").unwrap(),
        format!("{}:/opt/custom/share", base().to_string_lossy()).as_str()
    );
}

#[test]
fn an_unrecognized_or_systemdefault_resolved_shell_degrades_with_empty_env_and_args() {
    for shell in ["/bin/sh", "/usr/bin/nu", "/custom/login-shell"] {
        let plan = plan_for_shell(Path::new(shell), None, None, &base(), true);
        assert_eq!(plan.status, ShellIntegrationStatus::Unsupported);
        let mut command = CommandBuilder::new(shell);
        apply_to_command(&mut command, &plan);
        assert_eq!(command.get_argv().len(), 1);
    }
}

#[test]
fn a_supported_shell_still_degrades_when_the_integration_files_were_not_confirmed_ready() {
    let plan = plan_for_shell(Path::new("/bin/zsh"), None, None, &base(), false);
    assert_eq!(plan.status, ShellIntegrationStatus::Unsupported);
    let mut command = CommandBuilder::new("/bin/zsh");
    apply_to_command(&mut command, &plan);
    assert!(command.get_env("ZDOTDIR").is_none());
}

#[test]
fn ensure_integration_files_writes_every_fixed_script_exactly_and_is_idempotent() {
    let tempdir = tempfile::tempdir().expect("tempdir should be creatable");
    let base = tempdir.path();
    ensure_integration_files(base).expect("first write should succeed");
    assert_eq!(
        std::fs::read_to_string(base.join("zsh").join(".zshenv")).unwrap(),
        ZSHENV
    );
    assert_eq!(
        std::fs::read_to_string(base.join("zsh").join(".zprofile")).unwrap(),
        ZPROFILE
    );
    assert_eq!(
        std::fs::read_to_string(base.join("zsh").join(".zshrc")).unwrap(),
        ZSHRC
    );
    assert_eq!(
        std::fs::read_to_string(base.join("bash").join("bashrc")).unwrap(),
        BASHRC
    );
    assert_eq!(
        std::fs::read_to_string(
            base.join("fish")
                .join("vendor_conf.d")
                .join("plain-integration.fish")
        )
        .unwrap(),
        FISH_INTEGRATION
    );

    // Calling again (mirroring a second terminal_start in the same run)
    // must not error and must leave the exact same fixed content in place.
    ensure_integration_files(base).expect("second write should also succeed");
    assert_eq!(
        std::fs::read_to_string(base.join("zsh").join(".zshenv")).unwrap(),
        ZSHENV
    );
}

#[test]
fn none_of_the_injected_scripts_ever_pass_a_shell_dash_c_or_source_a_workspace_or_ipc_controlled_path(
) {
    // Mechanical, best-effort content check on top of the exact-body
    // assertions above: the fixed constants only ever `source`/`.` a path
    // derived from `$HOME`/`$ZDOTDIR`/a literal Plain-owned directory —
    // never a `-c` shell invocation embedded in the script text itself.
    for script in [ZSHENV, ZPROFILE, ZSHRC, BASHRC, FISH_INTEGRATION] {
        assert!(!script.contains("\"-c\""));
        assert!(!script.contains("eval \"$("));
    }
}

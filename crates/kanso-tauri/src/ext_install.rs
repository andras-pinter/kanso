use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use thiserror::Error;

const VERSION_FILE: &str = ".kanso-ext-version";
const SETTINGS_FILE: &str = "settings.json";
const RESOURCE_EXTENSIONS: &str = "extensions";
const CLI_REL: &str = ".copilot/extensions/kanso";
const MCP_REL: &str = ".kanso/mcp";
const NODE_REQUIRED: u64 = 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallTarget {
    Cli,
    Mcp,
}

impl InstallTarget {
    pub fn label(self) -> &'static str {
        match self {
            Self::Cli => "Copilot CLI extension",
            Self::Mcp => "MCP server",
        }
    }

    fn source_dir(self) -> &'static str {
        match self {
            Self::Cli => "kanso",
            Self::Mcp => "kanso-mcp",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NodeCheck {
    Present(u64),
    Missing,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct CliExtSettings {
    #[serde(default)]
    pub cli_ext_consent: bool,
    #[serde(default)]
    pub cli_ext_consent_dismissed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct CliExtStatus {
    pub show_consent: bool,
    pub bundled_version: String,
    pub cli_installed_version: Option<String>,
    pub consent: bool,
    pub dismissed: bool,
}

#[derive(Debug, Error)]
pub enum ExtInstallError {
    #[error("{label} target is a dev symlink at {path}. Run `just uninstall-ext` first or use the tray menu.")]
    DevSymlink { label: &'static str, path: PathBuf },
    #[error("Node 20+ required for the Copilot CLI extension and MCP server. Install from https://nodejs.org/, then re-run install from the tray.")]
    NodeMissing,
    #[error("Node 20+ required for the Copilot CLI extension and MCP server. Found Node {found}. Install from https://nodejs.org/, then re-run install from the tray.")]
    NodeTooOld { found: u64 },
    #[error("bundled extension resources are missing at {0}")]
    BundleMissing(PathBuf),
    #[error("invalid node version output: {0}")]
    InvalidNodeVersion(String),
    #[error("{op} {path}: {source}")]
    Io {
        op: &'static str,
        path: PathBuf,
        source: io::Error,
    },
    #[error("read settings {path}: {source}")]
    SettingsRead {
        path: PathBuf,
        source: serde_json::Error,
    },
    #[error("resolve app path {name}: {source}")]
    AppPath {
        name: &'static str,
        source: tauri::Error,
    },
}

impl ExtInstallError {
    pub fn user_message(&self) -> String {
        self.to_string()
    }
}

#[derive(Debug, Clone)]
pub struct InstallContext {
    bundle_root: PathBuf,
    settings_path: PathBuf,
    cli_target: PathBuf,
    mcp_target: PathBuf,
}

impl InstallContext {
    pub fn from_app(app: &AppHandle) -> Result<Self, ExtInstallError> {
        let resource_dir =
            app.path()
                .resource_dir()
                .map_err(|source| ExtInstallError::AppPath {
                    name: "resource_dir",
                    source,
                })?;
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|source| ExtInstallError::AppPath {
                name: "app_data_dir",
                source,
            })?;
        let home = app
            .path()
            .home_dir()
            .map_err(|source| ExtInstallError::AppPath {
                name: "home_dir",
                source,
            })?;

        Ok(Self::new(
            resource_dir.join(RESOURCE_EXTENSIONS),
            home,
            data_dir,
        ))
    }

    fn new(bundle_root: PathBuf, home: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            bundle_root,
            settings_path: data_dir.join(SETTINGS_FILE),
            cli_target: home.join(CLI_REL),
            mcp_target: home.join(MCP_REL),
        }
    }

    fn target_path(&self, target: InstallTarget) -> &Path {
        match target {
            InstallTarget::Cli => &self.cli_target,
            InstallTarget::Mcp => &self.mcp_target,
        }
    }
}

pub fn cli_ext_status(app: &AppHandle) -> Result<CliExtStatus, ExtInstallError> {
    let ctx = InstallContext::from_app(app)?;
    status(&ctx)
}

pub fn set_cli_ext_consent(
    app: &AppHandle,
    install: bool,
) -> Result<CliExtStatus, ExtInstallError> {
    let ctx = InstallContext::from_app(app)?;
    let mut settings = load_settings(&ctx)?;
    if install {
        settings.cli_ext_consent = true;
        settings.cli_ext_consent_dismissed = false;
    } else {
        settings.cli_ext_consent = false;
        settings.cli_ext_consent_dismissed = true;
    }
    save_settings(&ctx, &settings)?;

    if install {
        install_all(&ctx, system_node_check()?)?;
    }

    status(&ctx)
}

pub fn auto_upgrade_if_needed(app: &AppHandle) -> Result<(), ExtInstallError> {
    let ctx = InstallContext::from_app(app)?;
    auto_upgrade(&ctx, system_node_check()?)
}

pub fn install_from_app(app: &AppHandle, target: InstallTarget) -> Result<(), ExtInstallError> {
    let ctx = InstallContext::from_app(app)?;
    install_target(&ctx, target, system_node_check()?)
}

pub fn uninstall_from_app(app: &AppHandle, target: InstallTarget) -> Result<(), ExtInstallError> {
    let ctx = InstallContext::from_app(app)?;
    uninstall_target(&ctx, target)
}

fn auto_upgrade(ctx: &InstallContext, node: NodeCheck) -> Result<(), ExtInstallError> {
    if is_symlink(&ctx.cli_target)? || is_symlink(&ctx.mcp_target)? {
        return Ok(());
    }

    let bundled = bundled_version(ctx)?;
    let installed = installed_version(&ctx.cli_target)?;
    let settings = load_settings(ctx)?;
    let should_install = match installed {
        Some(version) => version != bundled,
        None => settings.cli_ext_consent,
    };

    if should_install {
        install_all(ctx, node)?;
    }
    Ok(())
}

fn status(ctx: &InstallContext) -> Result<CliExtStatus, ExtInstallError> {
    let bundled_version = bundled_version(ctx)?;
    let cli_installed_version = installed_version(&ctx.cli_target)?;
    let settings = load_settings(ctx)?;
    let show_consent = cli_installed_version.is_none()
        && !settings.cli_ext_consent
        && !settings.cli_ext_consent_dismissed;

    Ok(CliExtStatus {
        show_consent,
        bundled_version,
        cli_installed_version,
        consent: settings.cli_ext_consent,
        dismissed: settings.cli_ext_consent_dismissed,
    })
}

fn install_all(ctx: &InstallContext, node: NodeCheck) -> Result<(), ExtInstallError> {
    ensure_node(node)?;
    install_target_without_node_check(ctx, InstallTarget::Cli)?;
    install_target_without_node_check(ctx, InstallTarget::Mcp)
}

fn install_target(
    ctx: &InstallContext,
    target: InstallTarget,
    node: NodeCheck,
) -> Result<(), ExtInstallError> {
    ensure_node(node)?;
    install_target_without_node_check(ctx, target)
}

fn install_target_without_node_check(
    ctx: &InstallContext,
    target: InstallTarget,
) -> Result<(), ExtInstallError> {
    let target_path = ctx.target_path(target);
    ensure_not_symlink(target_path, target.label())?;

    let src = ctx.bundle_root.join(target.source_dir());
    if !src.is_dir() {
        return Err(ExtInstallError::BundleMissing(src));
    }

    let shared = ctx.bundle_root.join("_shared/kanso-client");
    if !shared.is_dir() {
        return Err(ExtInstallError::BundleMissing(shared));
    }

    let version = bundled_version(ctx)?;
    let new_path = sibling_with_suffix(target_path, "new");
    let old_path = sibling_with_suffix(target_path, "old");

    remove_path_if_exists(&new_path)?;
    remove_path_if_exists(&old_path)?;
    create_dir_all(&new_path)?;
    copy_dir_contents(&src, &new_path)?;
    copy_dir_contents(&shared, &new_path.join("_shared/kanso-client"))?;
    copy_dir_contents(&shared, &new_path.join("node_modules/@kanso/client"))?;
    write_text(&new_path.join(VERSION_FILE), &format!("{version}\n"))?;

    swap_install(&new_path, target_path, &old_path)?;
    Ok(())
}

fn uninstall_target(ctx: &InstallContext, target: InstallTarget) -> Result<(), ExtInstallError> {
    let target_path = ctx.target_path(target);
    ensure_not_symlink(target_path, target.label())?;
    remove_path_if_exists(target_path)
}

fn swap_install(new_path: &Path, target: &Path, old_path: &Path) -> Result<(), ExtInstallError> {
    if target.exists() {
        rename_path(target, old_path)?;
    }

    match rename_path(new_path, target) {
        Ok(()) => remove_path_if_exists(old_path),
        Err(e) => {
            if old_path.exists() && !target.exists() {
                let _restore = fs::rename(old_path, target);
            }
            Err(e)
        }
    }
}

fn bundled_version(ctx: &InstallContext) -> Result<String, ExtInstallError> {
    read_trimmed(&ctx.bundle_root.join(VERSION_FILE))
}

fn installed_version(target: &Path) -> Result<Option<String>, ExtInstallError> {
    let version_path = target.join(VERSION_FILE);
    if !version_path.exists() {
        return Ok(None);
    }
    Ok(Some(read_trimmed(&version_path)?))
}

fn read_trimmed(path: &Path) -> Result<String, ExtInstallError> {
    let text = fs::read_to_string(path).map_err(|source| ExtInstallError::Io {
        op: "read",
        path: path.to_path_buf(),
        source,
    })?;
    Ok(text.trim().to_string())
}

fn load_settings(ctx: &InstallContext) -> Result<CliExtSettings, ExtInstallError> {
    if !ctx.settings_path.exists() {
        return Ok(CliExtSettings::default());
    }

    let text = fs::read_to_string(&ctx.settings_path).map_err(|source| ExtInstallError::Io {
        op: "read",
        path: ctx.settings_path.clone(),
        source,
    })?;
    serde_json::from_str(&text).map_err(|source| ExtInstallError::SettingsRead {
        path: ctx.settings_path.clone(),
        source,
    })
}

fn save_settings(ctx: &InstallContext, settings: &CliExtSettings) -> Result<(), ExtInstallError> {
    if let Some(parent) = ctx.settings_path.parent() {
        create_dir_all(parent)?;
    }

    let text =
        serde_json::to_string_pretty(settings).map_err(|source| ExtInstallError::SettingsRead {
            path: ctx.settings_path.clone(),
            source,
        })?;
    let tmp = ctx.settings_path.with_extension("json.tmp");
    write_text(&tmp, &text)?;
    rename_path(&tmp, &ctx.settings_path)
}

fn system_node_check() -> Result<NodeCheck, ExtInstallError> {
    let output = match Command::new("node").arg("--version").output() {
        Ok(output) => output,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(NodeCheck::Missing),
        Err(source) => {
            return Err(ExtInstallError::Io {
                op: "run node --version",
                path: PathBuf::from("node"),
                source,
            });
        }
    };

    if !output.status.success() {
        return Ok(NodeCheck::Missing);
    }

    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_node_major(&raw).map(NodeCheck::Present)
}

fn parse_node_major(raw: &str) -> Result<u64, ExtInstallError> {
    let version = raw.trim().trim_start_matches('v');
    let Some(major) = version.split('.').next() else {
        return Err(ExtInstallError::InvalidNodeVersion(raw.to_string()));
    };
    major
        .parse::<u64>()
        .map_err(|_| ExtInstallError::InvalidNodeVersion(raw.to_string()))
}

fn ensure_node(node: NodeCheck) -> Result<(), ExtInstallError> {
    match node {
        NodeCheck::Present(major) if major >= NODE_REQUIRED => Ok(()),
        NodeCheck::Present(found) => Err(ExtInstallError::NodeTooOld { found }),
        NodeCheck::Missing => Err(ExtInstallError::NodeMissing),
    }
}

fn ensure_not_symlink(path: &Path, label: &'static str) -> Result<(), ExtInstallError> {
    if is_symlink(path)? {
        return Err(ExtInstallError::DevSymlink {
            label,
            path: path.to_path_buf(),
        });
    }
    Ok(())
}

fn is_symlink(path: &Path) -> Result<bool, ExtInstallError> {
    match fs::symlink_metadata(path) {
        Ok(meta) => Ok(meta.file_type().is_symlink()),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(source) => Err(ExtInstallError::Io {
            op: "metadata",
            path: path.to_path_buf(),
            source,
        }),
    }
}

fn copy_dir_contents(src: &Path, dst: &Path) -> Result<(), ExtInstallError> {
    create_dir_all(dst)?;
    for entry in fs::read_dir(src).map_err(|source| ExtInstallError::Io {
        op: "read_dir",
        path: src.to_path_buf(),
        source,
    })? {
        let entry = entry.map_err(|source| ExtInstallError::Io {
            op: "read_dir entry",
            path: src.to_path_buf(),
            source,
        })?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        let kind = entry.file_type().map_err(|source| ExtInstallError::Io {
            op: "file_type",
            path: path.clone(),
            source,
        })?;

        if kind.is_symlink() {
            return Err(ExtInstallError::Io {
                op: "copy symlink",
                path,
                source: io::Error::new(io::ErrorKind::InvalidInput, "symlinks are not bundled"),
            });
        }

        if kind.is_dir() {
            copy_dir_contents(&path, &target)?;
        } else {
            copy_file(&path, &target)?;
        }
    }
    Ok(())
}

fn copy_file(src: &Path, dst: &Path) -> Result<(), ExtInstallError> {
    if let Some(parent) = dst.parent() {
        create_dir_all(parent)?;
    }
    fs::copy(src, dst).map_err(|source| ExtInstallError::Io {
        op: "copy",
        path: src.to_path_buf(),
        source,
    })?;
    let permissions = fs::metadata(src)
        .map_err(|source| ExtInstallError::Io {
            op: "metadata",
            path: src.to_path_buf(),
            source,
        })?
        .permissions();
    fs::set_permissions(dst, permissions).map_err(|source| ExtInstallError::Io {
        op: "set_permissions",
        path: dst.to_path_buf(),
        source,
    })
}

fn write_text(path: &Path, text: &str) -> Result<(), ExtInstallError> {
    if let Some(parent) = path.parent() {
        create_dir_all(parent)?;
    }
    fs::write(path, text).map_err(|source| ExtInstallError::Io {
        op: "write",
        path: path.to_path_buf(),
        source,
    })
}

fn create_dir_all(path: &Path) -> Result<(), ExtInstallError> {
    fs::create_dir_all(path).map_err(|source| ExtInstallError::Io {
        op: "create_dir_all",
        path: path.to_path_buf(),
        source,
    })
}

fn rename_path(from: &Path, to: &Path) -> Result<(), ExtInstallError> {
    if let Some(parent) = to.parent() {
        create_dir_all(parent)?;
    }
    fs::rename(from, to).map_err(|source| ExtInstallError::Io {
        op: "rename",
        path: from.to_path_buf(),
        source,
    })
}

fn remove_path_if_exists(path: &Path) -> Result<(), ExtInstallError> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => fs::remove_dir_all(path)
            .map_err(|source| ExtInstallError::Io {
                op: "remove_dir_all",
                path: path.to_path_buf(),
                source,
            }),
        Ok(_) => fs::remove_file(path).map_err(|source| ExtInstallError::Io {
            op: "remove_file",
            path: path.to_path_buf(),
            source,
        }),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(source) => Err(ExtInstallError::Io {
            op: "metadata",
            path: path.to_path_buf(),
            source,
        }),
    }
}

fn sibling_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path
        .file_name()
        .map(OsString::from)
        .unwrap_or_else(|| OsString::from("kanso"));
    name.push(format!(".{suffix}"));
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context(version: &str) -> Result<(tempfile::TempDir, InstallContext), ExtInstallError> {
        let dir = tempfile::tempdir().map_err(|source| ExtInstallError::Io {
            op: "tempdir",
            path: PathBuf::from("tempdir"),
            source,
        })?;
        let bundle = dir.path().join("bundle/extensions");
        write_fixture_bundle(&bundle, version, "initial")?;
        let ctx = InstallContext::new(bundle, dir.path().join("home"), dir.path().join("data"));
        Ok((dir, ctx))
    }

    fn write_fixture_bundle(
        root: &Path,
        version: &str,
        marker: &str,
    ) -> Result<(), ExtInstallError> {
        write_text(&root.join(VERSION_FILE), &format!("{version}\n"))?;
        write_text(&root.join("kanso/package.json"), "{}")?;
        write_text(&root.join("kanso/extension.mjs"), marker)?;
        write_text(&root.join("kanso-mcp/package.json"), "{}")?;
        write_text(&root.join("kanso-mcp/bin/kanso-mcp.mjs"), marker)?;
        write_text(&root.join("_shared/kanso-client/package.json"), "{}")?;
        write_text(&root.join("_shared/kanso-client/index.mjs"), marker)
    }

    #[test]
    fn fresh_install_copies_cli_mcp_shared_and_versions() -> Result<(), ExtInstallError> {
        let (_dir, ctx) = context("1.0.0")?;

        install_all(&ctx, NodeCheck::Present(20))?;

        assert_eq!(read_trimmed(&ctx.cli_target.join(VERSION_FILE))?, "1.0.0");
        assert_eq!(read_trimmed(&ctx.mcp_target.join(VERSION_FILE))?, "1.0.0");
        assert!(ctx.cli_target.join("extension.mjs").is_file());
        assert!(ctx
            .cli_target
            .join("_shared/kanso-client/index.mjs")
            .is_file());
        assert!(ctx
            .cli_target
            .join("node_modules/@kanso/client/index.mjs")
            .is_file());
        assert!(ctx.mcp_target.join("bin/kanso-mcp.mjs").is_file());
        assert!(ctx
            .mcp_target
            .join("_shared/kanso-client/index.mjs")
            .is_file());
        assert!(ctx
            .mcp_target
            .join("node_modules/@kanso/client/index.mjs")
            .is_file());
        Ok(())
    }

    #[test]
    fn reinstall_is_idempotent() -> Result<(), ExtInstallError> {
        let (_dir, ctx) = context("1.0.0")?;

        install_all(&ctx, NodeCheck::Present(20))?;
        install_all(&ctx, NodeCheck::Present(20))?;

        assert_eq!(
            read_trimmed(&ctx.cli_target.join("extension.mjs"))?,
            "initial"
        );
        assert!(!sibling_with_suffix(&ctx.cli_target, "new").exists());
        assert!(!sibling_with_suffix(&ctx.cli_target, "old").exists());
        Ok(())
    }

    #[test]
    fn version_bump_auto_upgrade_reinstalls() -> Result<(), ExtInstallError> {
        let (_dir, ctx) = context("1.0.0")?;
        install_all(&ctx, NodeCheck::Present(20))?;
        write_fixture_bundle(&ctx.bundle_root, "2.0.0", "upgraded")?;

        auto_upgrade(&ctx, NodeCheck::Present(20))?;

        assert_eq!(read_trimmed(&ctx.cli_target.join(VERSION_FILE))?, "2.0.0");
        assert_eq!(
            read_trimmed(&ctx.cli_target.join("extension.mjs"))?,
            "upgraded"
        );
        Ok(())
    }

    #[test]
    #[cfg(unix)]
    fn dev_symlink_refuses_install() -> Result<(), ExtInstallError> {
        use std::os::unix::fs as unix_fs;

        let dir = tempfile::tempdir().map_err(|source| ExtInstallError::Io {
            op: "tempdir",
            path: PathBuf::from("tempdir"),
            source,
        })?;
        let ctx = InstallContext::new(
            dir.path().join("bundle/extensions"),
            dir.path().join("home"),
            dir.path().join("data"),
        );
        write_fixture_bundle(&ctx.bundle_root, "1.0.0", "initial")?;
        create_dir_all(ctx.cli_target.parent().unwrap_or_else(|| dir.path()))?;
        unix_fs::symlink(dir.path().join("dev-ext"), &ctx.cli_target).map_err(|source| {
            ExtInstallError::Io {
                op: "symlink",
                path: ctx.cli_target.clone(),
                source,
            }
        })?;

        let err = install_all(&ctx, NodeCheck::Present(20)).err();

        assert!(matches!(err, Some(ExtInstallError::DevSymlink { .. })));
        Ok(())
    }

    #[test]
    fn missing_node_fails_without_touching_install() -> Result<(), ExtInstallError> {
        let (_dir, ctx) = context("1.0.0")?;

        let err = install_all(&ctx, NodeCheck::Missing).err();

        assert!(matches!(err, Some(ExtInstallError::NodeMissing)));
        assert!(!ctx.cli_target.exists());
        assert!(!ctx.mcp_target.exists());
        Ok(())
    }

    #[test]
    fn parse_node_major_accepts_v_prefix() -> Result<(), ExtInstallError> {
        assert_eq!(parse_node_major("v20.11.1")?, 20);
        assert_eq!(parse_node_major("22.0.0")?, 22);
        Ok(())
    }
}

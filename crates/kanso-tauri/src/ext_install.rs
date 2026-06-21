use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use thiserror::Error;
use wait_timeout::ChildExt;

const VERSION_FILE: &str = ".kanso-ext-version";
const SETTINGS_FILE: &str = "settings.json";
const RESOURCE_EXTENSIONS: &str = "extensions";
const CLI_REL: &str = ".copilot/extensions/kanso";
const MCP_REL: &str = ".kanso/mcp";
const NODE_REQUIRED: u64 = 20;
const NODE_TIMEOUT: Duration = Duration::from_secs(3);
static INSTALL_MUTEX: Mutex<()> = Mutex::new(());

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
    #[error("bundled extension resources are invalid: {0}")]
    BundleInvalid(String),
    #[error("another install is already in progress, try again in a moment")]
    InstallBusy,
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
    lock_path: PathBuf,
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
            lock_path: home.join(".kanso/.install.lock"),
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
    recover_install_state(&ctx)?;
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
    with_install_lock(ctx, || {
        if is_symlink(&ctx.cli_target)? || is_symlink(&ctx.mcp_target)? {
            return Ok(());
        }

        let bundled = bundled_version(ctx)?;
        let settings = load_settings(ctx)?;
        let cli_needs_install =
            target_needs_install(&ctx.cli_target, &bundled, settings.cli_ext_consent)?;
        let mcp_needs_install =
            target_needs_install(&ctx.mcp_target, &bundled, settings.cli_ext_consent)?;

        if cli_needs_install || mcp_needs_install {
            ensure_node(node)?;
        }
        if cli_needs_install {
            install_target_without_node_check(ctx, InstallTarget::Cli)?;
        }
        if mcp_needs_install {
            install_target_without_node_check(ctx, InstallTarget::Mcp)?;
        }
        Ok(())
    })
}

fn recover_install_state(ctx: &InstallContext) -> Result<(), ExtInstallError> {
    with_install_lock(ctx, || recover_installs(ctx))
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
    with_install_lock(ctx, || {
        ensure_node(node)?;
        install_target_without_node_check(ctx, InstallTarget::Cli)?;
        install_target_without_node_check(ctx, InstallTarget::Mcp)
    })
}

fn install_target(
    ctx: &InstallContext,
    target: InstallTarget,
    node: NodeCheck,
) -> Result<(), ExtInstallError> {
    with_install_lock(ctx, || {
        ensure_node(node)?;
        install_target_without_node_check(ctx, target)
    })
}

fn install_target_without_node_check(
    ctx: &InstallContext,
    target: InstallTarget,
) -> Result<(), ExtInstallError> {
    let target_path = ctx.target_path(target);
    ensure_not_symlink(target_path, target.label())?;
    validate_bundle(ctx, target)?;

    let src = ctx.bundle_root.join(target.source_dir());
    if !src.is_dir() {
        return Err(ExtInstallError::BundleMissing(src));
    }

    let shared = ctx.bundle_root.join("_shared/kanso-client");
    if !shared.is_dir() {
        return Err(ExtInstallError::BundleMissing(shared));
    }

    let version = bundled_version(ctx)?;
    let suffix = unique_install_suffix();
    let new_path = sibling_with_suffix(target_path, &format!("new.{suffix}"));
    let old_path = sibling_with_suffix(target_path, &format!("old.{suffix}"));

    remove_path_if_exists(&new_path)?;
    create_dir_all(&new_path)?;
    copy_dir_contents(&src, &new_path)?;
    copy_dir_contents(&shared, &new_path.join("_shared/kanso-client"))?;
    copy_dir_contents(&shared, &new_path.join("node_modules/@kanso/client"))?;
    write_text(&new_path.join(VERSION_FILE), &format!("{version}\n"))?;

    swap_install(&new_path, target_path, &old_path)?;
    Ok(())
}

fn uninstall_target(ctx: &InstallContext, target: InstallTarget) -> Result<(), ExtInstallError> {
    with_install_lock(ctx, || {
        let target_path = ctx.target_path(target);
        ensure_not_symlink(target_path, target.label())?;
        remove_path_if_exists(target_path)?;
        if target == InstallTarget::Cli {
            let mut settings = load_settings(ctx)?;
            settings.cli_ext_consent = false;
            settings.cli_ext_consent_dismissed = true;
            save_settings(ctx, &settings)?;
        }
        Ok(())
    })
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

fn target_needs_install(
    target: &Path,
    bundled: &str,
    consent: bool,
) -> Result<bool, ExtInstallError> {
    match installed_version(target)? {
        Some(version) => Ok(version != bundled),
        None => Ok(consent),
    }
}

fn validate_bundle(ctx: &InstallContext, target: InstallTarget) -> Result<(), ExtInstallError> {
    let version = bundled_version(ctx)?;
    if !is_semverish(&version) {
        return Err(ExtInstallError::BundleInvalid(format!(
            "invalid bundled version stamp `{version}`"
        )));
    }

    let shared = ctx.bundle_root.join("_shared/kanso-client/package.json");
    ensure_bundle_file(&shared)?;

    match target {
        InstallTarget::Cli => {
            ensure_bundle_file(&ctx.bundle_root.join("kanso/extension.mjs"))?;
            ensure_bundle_file(&ctx.bundle_root.join("kanso/package.json"))?;
        }
        InstallTarget::Mcp => {
            ensure_bundle_file(&ctx.bundle_root.join("kanso-mcp/bin/kanso-mcp.mjs"))?;
            ensure_bundle_file(&ctx.bundle_root.join("kanso-mcp/package.json"))?;
            ensure_bundle_file(
                &ctx.bundle_root
                    .join("kanso-mcp/node_modules/@modelcontextprotocol/sdk/package.json"),
            )?;
            ensure_bundle_file(
                &ctx.bundle_root
                    .join("kanso-mcp/node_modules/yjs/package.json"),
            )?;
            ensure_bundle_file(
                &ctx.bundle_root
                    .join("kanso-mcp/node_modules/zod/package.json"),
            )?;
        }
    }
    Ok(())
}

fn ensure_bundle_file(path: &Path) -> Result<(), ExtInstallError> {
    if path.is_file() {
        Ok(())
    } else {
        Err(ExtInstallError::BundleMissing(path.to_path_buf()))
    }
}

fn is_semverish(version: &str) -> bool {
    let (core, pre) = version
        .split_once('-')
        .map_or((version, None), |(core, pre)| (core, Some(pre)));
    let mut parts = core.split('.');
    let valid_core = (0..3).all(|_| {
        parts
            .next()
            .is_some_and(|part| !part.is_empty() && part.chars().all(|c| c.is_ascii_digit()))
    }) && parts.next().is_none();
    let valid_pre = match pre {
        Some(pre) => {
            !pre.is_empty()
                && pre
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
        }
        None => true,
    };
    valid_core && valid_pre
}

fn recover_installs(ctx: &InstallContext) -> Result<(), ExtInstallError> {
    recover_target(&ctx.cli_target)?;
    recover_target(&ctx.mcp_target)
}

fn recover_target(target: &Path) -> Result<(), ExtInstallError> {
    let old_paths = sibling_paths_with_kind(target, "old")?;
    if !target.exists() {
        if let Some(old_path) = newest_path(old_paths.iter())? {
            rename_path(&old_path, target)?;
        }
    }

    if target.exists() {
        for path in sibling_paths_with_kind(target, "new")? {
            remove_path_if_exists(&path)?;
        }
    }
    Ok(())
}

fn sibling_paths_with_kind(target: &Path, kind: &str) -> Result<Vec<PathBuf>, ExtInstallError> {
    let Some(parent) = target.parent() else {
        return Ok(Vec::new());
    };
    if !parent.exists() {
        return Ok(Vec::new());
    }
    let Some(name) = target.file_name().and_then(|n| n.to_str()) else {
        return Ok(Vec::new());
    };
    let prefix = format!("{name}.{kind}.");
    let mut paths = Vec::new();
    for entry in fs::read_dir(parent).map_err(|source| ExtInstallError::Io {
        op: "read_dir",
        path: parent.to_path_buf(),
        source,
    })? {
        let entry = entry.map_err(|source| ExtInstallError::Io {
            op: "read_dir entry",
            path: parent.to_path_buf(),
            source,
        })?;
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            paths.push(entry.path());
        }
    }
    Ok(paths)
}

fn newest_path<'a>(
    paths: impl Iterator<Item = &'a PathBuf>,
) -> Result<Option<PathBuf>, ExtInstallError> {
    let mut newest: Option<(SystemTime, PathBuf)> = None;
    for path in paths {
        let modified = fs::metadata(path)
            .map_err(|source| ExtInstallError::Io {
                op: "metadata",
                path: path.clone(),
                source,
            })?
            .modified()
            .map_err(|source| ExtInstallError::Io {
                op: "metadata modified",
                path: path.clone(),
                source,
            })?;
        if newest.as_ref().map_or(true, |(time, _)| modified > *time) {
            newest = Some((modified, path.clone()));
        }
    }
    Ok(newest.map(|(_, path)| path))
}

struct InstallLock<'a> {
    _guard: MutexGuard<'a, ()>,
    file: File,
}

impl Drop for InstallLock<'_> {
    fn drop(&mut self) {
        let _ = FileExt::unlock(&self.file);
    }
}

fn with_install_lock<T>(
    ctx: &InstallContext,
    op: impl FnOnce() -> Result<T, ExtInstallError>,
) -> Result<T, ExtInstallError> {
    let _lock = acquire_install_lock(ctx)?;
    op()
}

fn acquire_install_lock(ctx: &InstallContext) -> Result<InstallLock<'_>, ExtInstallError> {
    let guard = INSTALL_MUTEX
        .try_lock()
        .map_err(|_| ExtInstallError::InstallBusy)?;
    if let Some(parent) = ctx.lock_path.parent() {
        create_dir_all(parent)?;
    }
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&ctx.lock_path)
        .map_err(|source| ExtInstallError::Io {
            op: "open lock",
            path: ctx.lock_path.clone(),
            source,
        })?;
    match file.try_lock_exclusive() {
        Ok(()) => Ok(InstallLock {
            _guard: guard,
            file,
        }),
        Err(e) if e.kind() == io::ErrorKind::WouldBlock => Err(ExtInstallError::InstallBusy),
        Err(source) => Err(ExtInstallError::Io {
            op: "lock",
            path: ctx.lock_path.clone(),
            source,
        }),
    }
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
    command_node_check("node", &["--version"], NODE_TIMEOUT)
}

fn command_node_check(
    program: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<NodeCheck, ExtInstallError> {
    let mut child = match Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(NodeCheck::Missing),
        Err(source) => {
            return Err(ExtInstallError::Io {
                op: "run node version check",
                path: PathBuf::from(program),
                source,
            });
        }
    };

    if child
        .wait_timeout(timeout)
        .map_err(|source| ExtInstallError::Io {
            op: "wait node version check",
            path: PathBuf::from(program),
            source,
        })?
        .is_none()
    {
        let _ = child.kill();
        let _ = child.wait();
        return Ok(NodeCheck::Missing);
    }

    let output = child
        .wait_with_output()
        .map_err(|source| ExtInstallError::Io {
            op: "read node version check",
            path: PathBuf::from(program),
            source,
        })?;

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

fn unique_install_suffix() -> String {
    let pid = std::process::id();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    format!("{pid}.{nanos}")
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_MUTEX: Mutex<()> = Mutex::new(());

    fn test_guard() -> MutexGuard<'static, ()> {
        TEST_MUTEX.lock().expect("test mutex")
    }

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
        write_text(
            &root.join("kanso-mcp/node_modules/@modelcontextprotocol/sdk/package.json"),
            "{}",
        )?;
        write_text(&root.join("kanso-mcp/node_modules/yjs/package.json"), "{}")?;
        write_text(&root.join("kanso-mcp/node_modules/zod/package.json"), "{}")?;
        write_text(&root.join("_shared/kanso-client/package.json"), "{}")?;
        write_text(&root.join("_shared/kanso-client/index.mjs"), marker)
    }

    #[test]
    fn fresh_install_copies_cli_mcp_shared_and_versions() -> Result<(), ExtInstallError> {
        let _guard = test_guard();
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
            .join("node_modules/@modelcontextprotocol/sdk/package.json")
            .is_file());
        assert!(ctx
            .mcp_target
            .join("node_modules/yjs/package.json")
            .is_file());
        assert!(ctx
            .mcp_target
            .join("node_modules/zod/package.json")
            .is_file());
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
        let _guard = test_guard();
        let (_dir, ctx) = context("1.0.0")?;

        install_all(&ctx, NodeCheck::Present(20))?;
        install_all(&ctx, NodeCheck::Present(20))?;

        assert_eq!(
            read_trimmed(&ctx.cli_target.join("extension.mjs"))?,
            "initial"
        );
        assert!(sibling_paths_with_kind(&ctx.cli_target, "new")?.is_empty());
        assert!(sibling_paths_with_kind(&ctx.cli_target, "old")?.is_empty());
        Ok(())
    }

    #[test]
    fn version_bump_auto_upgrade_reinstalls() -> Result<(), ExtInstallError> {
        let _guard = test_guard();
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
    fn mcp_version_drift_reinstalls_only_mcp() -> Result<(), ExtInstallError> {
        let _guard = test_guard();
        let (_dir, ctx) = context("1.0.0")?;
        install_all(&ctx, NodeCheck::Present(20))?;
        write_text(&ctx.cli_target.join("extension.mjs"), "local")?;
        write_text(&ctx.mcp_target.join(VERSION_FILE), "0.9.0\n")?;
        write_fixture_bundle(&ctx.bundle_root, "1.0.0", "repaired")?;

        auto_upgrade(&ctx, NodeCheck::Present(20))?;

        assert_eq!(
            read_trimmed(&ctx.cli_target.join("extension.mjs"))?,
            "local"
        );
        assert_eq!(
            read_trimmed(&ctx.mcp_target.join("bin/kanso-mcp.mjs"))?,
            "repaired"
        );
        assert_eq!(read_trimmed(&ctx.mcp_target.join(VERSION_FILE))?, "1.0.0");
        Ok(())
    }

    #[test]
    fn missing_mcp_with_consent_reinstalls_mcp_only() -> Result<(), ExtInstallError> {
        let _guard = test_guard();
        let (_dir, ctx) = context("1.0.0")?;
        install_all(&ctx, NodeCheck::Present(20))?;
        write_text(&ctx.cli_target.join("extension.mjs"), "local")?;
        remove_path_if_exists(&ctx.mcp_target)?;
        save_settings(
            &ctx,
            &CliExtSettings {
                cli_ext_consent: true,
                cli_ext_consent_dismissed: false,
            },
        )?;
        write_fixture_bundle(&ctx.bundle_root, "1.0.0", "repaired")?;

        auto_upgrade(&ctx, NodeCheck::Present(20))?;

        assert_eq!(
            read_trimmed(&ctx.cli_target.join("extension.mjs"))?,
            "local"
        );
        assert_eq!(
            read_trimmed(&ctx.mcp_target.join("bin/kanso-mcp.mjs"))?,
            "repaired"
        );
        Ok(())
    }

    #[test]
    fn concurrent_install_refuses_when_lock_held() -> Result<(), ExtInstallError> {
        let _guard = test_guard();
        let (_dir, ctx) = context("1.0.0")?;
        let _lock = acquire_install_lock(&ctx)?;

        let err = install_all(&ctx, NodeCheck::Present(20)).err();

        assert!(matches!(err, Some(ExtInstallError::InstallBusy)));
        Ok(())
    }

    #[test]
    fn recovery_restores_old_target_when_target_missing() -> Result<(), ExtInstallError> {
        let _guard = test_guard();
        let (_dir, ctx) = context("1.0.0")?;
        let old = sibling_with_suffix(&ctx.cli_target, "old.test");
        write_text(&old.join(VERSION_FILE), "1.0.0\n")?;
        write_text(&old.join("extension.mjs"), "restored")?;

        recover_install_state(&ctx)?;

        assert_eq!(
            read_trimmed(&ctx.cli_target.join("extension.mjs"))?,
            "restored"
        );
        assert!(!old.exists());
        Ok(())
    }

    #[test]
    fn uninstall_cli_clears_consent_flags() -> Result<(), ExtInstallError> {
        let _guard = test_guard();
        let (_dir, ctx) = context("1.0.0")?;
        install_all(&ctx, NodeCheck::Present(20))?;
        save_settings(
            &ctx,
            &CliExtSettings {
                cli_ext_consent: true,
                cli_ext_consent_dismissed: false,
            },
        )?;

        uninstall_target(&ctx, InstallTarget::Cli)?;

        let settings = load_settings(&ctx)?;
        assert!(!settings.cli_ext_consent);
        assert!(settings.cli_ext_consent_dismissed);
        Ok(())
    }

    #[test]
    #[cfg(unix)]
    fn node_check_timeout_returns_missing() -> Result<(), ExtInstallError> {
        assert_eq!(
            command_node_check("sleep", &["10"], Duration::from_millis(10))?,
            NodeCheck::Missing
        );
        Ok(())
    }

    #[test]
    fn malformed_bundle_stamp_refuses_install() -> Result<(), ExtInstallError> {
        let _guard = test_guard();
        let (_dir, ctx) = context("bad")?;

        let err = install_all(&ctx, NodeCheck::Present(20)).err();

        assert!(matches!(err, Some(ExtInstallError::BundleInvalid(_))));
        assert!(!ctx.cli_target.exists());
        Ok(())
    }

    #[test]
    fn missing_mcp_entry_file_refuses_install() -> Result<(), ExtInstallError> {
        let _guard = test_guard();
        let (_dir, ctx) = context("1.0.0")?;
        remove_path_if_exists(&ctx.bundle_root.join("kanso-mcp/bin/kanso-mcp.mjs"))?;

        let err = install_target(&ctx, InstallTarget::Mcp, NodeCheck::Present(20)).err();

        assert!(
            matches!(err, Some(ExtInstallError::BundleMissing(path)) if path.ends_with("kanso-mcp/bin/kanso-mcp.mjs"))
        );
        assert!(!ctx.mcp_target.exists());
        Ok(())
    }

    #[test]
    #[cfg(unix)]
    fn dev_symlink_refuses_install() -> Result<(), ExtInstallError> {
        let _guard = test_guard();
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
        let _guard = test_guard();
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

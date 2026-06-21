use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::{AppHandle, Manager};
use thiserror::Error;

const MCP_SERVER_REL: &str = ".kanso/mcp/bin/kanso-mcp.mjs";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct HostInfo {
    pub id: String,
    pub name: String,
    pub detected: bool,
    pub config_dir: PathBuf,
    pub config_file_hint: Option<String>,
}

#[derive(Debug, Error)]
pub enum McpHostError {
    #[error("resolve app path {name}: {source}")]
    AppPath {
        name: &'static str,
        source: tauri::Error,
    },
    #[error("reveal {path}: {source}")]
    Reveal { path: PathBuf, source: io::Error },
    #[error("Finder failed to open {path} (status {status})")]
    RevealStatus { path: PathBuf, status: String },
}

pub fn detect_from_app(app: &AppHandle) -> Result<Vec<HostInfo>, McpHostError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|source| McpHostError::AppPath {
            name: "home_dir",
            source,
        })?;
    Ok(detect_hosts(&home))
}

pub fn mcp_server_path_from_app(app: &AppHandle) -> Result<Option<String>, McpHostError> {
    let home = app
        .path()
        .home_dir()
        .map_err(|source| McpHostError::AppPath {
            name: "home_dir",
            source,
        })?;
    Ok(mcp_server_path(&home))
}

pub fn reveal_in_finder(path: &Path) -> Result<(), McpHostError> {
    let status =
        Command::new("open")
            .arg(path)
            .status()
            .map_err(|source| McpHostError::Reveal {
                path: path.to_path_buf(),
                source,
            })?;
    if status.success() {
        return Ok(());
    }

    Err(McpHostError::RevealStatus {
        path: path.to_path_buf(),
        status: status.to_string(),
    })
}

pub fn detect_hosts(home: &Path) -> Vec<HostInfo> {
    vec![
        host(
            home,
            "claude",
            "Claude Desktop",
            &["Library/Application Support/Claude"],
            Some("claude_desktop_config.json"),
        ),
        host(
            home,
            "cursor",
            "Cursor",
            &["Library/Application Support/Cursor/User", ".cursor"],
            Some("mcp.json"),
        ),
        host(
            home,
            "vscode",
            "VS Code Copilot Chat",
            &["Library/Application Support/Code/User"],
            Some("settings.json"),
        ),
        host(
            home,
            "zed",
            "Zed",
            &[".config/zed", "Library/Application Support/Zed"],
            Some("settings.json"),
        ),
        host(
            home,
            "cline",
            "Cline",
            &["Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings"],
            Some("cline_mcp_settings.json"),
        ),
    ]
}

pub fn mcp_server_path(home: &Path) -> Option<String> {
    let path = home.join(MCP_SERVER_REL);
    path.is_file().then(|| path.to_string_lossy().into_owned())
}

fn host(
    home: &Path,
    id: &str,
    name: &str,
    dirs: &[&str],
    config_file_hint: Option<&str>,
) -> HostInfo {
    let paths: Vec<PathBuf> = dirs.iter().map(|dir| home.join(dir)).collect();
    let detected_path = paths.iter().find(|path| path.is_dir()).cloned();
    let detected = detected_path.is_some();
    let config_dir = detected_path
        .or_else(|| paths.into_iter().next())
        .unwrap_or_else(|| home.to_path_buf());

    HostInfo {
        id: id.to_string(),
        name: name.to_string(),
        detected,
        config_dir,
        config_file_hint: config_file_hint.map(str::to_string),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::fs;

    use super::*;

    fn by_id(hosts: &[HostInfo]) -> HashMap<&str, &HostInfo> {
        hosts.iter().map(|host| (host.id.as_str(), host)).collect()
    }

    #[test]
    fn detect_hosts_marks_all_existing_config_dirs_detected() -> Result<(), io::Error> {
        let dir = tempfile::tempdir()?;
        let home = dir.path();
        for path in [
            "Library/Application Support/Claude",
            "Library/Application Support/Cursor/User",
            "Library/Application Support/Code/User",
            ".config/zed",
            "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings",
        ] {
            fs::create_dir_all(home.join(path))?;
        }

        let hosts = detect_hosts(home);

        assert_eq!(hosts.len(), 5);
        assert!(hosts.iter().all(|host| host.detected));
        Ok(())
    }

    #[test]
    fn detect_hosts_marks_none_detected_when_config_dirs_are_absent() -> Result<(), io::Error> {
        let dir = tempfile::tempdir()?;
        let hosts = detect_hosts(dir.path());

        assert_eq!(hosts.len(), 5);
        assert!(hosts.iter().all(|host| !host.detected));
        Ok(())
    }

    #[test]
    fn detect_hosts_marks_only_existing_config_dirs_detected() -> Result<(), io::Error> {
        let dir = tempfile::tempdir()?;
        let home = dir.path();
        fs::create_dir_all(home.join("Library/Application Support/Claude"))?;
        fs::create_dir_all(home.join("Library/Application Support/Zed"))?;

        let detected = detect_hosts(home);
        let hosts = by_id(&detected);

        assert!(hosts["claude"].detected);
        assert!(hosts["zed"].detected);
        assert!(!hosts["cursor"].detected);
        assert!(!hosts["vscode"].detected);
        assert!(!hosts["cline"].detected);
        assert_eq!(
            hosts["zed"].config_dir,
            home.join("Library/Application Support/Zed")
        );
        Ok(())
    }

    #[test]
    fn mcp_server_path_returns_some_when_installed() -> Result<(), io::Error> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join(MCP_SERVER_REL);
        let parent = path
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "mcp path has no parent"))?;
        fs::create_dir_all(parent)?;
        fs::write(&path, "server")?;

        assert_eq!(
            mcp_server_path(dir.path()),
            Some(path.to_string_lossy().into_owned())
        );
        Ok(())
    }

    #[test]
    fn mcp_server_path_returns_none_when_missing() -> Result<(), io::Error> {
        let dir = tempfile::tempdir()?;

        assert_eq!(mcp_server_path(dir.path()), None);
        Ok(())
    }
}

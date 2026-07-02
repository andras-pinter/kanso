use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

const VERSION_FILE: &str = ".kanso-ext-version";

fn main() {
    if let Err(e) = stage_extensions() {
        eprintln!("failed to stage bundled extensions: {e}");
        std::process::exit(1);
    }
    tauri_build::build()
}

fn stage_extensions() -> io::Result<()> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let source = manifest_dir.join("../../extensions");
    let staged = manifest_dir.join("resources/extensions");

    emit_rerun_if_changed(&source)?;
    remove_path(&staged)?;
    fs::create_dir_all(&staged)?;
    let stamp = bundle_stamp(&source)?;
    fs::write(staged.join(VERSION_FILE), format!("{stamp}\n"))?;

    copy_file_if_exists(&source.join("package.json"), &staged.join("package.json"))?;
    copy_file_if_exists(
        &source.join("package-lock.json"),
        &staged.join("package-lock.json"),
    )?;
    copy_filtered_package(&source.join("kanso"), &staged.join("kanso"))?;
    copy_filtered_package(&source.join("kanso-mcp"), &staged.join("kanso-mcp"))?;
    copy_filtered_package(
        &source.join("_shared/kanso-client"),
        &staged.join("_shared/kanso-client"),
    )?;
    install_mcp_dependencies(&staged)?;

    Ok(())
}

fn copy_filtered_package(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let path = entry.path();
        let target = dst.join(name.as_ref());
        let file_type = entry.file_type()?;

        if file_type.is_symlink() || name.starts_with('.') || name == "node_modules" {
            continue;
        }

        if file_type.is_dir() {
            copy_filtered_package(&path, &target)?;
        } else if should_bundle(&path) {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

fn should_bundle(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };

    name == "package.json"
        || name == "package-lock.json"
        || name == "README.md"
        || (name.ends_with(".mjs") && !name.ends_with(".test.mjs"))
}

fn install_mcp_dependencies(staged: &Path) -> io::Result<()> {
    let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let status = Command::new(npm)
        .args([
            "install",
            "--omit=dev",
            "--no-audit",
            "--no-fund",
            "--ignore-scripts",
            "--workspace",
            "kanso-mcp",
        ])
        .current_dir(staged)
        .status()?;
    if !status.success() {
        return Err(io::Error::other(format!(
            "npm install failed with status {status}"
        )));
    }

    let hoisted = staged.join("node_modules");
    let mcp_modules = staged.join("kanso-mcp/node_modules");
    remove_path(&mcp_modules)?;
    copy_dir_contents(&hoisted, &mcp_modules)?;
    remove_path(&hoisted)?;
    Ok(())
}

fn copy_dir_contents(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        let file_type = entry.file_type()?;

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            copy_dir_contents(&path, &target)?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&path, &target)?;
        }
    }
    Ok(())
}

fn copy_file_if_exists(src: &Path, dst: &Path) -> io::Result<()> {
    if !src.exists() {
        return Ok(());
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::copy(src, dst)?;
    Ok(())
}

fn emit_rerun_if_changed(path: &Path) -> io::Result<()> {
    println!("cargo:rerun-if-changed={}", path.display());
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let entry_path = entry.path();
        let file_type = entry.file_type()?;
        if file_type.is_symlink() || name.starts_with('.') || name == "node_modules" {
            continue;
        }
        if file_type.is_dir() {
            emit_rerun_if_changed(&entry_path)?;
        } else {
            println!("cargo:rerun-if-changed={}", entry_path.display());
        }
    }
    Ok(())
}

fn remove_path(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

fn bundle_stamp(source: &Path) -> io::Result<String> {
    let cli = read_pkg_version(&source.join("kanso/package.json"))?;
    let mcp = read_pkg_version(&source.join("kanso-mcp/package.json"))?;
    let client = read_pkg_version(&source.join("_shared/kanso-client/package.json"))?;
    Ok(format!("cli={cli}+mcp={mcp}+client={client}"))
}

fn read_pkg_version(path: &Path) -> io::Result<String> {
    let text = fs::read_to_string(path)?;
    parse_pkg_version(&text).ok_or_else(|| {
        io::Error::other(format!(
            "no `version` field found in {}",
            path.display()
        ))
    })
}

fn parse_pkg_version(text: &str) -> Option<String> {
    let key = text.find("\"version\"")?;
    let after = &text[key + "\"version\"".len()..];
    let colon = after.find(':')?;
    let rest = &after[colon + 1..];
    let start = rest.find('"')? + 1;
    let tail = &rest[start..];
    let end = tail.find('"')?;
    let value = tail[..end].trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

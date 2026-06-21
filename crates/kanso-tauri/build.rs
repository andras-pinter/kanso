use std::fs;
use std::io;
use std::path::{Path, PathBuf};

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

    remove_path(&staged)?;
    fs::create_dir_all(&staged)?;
    fs::write(
        staged.join(VERSION_FILE),
        format!("{}\n", env!("CARGO_PKG_VERSION")),
    )?;

    copy_filtered_package(&source.join("kanso"), &staged.join("kanso"))?;
    copy_filtered_package(&source.join("kanso-mcp"), &staged.join("kanso-mcp"))?;
    copy_filtered_package(
        &source.join("_shared/kanso-client"),
        &staged.join("_shared/kanso-client"),
    )?;

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
        || name == "README.md"
        || (name.ends_with(".mjs") && !name.ends_with(".test.mjs"))
}

fn remove_path(path: &Path) -> io::Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

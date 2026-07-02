//! Verifies that `crates/kanso-tauri/resources/extensions/` (staged by build.rs
//! from `extensions/`) is a faithful, current copy of the source tree. Catches:
//!   * `should_bundle` filter drift (a new source file type not being copied),
//!   * `.kanso-ext-version` stamp drift (source package.json bumps not reflected),
//!   * missing packages (a package added to extensions/ but not wired into build.rs).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

const VERSION_FILE: &str = ".kanso-ext-version";

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn source_root() -> PathBuf {
    manifest_dir().join("../../extensions")
}

fn staged_root() -> PathBuf {
    manifest_dir().join("resources/extensions")
}

fn should_bundle(name: &str) -> bool {
    name == "package.json"
        || name == "package-lock.json"
        || name == "README.md"
        || (name.ends_with(".mjs") && !name.ends_with(".test.mjs"))
}

fn collect_expected(src: &Path, rel: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(src).expect("read source dir") {
        let entry = entry.expect("dir entry");
        let name = entry.file_name();
        let name = name.to_string_lossy().into_owned();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let ft = entry.file_type().expect("file type");
        if ft.is_symlink() {
            continue;
        }
        let child_rel = rel.join(&name);
        if ft.is_dir() {
            collect_expected(&entry.path(), &child_rel, out);
        } else if should_bundle(&name) {
            out.push(child_rel);
        }
    }
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
    (!value.is_empty()).then(|| value.to_string())
}

fn pkg_version(source_root: &Path, rel: &str) -> String {
    let path = source_root.join(rel);
    let text = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    parse_pkg_version(&text)
        .unwrap_or_else(|| panic!("no version field in {}", path.display()))
}

#[test]
fn staged_bundle_mirrors_every_source_file() {
    let src = source_root();
    let dst = staged_root();
    assert!(
        dst.is_dir(),
        "resources/extensions is not staged. Run `cargo build -p kanso-tauri`."
    );

    for pkg in ["kanso", "kanso-mcp", "_shared/kanso-client"] {
        let pkg_src = src.join(pkg);
        assert!(pkg_src.is_dir(), "missing source package {pkg}");
        let mut expected = Vec::new();
        collect_expected(&pkg_src, Path::new(pkg), &mut expected);
        assert!(!expected.is_empty(), "no files collected under {pkg}");

        for rel in expected {
            let src_file = src.join(&rel);
            let dst_file = dst.join(&rel);
            assert!(
                dst_file.is_file(),
                "staged bundle missing {} (source at {})",
                dst_file.display(),
                src_file.display()
            );
            let src_bytes = fs::read(&src_file).expect("read source");
            let dst_bytes = fs::read(&dst_file).expect("read staged");
            assert_eq!(
                src_bytes,
                dst_bytes,
                "staged bundle differs from source at {}",
                rel.display()
            );
        }
    }

    for name in ["package.json", "package-lock.json"] {
        let s = src.join(name);
        let d = dst.join(name);
        if s.exists() {
            assert!(d.is_file(), "staged bundle missing root {name}");
            assert_eq!(
                fs::read(&s).unwrap(),
                fs::read(&d).unwrap(),
                "staged root {name} differs from source"
            );
        }
    }
}

#[test]
fn stamp_reflects_all_three_source_versions() {
    let src = source_root();
    let dst = staged_root();
    assert!(
        dst.is_dir(),
        "resources/extensions is not staged. Run `cargo build -p kanso-tauri`."
    );

    let stamp_raw = fs::read_to_string(dst.join(VERSION_FILE)).expect("read stamp");
    let stamp = stamp_raw.trim();

    let cli = pkg_version(&src, "kanso/package.json");
    let mcp = pkg_version(&src, "kanso-mcp/package.json");
    let client = pkg_version(&src, "_shared/kanso-client/package.json");

    for (label, want) in [("cli", &cli), ("mcp", &mcp), ("client", &client)] {
        let needle = format!("{label}={want}");
        assert!(
            stamp.contains(&needle),
            "stamp `{stamp}` missing `{needle}` — build.rs::bundle_stamp is out of sync"
        );
    }
}

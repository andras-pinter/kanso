//! Generates `extensions/_shared/kanso-client/dto-contract.generated.mjs` from
//! Rust request DTOs in `crates/kanso-api/src/dto.rs`.
//!
//! Run via `cargo run -p dto-contract-gen`. `just check` runs this and then
//! `git diff --exit-code` on the output file, so any drift between the Rust
//! DTOs and the JS contract used by extension tool-schema tests fails CI.
//!
//! Serde attribute handling (kept intentionally narrow — expand case-by-case):
//! - `#[serde(rename = "…")]` → use the renamed wire name.
//! - `Option<Option<T>>` (the `double_option` pattern in dto.rs) → optional +
//!   nullable. Currently we only surface it as `optional` to match the
//!   existing contract shape; the pattern is still detected so we don't
//!   mis-classify these as required.
//! - `Option<T>` → optional.
//! - Anything else → required.
//!
//! Custom `#[serde(with = "…")]` deserializers that change the wire shape
//! without changing the Rust type are invisible to this tool. `double_option`
//! is the only such case today.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use syn::{Attribute, Expr, Fields, ItemStruct, Lit, Meta, Type, TypePath, Visibility};

/// (contract key, Rust struct name). Order defines output order.
const CONTRACT_MAP: &[(&str, &str)] = &[
    ("board_create", "CreateBoardBody"),
    ("board_update_patch", "BoardPatchDto"),
    ("column_create", "CreateColumnBody"),
    ("column_update_patch", "ColumnPatchDto"),
    ("card_create", "CreateCardBody"),
    ("card_update_patch", "CardPatchDto"),
    ("tag_create", "CreateTagBody"),
    ("tag_update_patch", "TagPatchDto"),
];

#[derive(Debug)]
struct FieldSpec {
    name: String,
    optional: bool,
}

fn main() -> Result<()> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| anyhow!("cannot resolve repo root from {}", manifest_dir.display()))?;

    let dto_path = repo_root.join("crates/kanso-api/src/dto.rs");
    let out_path =
        repo_root.join("extensions/_shared/kanso-client/dto-contract.generated.mjs");

    let src = std::fs::read_to_string(&dto_path)
        .with_context(|| format!("reading {}", dto_path.display()))?;
    let file: syn::File = syn::parse_file(&src)
        .with_context(|| format!("parsing {}", dto_path.display()))?;

    let structs: BTreeMap<String, &ItemStruct> = file
        .items
        .iter()
        .filter_map(|item| match item {
            syn::Item::Struct(s) => Some((s.ident.to_string(), s)),
            _ => None,
        })
        .collect();

    let mut entries: Vec<(&str, Vec<FieldSpec>)> = Vec::with_capacity(CONTRACT_MAP.len());
    for (contract_name, struct_name) in CONTRACT_MAP {
        let s = structs
            .get(*struct_name)
            .ok_or_else(|| anyhow!("struct `{struct_name}` not found in dto.rs"))?;
        let fields = extract_fields(s)
            .with_context(|| format!("extracting fields for `{struct_name}`"))?;
        entries.push((contract_name, fields));
    }

    let rendered = render(&entries);

    let existing = std::fs::read_to_string(&out_path).unwrap_or_default();
    if existing == rendered {
        eprintln!("dto-contract-gen: up to date ({})", out_path.display());
        return Ok(());
    }

    std::fs::write(&out_path, &rendered)
        .with_context(|| format!("writing {}", out_path.display()))?;
    eprintln!("dto-contract-gen: wrote {}", out_path.display());
    Ok(())
}

fn extract_fields(s: &ItemStruct) -> Result<Vec<FieldSpec>> {
    let Fields::Named(named) = &s.fields else {
        bail!("struct `{}` has no named fields", s.ident);
    };

    let mut out = Vec::with_capacity(named.named.len());
    for field in &named.named {
        if !matches!(field.vis, Visibility::Public(_)) {
            continue;
        }
        let ident = field
            .ident
            .as_ref()
            .ok_or_else(|| anyhow!("unnamed field in struct `{}`", s.ident))?;
        let name = serde_rename(&field.attrs)?.unwrap_or_else(|| ident.to_string());
        let optional = is_option_type(&field.ty);
        out.push(FieldSpec { name, optional });
    }
    Ok(out)
}

fn serde_rename(attrs: &[Attribute]) -> Result<Option<String>> {
    for attr in attrs {
        if !attr.path().is_ident("serde") {
            continue;
        }
        let Meta::List(list) = &attr.meta else {
            continue;
        };
        let nested = list
            .parse_args_with(
                syn::punctuated::Punctuated::<Meta, syn::Token![,]>::parse_terminated,
            )
            .with_context(|| "parsing #[serde(...)]")?;
        for meta in nested {
            let Meta::NameValue(nv) = meta else {
                continue;
            };
            if !nv.path.is_ident("rename") {
                continue;
            }
            let Expr::Lit(expr_lit) = &nv.value else {
                continue;
            };
            let Lit::Str(s) = &expr_lit.lit else {
                continue;
            };
            return Ok(Some(s.value()));
        }
    }
    Ok(None)
}

/// True for `Option<...>` regardless of the inner type. Nested `Option<Option<T>>`
/// (the `double_option` pattern) also matches, which is what we want — the
/// outer field is still optional at the wire level.
fn is_option_type(ty: &Type) -> bool {
    let Type::Path(TypePath { qself: None, path }) = ty else {
        return false;
    };
    path.segments
        .last()
        .map(|seg| seg.ident == "Option")
        .unwrap_or(false)
}

fn render(entries: &[(&str, Vec<FieldSpec>)]) -> String {
    let mut out = String::new();
    out.push_str(
        "// AUTO-GENERATED by `cargo run -p dto-contract-gen`. DO NOT EDIT.\n\
         // Source of truth: `crates/kanso-api/src/dto.rs`.\n\
         // Regenerate after touching any request DTO; `just check` will fail on drift.\n\
         \n\
         export const DTO_CONTRACT = {\n",
    );
    for (name, fields) in entries {
        let required: Vec<&str> = fields
            .iter()
            .filter(|f| !f.optional)
            .map(|f| f.name.as_str())
            .collect();
        let optional: Vec<&str> = fields
            .iter()
            .filter(|f| f.optional)
            .map(|f| f.name.as_str())
            .collect();
        out.push_str(&format!(
            "    {name}: {{ required: {}, optional: {} }},\n",
            render_list(&required),
            render_list(&optional),
        ));
    }
    out.push_str("};\n");
    out
}

fn render_list(items: &[&str]) -> String {
    if items.is_empty() {
        return "[]".to_string();
    }
    let quoted: Vec<String> = items.iter().map(|s| format!("\"{s}\"")).collect();
    format!("[{}]", quoted.join(", "))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    fn parse_struct(src: &str) -> ItemStruct {
        syn::parse_str(src).expect("valid struct")
    }

    #[test]
    fn required_and_optional_are_separated() {
        let s = parse_struct(
            "pub struct T { pub a: String, #[serde(default)] pub b: Option<String> }",
        );
        let fs = extract_fields(&s).unwrap();
        assert_eq!(fs.len(), 2);
        assert_eq!(fs[0].name, "a");
        assert!(!fs[0].optional);
        assert_eq!(fs[1].name, "b");
        assert!(fs[1].optional);
    }

    #[test]
    fn double_option_is_optional() {
        let s = parse_struct("pub struct T { pub x: Option<Option<i64>> }");
        let fs = extract_fields(&s).unwrap();
        assert_eq!(fs[0].name, "x");
        assert!(fs[0].optional);
    }

    #[test]
    fn serde_rename_wins() {
        let s = parse_struct(
            "pub struct T { #[serde(rename = \"wire_name\")] pub rust_name: String }",
        );
        let fs = extract_fields(&s).unwrap();
        assert_eq!(fs[0].name, "wire_name");
    }

    #[test]
    fn non_pub_fields_are_skipped() {
        let s = parse_struct("pub struct T { pub a: String, b: String }");
        let fs = extract_fields(&s).unwrap();
        assert_eq!(fs.len(), 1);
        assert_eq!(fs[0].name, "a");
    }

    #[test]
    fn render_emits_stable_output() {
        let entries: Vec<(&str, Vec<FieldSpec>)> = vec![(
            "card_create",
            vec![FieldSpec {
                name: "title".into(),
                optional: false,
            }],
        )];
        let out = render(&entries);
        assert!(out.contains("card_create: { required: [\"title\"], optional: [] }"));
        assert!(out.starts_with("// AUTO-GENERATED"));
    }
}

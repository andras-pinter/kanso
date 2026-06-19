/// Generate a position string between `prev` and `next`.
///
/// TODO Phase 1: real fractional indexing (base-62, midpoint between strings,
/// with rebalance strategy for v1.1 when keys grow too long).
/// For now: naive append-`n` / midpoint of ASCII chars.
pub fn between(prev: Option<&str>, next: Option<&str>) -> String {
    match (prev, next) {
        (None, None) => "n".to_string(),
        (Some(p), None) => format!("{p}n"),
        (None, Some(n)) => {
            let first = n.chars().next().unwrap_or('n');
            // Pick a char strictly less than `first`; fall back to prefix.
            if (first as u32) > ('a' as u32) {
                let mid = char::from_u32((first as u32) - 1).unwrap_or('a');
                mid.to_string()
            } else {
                format!("a{n}")
            }
        }
        (Some(p), Some(n)) => {
            if p < n {
                format!("{p}n")
            } else {
                format!("{p}m")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn between_empty() {
        let pos = between(None, None);
        assert!(!pos.is_empty());
    }

    #[test]
    fn between_after_prev() {
        let a = between(None, None);
        let b = between(Some(&a), None);
        assert!(b > a);
    }
}

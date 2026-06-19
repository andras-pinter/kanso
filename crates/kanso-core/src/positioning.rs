//! Fractional indexing in base-62.
//!
//! Strings are lex-compared; the alphabet `0-9A-Za-z` is monotonic under both
//! ASCII order and digit value, so lex order == numeric order. Each call to
//! [`between`] returns a strictly-between key without ever consulting the rest
//! of the table — perfect for "insert at position N" without bulk renumbers.
//!
//! Invariant we *produce* (and rely on): keys never end in `'0'`. That
//! guarantees `between(prev, next)` can always find room (otherwise an
//! exhausted suffix of `'0'`s would have no smaller neighbour).
//!
//! Hand-rolled rather than depending on `fractional_index` because the crate
//! is small (one of ours easily fits in ~120 lines), Wave 1 already shipped a
//! placeholder we control, and pulling a dep for ~100 LOC is overkill.
//!
//! v1.1 will add a rebalance pass when keys grow past a threshold; the
//! algorithm here is compatible — rebalance just rewrites every position to
//! evenly-spaced keys.

const BASE: u8 = 62;

const fn val(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'A'..=b'Z' => 10 + c - b'A',
        b'a'..=b'z' => 36 + c - b'a',
        _ => 0,
    }
}

const fn ch(v: u8) -> u8 {
    match v {
        0..=9 => b'0' + v,
        10..=35 => b'A' + (v - 10),
        36..=61 => b'a' + (v - 36),
        _ => b'0',
    }
}

/// First key for an empty space. Middle of the alphabet ('U' = value 30).
pub fn first() -> String {
    String::from("U")
}

/// Return a key strictly between `prev` and `next`.
///
/// If both are `None` the result equals [`first`]. The result never ends in
/// `'0'`, preserving the invariant that further inserts always have room.
pub fn between(prev: Option<&str>, next: Option<&str>) -> String {
    match (prev, next) {
        (None, None) => first(),
        (None, Some(n)) => before(n.as_bytes()),
        (Some(p), None) => after(p.as_bytes()),
        (Some(p), Some(n)) => mid(p.as_bytes(), n.as_bytes()),
    }
}

fn from_utf8(bytes: Vec<u8>) -> String {
    // Every byte we push is a member of the ASCII alphabet, so utf-8 decoding
    // is infallible. Defensive fallback rather than `expect`.
    String::from_utf8(bytes).unwrap_or_else(|_| first())
}

/// Smallest key < `next` whose tail is non-zero.
fn before(next: &[u8]) -> String {
    let mut out = Vec::with_capacity(next.len() + 1);
    for &c in next {
        let v = val(c);
        if v == 0 {
            out.push(b'0');
            continue;
        }
        if v >= 2 {
            out.push(ch(v / 2));
            return from_utf8(out);
        }
        // v == 1: '0' alone would violate trailing-zero rule, so append "U".
        out.push(b'0');
        out.push(b'U');
        return from_utf8(out);
    }
    // `next` is all-zero — shouldn't happen if invariant holds upstream.
    first()
}

/// Smallest key > `prev` whose tail is non-zero.
fn after(prev: &[u8]) -> String {
    let mut out = Vec::with_capacity(prev.len() + 1);
    for &c in prev {
        let v = val(c);
        if v == BASE - 1 {
            out.push(b'z');
            continue;
        }
        let next_v = ((v as u16 + BASE as u16) / 2) as u8;
        out.push(ch(next_v));
        return from_utf8(out);
    }
    // `prev` was all 'z' — append 'U' to step past it.
    out.push(b'U');
    from_utf8(out)
}

/// Midpoint of `p` and `n` assuming `p < n` lexicographically.
fn mid(p: &[u8], n: &[u8]) -> String {
    let mut out = Vec::new();
    let mut i = 0;
    loop {
        let pv = p.get(i).copied().map(val).unwrap_or(0);
        let nv = n.get(i).copied().map(val).unwrap_or(BASE);
        if pv == nv {
            out.push(ch(pv));
            i += 1;
            continue;
        }
        if nv - pv >= 2 {
            out.push(ch((pv + nv) / 2));
            return from_utf8(out);
        }
        // Gap of 1: settle at ch(pv) on the prefix and recurse into `after`
        // on whatever tail of p remains. The upper bound is already enforced
        // by the prefix being strictly less than n's prefix.
        out.push(ch(pv));
        let suffix = if i + 1 < p.len() {
            after(&p[i + 1..])
        } else {
            String::from("U")
        };
        out.extend_from_slice(suffix.as_bytes());
        return from_utf8(out);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn between_none_none_is_non_empty() {
        let k = between(None, None);
        assert!(!k.is_empty());
    }

    #[test]
    fn between_two_keys_strictly_between() {
        let a = "a";
        let b = "b";
        let k = between(Some(a), Some(b));
        assert!(a < k.as_str() && k.as_str() < b, "{a} < {k} < {b}");
    }

    #[test]
    fn between_none_some_is_smaller() {
        let n = "a";
        let k = between(None, Some(n));
        assert!(k.as_str() < n, "{k} < {n}");
    }

    #[test]
    fn between_some_none_is_larger() {
        let p = "z";
        let k = between(Some(p), None);
        assert!(k.as_str() > p, "{k} > {p}");
    }

    #[test]
    fn hundred_inserts_between_same_anchors_are_sorted_and_unique() {
        // Realistic kanban: drop items between "a" and "b", each new key
        // becomes the right neighbour for the next insert.
        let mut right = String::from("b");
        let mut keys = Vec::with_capacity(100);
        for _ in 0..100 {
            let k = between(Some("a"), Some(&right));
            assert!(
                "a" < k.as_str() && k.as_str() < right.as_str(),
                "ordering broke: a < {k} < {right}"
            );
            right = k.clone();
            keys.push(k);
        }
        // All distinct.
        let mut sorted = keys.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(sorted.len(), keys.len(), "collision in 100 inserts");
        // Insertion order should be descending (each new key is smaller).
        for w in keys.windows(2) {
            assert!(w[0] > w[1], "non-monotonic: {} then {}", w[0], w[1]);
        }
    }

    #[test]
    fn hundred_inserts_at_tail_are_monotonic() {
        // Append-to-end pattern: between(last, None) over and over.
        let mut last = first();
        let mut keys = vec![last.clone()];
        for _ in 0..100 {
            let k = between(Some(&last), None);
            assert!(k > last, "{k} should be > {last}");
            last = k.clone();
            keys.push(k);
        }
        for w in keys.windows(2) {
            assert!(w[0] < w[1]);
        }
    }

    #[test]
    fn between_adjacent_keys_extends_length() {
        // 'a' and 'b' differ by 1 — result must be longer than "a".
        let k = between(Some("a"), Some("b"));
        assert!(k.len() >= 2, "expected extension, got {k:?}");
    }

    #[test]
    fn never_ends_in_zero() {
        let cases = [
            between(None, None),
            between(Some("a"), None),
            between(None, Some("a")),
            between(Some("a"), Some("b")),
            between(Some("0"), Some("1")),
            between(Some("a0U"), Some("a1")),
        ];
        for k in cases {
            assert!(!k.ends_with('0'), "trailing zero: {k:?}");
        }
    }
}

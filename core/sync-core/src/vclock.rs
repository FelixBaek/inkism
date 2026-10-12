//! Per-entity vector clocks.
//!
//! Each device keeps a monotonically increasing counter for every entity it
//! edits. A change carries the full clock snapshot known at edit time, which is
//! how two devices that edited the same entity while offline can detect that
//! their edits are *concurrent* (neither clock dominates the other) rather than
//! one being a newer version of the other.

use std::collections::BTreeMap;

/// A device-id -> counter map. Serialized as a JSON object.
pub type VClock = BTreeMap<String, u64>;

/// Pointwise maximum. Merging is commutative and associative, so two devices
/// that observe the same set of changes converge on the same clock.
pub fn merge(left: &VClock, right: &VClock) -> VClock {
    let mut out = left.clone();
    for (device, counter) in right {
        let entry = out.entry(device.clone()).or_insert(0);
        if *counter > *entry {
            *entry = *counter;
        }
    }
    out
}

/// True when `left` is at least as new as `right` on every device.
///
/// A clock dominates itself, which is what makes re-delivery of an already
/// applied change a no-op instead of a spurious conflict.
pub fn dominates(left: &VClock, right: &VClock) -> bool {
    right
        .iter()
        .all(|(device, counter)| left.get(device).copied().unwrap_or(0) >= *counter)
}

/// True when neither clock dominates the other, i.e. the two edits are
/// concurrent and one side must be preserved as a conflict copy.
pub fn concurrent(left: &VClock, right: &VClock) -> bool {
    left != right && !dominates(left, right) && !dominates(right, left)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clock(pairs: &[(&str, u64)]) -> VClock {
        pairs.iter().map(|(d, c)| (d.to_string(), *c)).collect()
    }

    #[test]
    fn merge_is_pointwise_max() {
        let a = clock(&[("a", 2), ("b", 1)]);
        let b = clock(&[("a", 1), ("b", 5), ("c", 3)]);
        assert_eq!(merge(&a, &b), clock(&[("a", 2), ("b", 5), ("c", 3)]));
        assert_eq!(merge(&a, &b), merge(&b, &a));
    }

    #[test]
    fn dominates_and_concurrent() {
        let base = clock(&[("a", 1)]);
        let newer = clock(&[("a", 2)]);
        let other = clock(&[("a", 1), ("b", 1)]);
        assert!(dominates(&newer, &base));
        assert!(!dominates(&base, &newer));
        assert!(dominates(&base, &base));
        assert!(concurrent(&newer, &other));
        assert!(!concurrent(&base, &newer));
    }
}

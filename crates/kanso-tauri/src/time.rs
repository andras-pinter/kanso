use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_iso_utc() -> String {
    let secs = unix_secs_now();
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let hour = rem / 3_600;
    let minute = (rem % 3_600) / 60;
    let second = rem % 60;
    format!(
        "{}T{:02}:{:02}:{:02}Z",
        date_from_days_since_epoch(days),
        hour,
        minute,
        second
    )
}

pub fn today_utc() -> String {
    date_from_days_since_epoch((unix_secs_now() / 86_400) as i64)
}

fn unix_secs_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

fn date_from_days_since_epoch(days: i64) -> String {
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}")
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = y + i64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_epoch_dates() {
        assert_eq!(date_from_days_since_epoch(0), "1970-01-01");
        assert_eq!(date_from_days_since_epoch(20_626), "2026-06-22");
    }
}

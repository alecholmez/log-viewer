//! Haltech NSP specifics: the PCLog CSV export, unit scaling per channel type, and channel names.
//! Another ECU gets its own module beside this one that produces the same `RawLog` and key-channel mapping.

use crate::fmt::js_round;

/// Scale, offset, unit and display decimals for an NSP channel `Type`.
/// Inferred from logged values, not from Haltech documentation.
pub fn type_info(ty: &str) -> (f64, f64, &'static str, u8) {
    match ty {
        "Raw" => (1.0, 0.0, "", 0),
        "Percentage" => (0.1, 0.0, "%", 1),
        "Angle" => (0.1, 0.0, "°", 1),
        "AFR" => (0.001, 0.0, "λ", 3),
        "EngineSpeed" => (1.0, 0.0, "rpm", 0),
        "Pressure" | "AbsPressure" => (0.1, 0.0, "kPa", 1),
        "Speed" => (0.1, 0.0, "km/h", 1),
        "Temperature" => (0.1, -273.15, "°C", 1),
        "BatteryVoltage" => (0.001, 0.0, "V", 2),
        "Time_us" => (0.001, 0.0, "ms", 3),
        "Time_ms" => (1.0, 0.0, "ms", 0),
        "Time_ms_as_s" => (0.001, 0.0, "s", 1),
        "Time_s" => (1.0, 0.0, "s", 0),
        "Decibel" => (0.01, 0.0, "dB", 1),
        "MassPerCyl" => (1.0, 0.0, "mg", 0),
        "MassOverTime" => (0.01, 0.0, "g/s", 2),
        "Flow" => (1.0, 0.0, "cc/min", 0),
        "Density" => (0.1, 0.0, "kg/m³", 1),
        "Stoichiometry" => (0.001, 0.0, ":1", 2),
        "Frequency" => (1.0, 0.0, "Hz", 0),
        "Gear" => (1.0, 0.0, "", 0),
        "GearRatio" => (0.1, 0.0, "km/h per 1000 rpm", 1),
        "Ratio" => (0.001, 0.0, "", 3),
        "InjFuelVolume" => (0.01, 0.0, "µL", 1),
        "Current_uA_as_mA" => (0.001, 0.0, "mA", 2),
        _ => (1.0, 0.0, "raw", 0),
    }
}

/// NSP writes values near i32::MAX or i32::MIN for "no reading".
pub const BAD: f64 = 2_147_480_000.0;

/// Raw NSP values of a channel `Type` to engineering units: the type's scale and offset, NaN for "no reading".
/// The type is looked up once, not per value.
pub fn to_eng(ty: &str) -> impl Fn(f64) -> f64 {
    let (s, o, _, _) = type_info(ty);
    move |v| if v.abs() >= BAD { f64::NAN } else { v * s + o }
}

/// NSP gives a state or a count no unit: its `Type` is `Raw` or `Gear`. `Ratio` also prints with no unit, but it is a
/// measurement scaled to thousandths, not a state, so it is not here. Inferred from the sample logs.
pub fn has_no_unit(ty: &str) -> bool {
    matches!(ty, "Raw" | "Gear")
}

/// The logger's own channels, which describe the log rather than the car: in NSP their names start `Data Log `
/// (Data Log Status, Data Log Memory State).
pub fn is_logger_channel(name: &str) -> bool {
    name.starts_with("Data Log ")
}

/// Channels the analysis uses, by NSP name.
pub mod name {
    pub const RPM: &str = "RPM";
    pub const GEAR: &str = "Gear";
    pub const VSS: &str = "Vehicle Speed";
    pub const DRIVEN: &str = "Driven Wheel Speed";
    pub const UNDRIVEN: &str = "Undriven Wheel Speed";
    pub const PEDAL: &str = "Drive By Wire Accelerator Pedal Position";
    pub const TPS: &str = "Throttle Position";
    pub const MAP: &str = "Manifold Pressure";
    pub const BARO: &str = "Barometric Pressure";
    pub const LAMBDA: &str = "Wideband O2 Overall";
    pub const LAMBDA_TARGET: &str = "Target Lambda";
    pub const IGN: &str = "Ignition Angle";
    pub const KNOCK: &str = "Knock Sensor 1 Knock Signal";
    pub const KNOCK_THRESHOLD: &str = "Knock Threshold";
    pub const KNOCK_COUNT: &str = "Knock Sensor 1 Knock Count";
    pub const DUTY: &str = "Injection Stage 1 Average Duty Cycle";
    pub const IAT: &str = "Intake Air Temperature";
    pub const ECT: &str = "Coolant Temperature";
    pub const ETHANOL: &str = "Flex Fuel Sensor";
    pub const FUEL_FLOW: &str = "Fuel Mass Flow";
    pub const STFT: &str = "O2 Control Bank 1 Short Term Fuel Trim";
    pub const LTFT: &str = "O2 Control Bank 1 Long Term Fuel Trim";
    pub const IDLE_TARGET: &str = "Idle Control target RPM";
    pub const CAM: &str = "Cam Control Intake 1 Angle";
    pub const CAM_TARGET: &str = "Cam Control Intake Target Angle";

    // used only by the detectors
    pub const O2_TARGET: &str = "O2 Control Bank 1 Target";
    pub const IDLE_STATE: &str = "Idle Control State";
    pub const IDLE_OUT: &str = "Idle Control Output";
    pub const IDLE_BASE: &str = "Idle Control Base Output";
    pub const IDLE_P: &str = "Idle Control Proportional Output";
    pub const IDLE_I: &str = "Idle Control Integral Output";
    pub const IDLE_KP: &str = "Idle Control Proportional Gain";
    pub const IDLE_KI: &str = "Idle Control Integral Gain";
    pub const IDLE_KD: &str = "Idle Control Derivative Gain";
    pub const IDLE_IGN: &str = "Idle Control Ignition Correction";
    pub const DBW_OFFSET: &str = "Idle Control DBW Offset";
    pub const DECEL: &str = "Decel Detected";
    pub const DECEL_MIN: &str = "Decel Min RPM";
    pub const CAM_KP: &str = "Cam Control Intake Proportional Gain";
    pub const CAM_KI: &str = "Cam Control Intake Integral Gain";
    pub const CAM_KD: &str = "Cam Control Intake Derivative Gain";
}

/// One column of raw integers as NSP wrote them. Channels that never change are stored once.
#[derive(Clone, Debug)]
pub enum Col {
    Const(f64),
    Series(Vec<f64>),
}

/// A parsed log before unit conversion.
#[derive(Clone, Debug)]
pub struct RawLog {
    pub name: String,
    pub start: String,
    /// the log's start as a local date and time with no zone, `2026-04-17T13:45:37`; None when the log does not say
    pub started_at: Option<String>,
    pub names: Vec<String>,
    pub types: Vec<String>,
    /// per channel, the header's `DisplayMaxMin` as [min, max] in raw units; None when the header gives none
    pub ranges: Vec<Option<[f64; 2]>>,
    /// milliseconds from the first row
    pub t_ms: Vec<f64>,
    pub cols: Vec<Col>,
}

fn tsec(s: &str) -> f64 {
    let mut p = s.split(':');
    let h: f64 = p.next().and_then(|x| x.parse().ok()).unwrap_or(f64::NAN);
    let m: f64 = p.next().and_then(|x| x.parse().ok()).unwrap_or(f64::NAN);
    let sec: f64 = p.next().and_then(|x| x.parse().ok()).unwrap_or(f64::NAN);
    h * 3600.0 + m * 60.0 + sec
}

fn starts_with_clock(l: &str) -> bool {
    let b = l.as_bytes();
    b.len() >= 8
        && b[0].is_ascii_digit()
        && b[1].is_ascii_digit()
        && b[2] == b':'
        && b[3].is_ascii_digit()
        && b[4].is_ascii_digit()
        && b[5] == b':'
        && b[6].is_ascii_digit()
        && b[7].is_ascii_digit()
}

fn cell(s: Option<&str>) -> f64 {
    match s {
        None => f64::NAN,
        Some(x) => {
            let x = x.trim();
            if x.is_empty() {
                0.0
            } else {
                x.parse().unwrap_or(f64::NAN)
            }
        }
    }
}

/// The log's start as a local date and time with no zone, `2026-04-17T13:45:37`. The date is the first part of the
/// `Log :` header line (`20260417`); the time of day is the first row's clock, which is 24-hour (`13:45:37.026`). The
/// header's own time is 12-hour with no am or pm, so it is not used. None when the date is not eight digits that make a
/// month and a day, or the clock is not a time of day.
fn local_start(header: &str, first_row: &str) -> Option<String> {
    let date = header.split_whitespace().next()?;
    let clock = first_row.get(..8)?;
    if date.len() != 8 || !date.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let num = |s: &str| s.parse::<u32>().ok();
    let (month, day) = (num(&date[4..6])?, num(&date[6..8])?);
    let (h, m, s) = (num(&clock[..2])?, num(&clock[3..5])?, num(&clock[6..8])?);
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) || h > 23 || m > 59 || s > 59 {
        return None;
    }
    Some(format!(
        "{}-{}-{}T{clock}",
        &date[..4],
        &date[4..6],
        &date[6..8]
    ))
}

/// `DisplayMaxMin : max,min` as [min, max]. None when it is not two numbers.
fn display_range(val: &str) -> Option<[f64; 2]> {
    let (max, min) = val.split_once(',')?;
    Some([min.trim().parse().ok()?, max.trim().parse().ok()?])
}

/// Parse a Haltech NSP "PCLog" CSV export, keeping every channel.
pub fn parse_nsp_csv(text: &str, name: &str) -> Result<RawLog, String> {
    if !text.starts_with("%DataLog%") {
        return Err("Not an NSP datalog export: the file does not start with %DataLog%.".into());
    }
    let mut names: Vec<String> = Vec::new();
    let mut types: Vec<String> = Vec::new();
    let mut ranges: Vec<Option<[f64; 2]>> = Vec::new();
    let mut start = String::new();
    let mut lines = text.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l));
    let mut first_row: Option<&str> = None;
    for l in lines.by_ref() {
        if starts_with_clock(l) {
            first_row = Some(l);
            break;
        }
        let Some(k) = l.find(" : ") else { continue };
        let (key, val) = (&l[..k], &l[k + 3..]);
        match key {
            "Channel" => {
                names.push(val.to_string());
                types.push("Raw".to_string());
                ranges.push(None);
            }
            "Type" => {
                if let Some(last) = types.last_mut() {
                    *last = val.to_string();
                }
            }
            "DisplayMaxMin" => {
                if let Some(last) = ranges.last_mut() {
                    *last = display_range(val);
                }
            }
            "Log" => start = val.to_string(),
            _ => {}
        }
    }
    let started_at = first_row.and_then(|row| local_start(&start, row));
    let rows: Vec<&str> = first_row
        .into_iter()
        .chain(lines)
        .filter(|l| !l.is_empty())
        .collect();
    if rows.is_empty() {
        return Err("The log has no data rows.".into());
    }
    let n = rows.len();
    let mut t_ms = Vec::with_capacity(n);
    let mut data: Vec<Vec<f64>> = (0..names.len()).map(|_| Vec::with_capacity(n)).collect();
    let mut t0 = f64::NAN;
    for (r, row) in rows.iter().enumerate() {
        let mut it = row.split(',');
        let mut ts = tsec(it.next().unwrap_or(""));
        if r == 0 {
            t0 = ts;
        }
        if ts < t0 {
            ts += 86_400.0;
        }
        t_ms.push(js_round((ts - t0) * 1000.0));
        for col in data.iter_mut() {
            col.push(cell(it.next()));
        }
    }
    let cols = data
        .into_iter()
        .map(|a| {
            if a.iter().all(|&v| v == a[0]) {
                Col::Const(a[0])
            } else {
                Col::Series(a)
            }
        })
        .collect();
    Ok(RawLog {
        name: name.to_string(),
        start,
        started_at,
        names,
        types,
        ranges,
        t_ms,
        cols,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_declared_range_is_kept_with_its_channel() {
        let text = "%DataLog%\n\
            Channel : RPM\nID : 1\nType : EngineSpeed\nDisplayMaxMin : 20000,0\n\
            Channel : No range\nID : 2\nType : Raw\n\
            Channel : Error\nID : 3\nType : Raw\nDisplayMaxMin : 4096,-4096\n\
            Channel : Not numbers\nID : 4\nType : Raw\nDisplayMaxMin : high,low\n\
            12:00:00.000,3000,0,1,0\n";
        let raw = parse_nsp_csv(text, "t.csv").unwrap();
        // NSP writes the maximum first; the range is kept as [min, max]
        assert_eq!(
            raw.ranges,
            [Some([0.0, 20000.0]), None, Some([-4096.0, 4096.0]), None]
        );
    }

    #[test]
    fn the_start_is_the_header_date_and_the_first_rows_clock() {
        let row = "13:45:37.026,3000";
        assert_eq!(
            local_start("20260417 01:45:37", row).as_deref(),
            Some("2026-04-17T13:45:37")
        );
        // the header's time is not needed
        assert_eq!(
            local_start("20260417", row).as_deref(),
            Some("2026-04-17T13:45:37")
        );
        // a date that is not eight digits, or not a month and a day
        for header in [
            "",
            "2026417 01:45:37",
            "2026-04-17 01:45:37",
            "20261317 01:45:37",
            "20260400 01:45:37",
        ] {
            assert_eq!(local_start(header, row), None, "{header:?}");
        }
        // a clock that is not a time of day
        assert_eq!(local_start("20260417", "24:00:00.000,3000"), None);
        assert_eq!(local_start("20260417", "12:60:00.000,3000"), None);
    }
}

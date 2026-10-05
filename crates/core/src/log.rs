//! A loaded log: time base, every channel on demand in engineering units, and the key channels the analysis reads.

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::haltech::{name, to_eng, Col, RawLog};
use crate::switches::Group;

/// Key channels in engineering units. A channel the log does not have is all NaN.
pub struct Ch {
    pub rpm: Vec<f64>,
    pub gear: Vec<f64>,
    pub vss: Vec<f64>,
    pub drv: Vec<f64>,
    pub und: Vec<f64>,
    pub pedal: Vec<f64>,
    pub tps: Vec<f64>,
    pub map: Vec<f64>,
    pub baro: Vec<f64>,
    pub lam: Vec<f64>,
    pub lam_t: Vec<f64>,
    pub ign: Vec<f64>,
    pub knk: Vec<f64>,
    pub knk_t: Vec<f64>,
    pub knk_n: Vec<f64>,
    pub duty: Vec<f64>,
    pub ect: Vec<f64>,
    pub eth: Vec<f64>,
    pub fuel: Vec<f64>,
    pub stft: Vec<f64>,
    pub ltft: Vec<f64>,
    pub idle_t: Vec<f64>,
    pub cam: Vec<f64>,
    pub cam_t: Vec<f64>,
}

pub struct Log {
    pub name: String,
    pub start: String,
    /// identity of a log across sessions: file name plus the log's own start stamp
    pub key: String,
    pub n: usize,
    /// seconds from the first sample
    pub t: Vec<f64>,
    pub hz: f64,
    pub names: Vec<String>,
    pub types: Vec<String>,
    /// per channel, the range the log's header declares, as [min, max] in engineering units; None when it declares none.
    /// A bound written as the ECU's no-reading value is NaN, and means wider than anything: a rule that reads a range must
    /// be false for NaN (`width <= limit`, not `!(width > limit)`). Time Since Engine Limiter declares `2147483647,-1` in
    /// every sample log and is held as [-0.001, NaN].
    pub ranges: Vec<Option<[f64; 2]>>,
    pub cols: Vec<Col>,
    pub ch: Ch,
    index: HashMap<String, usize>,
    scaled: Vec<OnceLock<Vec<f64>>>,
    nan: Vec<f64>,
    pub(crate) states: OnceLock<Vec<String>>,
    /// the on/off channels, grouped into signals, found on first use
    pub(crate) switches: OnceLock<Vec<Group>>,
}

fn scale(col: &Col, ty: &str, n: usize) -> Vec<f64> {
    let conv = to_eng(ty);
    match col {
        Col::Const(c) => vec![conv(*c); n],
        Col::Series(a) => a.iter().map(|&v| conv(v)).collect(),
    }
}

impl Log {
    pub fn from_raw(raw: RawLog) -> Result<Log, String> {
        let n = raw.t_ms.len();
        let t: Vec<f64> = raw.t_ms.iter().map(|ms| ms / 1000.0).collect();
        let index: HashMap<String, usize> = raw
            .names
            .iter()
            .enumerate()
            .map(|(i, nm)| (nm.clone(), i))
            .collect();
        if !index.contains_key(name::RPM) || !index.contains_key(name::VSS) {
            return Err("This log has no RPM or Vehicle Speed channel.".into());
        }
        let mut dts: Vec<f64> = t.windows(2).map(|w| w[1] - w[0]).collect();
        dts.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let hz = if dts.is_empty() {
            0.0
        } else {
            1.0 / dts[dts.len() >> 1]
        };
        let get = |nm: &str| -> Vec<f64> {
            match index.get(nm) {
                Some(&j) => scale(&raw.cols[j], &raw.types[j], n),
                None => vec![f64::NAN; n],
            }
        };
        let pedal = if index.contains_key(name::PEDAL) {
            get(name::PEDAL)
        } else {
            get(name::TPS)
        };
        let ch = Ch {
            rpm: get(name::RPM),
            gear: get(name::GEAR),
            vss: get(name::VSS),
            drv: get(name::DRIVEN),
            und: get(name::UNDRIVEN),
            pedal,
            tps: get(name::TPS),
            map: get(name::MAP),
            baro: get(name::BARO),
            lam: get(name::LAMBDA),
            lam_t: get(name::LAMBDA_TARGET),
            ign: get(name::IGN),
            knk: get(name::KNOCK),
            knk_t: get(name::KNOCK_THRESHOLD),
            knk_n: get(name::KNOCK_COUNT),
            duty: get(name::DUTY),
            ect: get(name::ECT),
            eth: get(name::ETHANOL),
            fuel: get(name::FUEL_FLOW),
            stft: get(name::STFT),
            ltft: get(name::LTFT),
            idle_t: get(name::IDLE_TARGET),
            cam: get(name::CAM),
            cam_t: get(name::CAM_TARGET),
        };
        let ranges = (raw.ranges.iter().zip(&raw.types))
            .map(|(range, ty)| {
                let conv = to_eng(ty);
                range.map(|[min, max]| [conv(min), conv(max)])
            })
            .collect();
        Ok(Log {
            key: format!("{}|{}", raw.name, raw.start),
            name: raw.name,
            start: raw.start,
            n,
            t,
            hz,
            scaled: (0..raw.names.len()).map(|_| OnceLock::new()).collect(),
            nan: vec![f64::NAN; n],
            names: raw.names,
            types: raw.types,
            ranges,
            cols: raw.cols,
            ch,
            index,
            states: OnceLock::new(),
            switches: OnceLock::new(),
        })
    }

    pub fn has(&self, name: &str) -> bool {
        self.index.contains_key(name)
    }

    pub fn index_of(&self, name: &str) -> Option<usize> {
        self.index.get(name).copied()
    }

    /// A channel by NSP name in engineering units.
    pub fn chan(&self, name: &str) -> Option<&[f64]> {
        let j = *self.index.get(name)?;
        Some(self.chan_at(j))
    }

    pub fn chan_at(&self, j: usize) -> &[f64] {
        self.scaled[j].get_or_init(|| scale(&self.cols[j], &self.types[j], self.n))
    }

    /// Like `chan`, but all NaN when the log does not have the channel.
    pub fn x(&self, name: &str) -> &[f64] {
        self.chan(name).unwrap_or(&self.nan)
    }

    pub fn is_const(&self, j: usize) -> bool {
        matches!(self.cols[j], Col::Const(_))
    }

    pub fn duration(&self) -> f64 {
        if self.n == 0 {
            0.0
        } else {
            self.t[self.n - 1] - self.t[0]
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Log;
    use crate::haltech::parse_nsp_csv;

    #[test]
    fn a_declared_range_is_scaled_like_the_samples() {
        let text = "%DataLog%\n\
            Channel : RPM\nType : EngineSpeed\nDisplayMaxMin : 20000,0\n\
            Channel : Vehicle Speed\nType : Speed\nDisplayMaxMin : 4000,0\n\
            Channel : Brake Pedal State\nType : Raw\nDisplayMaxMin : 2,0\n\
            Channel : Fuel Composition\nType : Percentage\nDisplayMaxMin : 1000,0\n\
            Channel : Memory Writes Pending\nType : Raw\n\
            12:00:00.000,3000,0,0,500,0\n";
        let log = Log::from_raw(parse_nsp_csv(text, "t.csv").unwrap()).unwrap();
        assert_eq!(
            log.ranges,
            [
                Some([0.0, 20000.0]),
                Some([0.0, 400.0]),
                Some([0.0, 2.0]),
                Some([0.0, 100.0]),
                None
            ]
        );
    }

    /// Time Since Engine Limiter declares `2147483647,-1` in every sample log. Its maximum is the ECU's no-reading value.
    #[test]
    fn a_bound_at_the_no_reading_value_is_not_a_number() {
        let text = "%DataLog%\n\
            Channel : RPM\nType : EngineSpeed\nDisplayMaxMin : 20000,0\n\
            Channel : Vehicle Speed\nType : Speed\nDisplayMaxMin : 4000,0\n\
            Channel : Time Since Engine Limiter\nType : Time_ms_as_s\nDisplayMaxMin : 2147483647,-1\n\
            12:00:00.000,3000,0,0\n";
        let log = Log::from_raw(parse_nsp_csv(text, "t.csv").unwrap()).unwrap();
        let [min, max] = log.ranges[2].unwrap();
        assert_eq!(min, -0.001);
        assert!(max.is_nan(), "{max}");
    }
}

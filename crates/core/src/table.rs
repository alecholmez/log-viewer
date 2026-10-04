//! Tables built from logs: every sample binned onto an RPM × MAP grid.

use serde::Serialize;

use crate::log::Log;

/// Which samples count toward the fuel table.
pub struct FuelRules {
    /// s, wideband transport delay
    pub delay: f64,
    /// kPa/s, MAP must be changing slower than this
    pub d_map: f64,
    /// %/s, throttle must be moving slower than this
    pub d_tps: f64,
    /// s, wait after any fuel cut
    pub cut_wait: f64,
    /// °C, minimum coolant temperature
    pub min_ect: f64,
    pub min_samples: f64,
}

pub const FUEL_RULES: FuelRules = FuelRules {
    delay: 0.15,
    d_map: 40.0,
    d_tps: 50.0,
    cut_wait: 1.0,
    min_ect: 70.0,
    min_samples: 8.0,
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Table {
    pub rpm_ax: Vec<f64>,
    pub map_ax: Vec<f64>,
    /// mean logged ignition advance per cell, [map][rpm], NaN where empty
    pub ign: Vec<Vec<f64>>,
    /// correction the base fuel table needs per cell in percent, positive adds fuel
    pub fuel: Vec<Vec<f64>>,
    pub cnt: Vec<Vec<f64>>,
    pub fcnt: Vec<Vec<f64>>,
}

fn nearest(ax: &[f64], v: f64) -> usize {
    let (mut best, mut d) = (0, 1e9);
    for (i, a) in ax.iter().enumerate() {
        let e = (a - v).abs();
        if e < d {
            d = e;
            best = i;
        }
    }
    best
}

pub fn bin_table(logs: &[Log], rpm_ax: &[f64], map_ax: &[f64]) -> Table {
    let (nr, nm) = (rpm_ax.len(), map_ax.len());
    let mk = || vec![vec![0.0f64; nr]; nm];
    let (mut cnt, mut ign, mut fsum, mut fcnt) = (mk(), mk(), mk(), mk());
    let r = &FUEL_RULES;
    for log in logs {
        let (c, t, n) = (&log.ch, &log.t, log.n);
        let mut last_cut = -99.0;
        for i in 0..n {
            if !(c.duty[i] > 0.5) {
                last_cut = t[i];
            }
            if !(c.rpm[i] > 400.0) || c.map[i].is_nan() {
                continue;
            }
            let (ri, mi) = (nearest(rpm_ax, c.rpm[i]), nearest(map_ax, c.map[i]));
            cnt[mi][ri] += 1.0;
            ign[mi][ri] += c.ign[i];
            // fuel: steady state only
            if !(c.duty[i] > 0.5) || !(c.ect[i] >= r.min_ect) || t[i] - last_cut < r.cut_wait {
                continue;
            }
            let (a, b) = (i.saturating_sub(2), (i + 2).min(n - 1));
            let mut dt = t[b] - t[a];
            if dt == 0.0 || dt.is_nan() {
                dt = 1.0;
            }
            if ((c.map[b] - c.map[a]) / dt).abs() > r.d_map
                || ((c.tps[b] - c.tps[a]) / dt).abs() > r.d_tps
            {
                continue;
            }
            let mut j = i;
            while j < n - 1 && t[j] - t[i] < r.delay {
                j += 1;
            }
            let lam = c.lam[j];
            if !(lam > 0.6 && lam < 1.3) || !(c.lam_t[i] > 0.5) {
                continue;
            }
            let st = if c.stft[i].is_nan() { 0.0 } else { c.stft[i] };
            let lt = if c.ltft[i].is_nan() { 0.0 } else { c.ltft[i] };
            fsum[mi][ri] +=
                (lam / c.lam_t[i] * (1.0 + st / 100.0) * (1.0 + lt / 100.0) - 1.0) * 100.0;
            fcnt[mi][ri] += 1.0;
        }
    }
    let (mut ign_out, mut fuel_out) = (mk(), mk());
    for m in 0..nm {
        for k in 0..nr {
            ign_out[m][k] = if cnt[m][k] >= 3.0 {
                ign[m][k] / cnt[m][k]
            } else {
                f64::NAN
            };
            fuel_out[m][k] = if fcnt[m][k] >= r.min_samples {
                fsum[m][k] / fcnt[m][k]
            } else {
                f64::NAN
            };
        }
    }
    Table {
        rpm_ax: rpm_ax.to_vec(),
        map_ax: map_ax.to_vec(),
        ign: ign_out,
        fuel: fuel_out,
        cnt,
        fcnt,
    }
}

/// 500 rpm × 20 kPa and 250 rpm × 10 kPa axes over 500–6,500 rpm and 20–180 kPa.
pub fn axes(fine: bool) -> (Vec<f64>, Vec<f64>) {
    let (rs, ms) = if fine { (250.0, 10.0) } else { (500.0, 20.0) };
    let range = |a: f64, b: f64, s: f64| -> Vec<f64> {
        (0..=((b - a) / s).round() as usize)
            .map(|i| a + i as f64 * s)
            .collect()
    };
    (range(500.0, 6500.0, rs), range(20.0, 180.0, ms))
}

//! Number formatting for finding text. Matches the prototype's output character for character,
//! which is what lets the golden test compare findings as plain strings.

/// Round half up, like JavaScript's `Math.round`.
pub fn js_round(x: f64) -> f64 {
    (x + 0.5).floor()
}

fn group(n: i64) -> String {
    let digits = n.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(c);
    }
    if n < 0 {
        format!("-{out}")
    } else {
        out
    }
}

/// Whole number with thousands separators: 5224.3 -> "5,224".
pub fn n0(v: f64) -> String {
    if v.is_nan() {
        return "–".into();
    }
    group(js_round(v) as i64)
}

/// Fixed decimals: fx(0.874, 2) -> "0.87". Exact ties round away from zero, as `toFixed` does.
pub fn fx(v: f64, d: usize) -> String {
    if v.is_nan() {
        return "–".into();
    }
    let plain = format!("{:.*}", d, v);
    let long = format!("{:.*}", d + 25, v.abs());
    let dot = long.find('.').unwrap_or(long.len());
    let tail = &long.as_bytes()[dot + 1 + d..];
    let tie = tail[0] == b'5' && tail[1..].iter().all(|&b| b == b'0');
    if !tie {
        return plain;
    }
    let scale = 10f64.powi(d as i32);
    let up = format!("{:.*}", d, ((v.abs() * scale).floor() + 1.0) / scale);
    if v < 0.0 {
        format!("-{up}")
    } else {
        up
    }
}

/// Signed with a typographic minus: sgn(-14.7, 1) -> "−14.7".
pub fn sgn(v: f64, d: usize) -> String {
    format!("{}{}", if v >= 0.0 { "+" } else { "−" }, fx(v.abs(), d))
}

/// A number the way JavaScript prints it when concatenated: integers without a decimal point.
pub fn num(v: f64) -> String {
    if v.is_nan() {
        "NaN".into()
    } else if v.fract() == 0.0 && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_like_the_prototype() {
        assert_eq!(n0(5224.3), "5,224");
        assert_eq!(n0(1191.5), "1,192");
        assert_eq!(n0(-5.0), "-5");
        assert_eq!(fx(0.874, 2), "0.87");
        assert_eq!(fx(2.5, 0), "3");
        assert_eq!(fx(0.125, 2), "0.13");
        assert_eq!(fx(-0.04, 1), "-0.0");
        assert_eq!(sgn(-14.66, 1), "−14.7");
        assert_eq!(sgn(0.8, 1), "+0.8");
        assert_eq!(num(-5.0), "-5");
        assert_eq!(num(12.5), "12.5");
    }
}

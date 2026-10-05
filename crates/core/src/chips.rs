//! The replay's chips for a span: the switches and the states that change in it, each kind cut at its own limit.

use serde::Serialize;

use crate::log::Log;
use crate::states::{states, StateRows, MAX_STATES};
use crate::switches::{switches, Rows, MAX_SWITCHES};

/// What the chips show for a span. Each kind counts its own chips left out.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Chips {
    pub switches: Rows,
    pub states: StateRows,
}

/// The switches and the states that change between `t0` and `t1` (log seconds, both ends included).
pub fn chips(log: &Log, t0: f64, t1: f64) -> Chips {
    Chips {
        switches: switches(log, t0, t1, MAX_SWITCHES),
        states: states(log, t0, t1, MAX_STATES),
    }
}

//! Log Viewer core: ECU log parsing and analysis.
//!
//! - `haltech`: the Haltech NSP export format, unit scaling and channel names. Other ECUs get a module beside it.
//! - `log`: a loaded log with every channel available in engineering units.
//! - `dyno`: pull detection and the virtual dyno.
//! - `table`: ignition and fuel-correction tables binned from the logs.
//! - `findings`: what is wrong, why it matters, and what to change.
//! - `span`: what switches and states share: a channel traced over the log, the span on screen, the limit.
//! - `switches`: on/off channels, which of them are one signal, and what they do in a span.
//! - `states`: channels that hold one of a few whole-number readings, such as Gear.
//! - `chips`: the replay's chips for a span: switches and states.
//! - `session`: app state and the single `dispatch` entry point the shells call.

// `!(x > 0.5)` is used on purpose throughout: it is also true when x is NaN (a missing sample), which `x <= 0.5` is not.
#![allow(clippy::neg_cmp_op_on_partial_ord)]

pub mod chips;
pub mod dyno;
pub mod findings;
pub mod fmt;
pub mod haltech;
pub mod log;
pub mod session;
mod span;
pub mod states;
pub mod stats;
pub mod switches;
pub mod table;

pub use session::{Reply, Session};

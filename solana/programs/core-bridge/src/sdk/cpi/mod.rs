mod post_message_v1;
pub use post_message_v1::*;

mod prepare_message_v1;
pub use prepare_message_v1::*;

use anchor_lang::prelude::*;

pub trait InvokeCoreBridge<'info> {
    fn core_bridge_program(&self) -> AccountInfo<'info>;
}

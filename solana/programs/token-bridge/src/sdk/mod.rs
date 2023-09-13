//! **ATTENTION INTEGRATORS!** Token Bridge Program developer kit. It is recommended to use
//! [sdk::cpi](crate::sdk::cpi) for invoking Token Bridge instructions as opposed to the
//! code-generated Anchor CPI (found in [cpi](crate::cpi)) and legacy CPI (found in
//! [legacy::cpi](crate::legacy::cpi)).

pub use core_bridge_program::sdk as core_bridge_sdk;

pub use crate::{
    constants::{PROGRAM_REDEEMER_SEED_PREFIX, PROGRAM_SENDER_SEED_PREFIX},
    legacy::instruction::{TransferTokensArgs, TransferTokensWithPayloadArgs},
    state, zero_copy,
};

pub mod accounts {
    //! Set of structs mirroring the structs deriving Accounts, where each field is a Pubkey. This
    //! is useful for specifying accounts for a client.

    pub use crate::{accounts::*, legacy::accounts::*};
}

/// CPI builders. Methods useful for interacting with the Token Bridge program from another program.
#[cfg(feature = "cpi")]
pub mod cpi;

pub mod instruction {
    //! Instruction builders. These should be used directly when one wants to serialize instruction
    //! data when speciying instructions on a client.
    pub use crate::{accounts, instruction::*, legacy::instruction as legacy};
}

/// The program ID of the Token Bridge program.
pub static PROGRAM_ID: anchor_lang::prelude::Pubkey = crate::ID;
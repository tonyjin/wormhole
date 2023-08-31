use crate::{
    constants::EMITTER_SEED_PREFIX, legacy::LegacyAttestTokenArgs,
    processor::post_token_bridge_message, zero_copy::Mint,
};
use anchor_lang::prelude::*;
use anchor_spl::metadata;
use core_bridge_program::{
    self, constants::SOLANA_CHAIN, state::Config as CoreBridgeConfig, CoreBridge,
};

#[derive(Accounts)]
pub struct AttestToken<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// CHECK: Token Bridge never needed this account for this instruction.
    _config: UncheckedAccount<'info>,

    /// CHECK: Native mint. We ensure this mint is not one that has originated from a foreign
    /// network in access control.
    mint: AccountInfo<'info>,

    /// CHECK: Token Bridge never needed this account for this instruction.
    _native_asset: UncheckedAccount<'info>,

    /// We derive this PDA because we do not involve the Token Metadata program with this
    /// instruction handler. It is the Token Bridge's job to verify that the metadata attested for
    /// is the correct one.
    #[account(
        seeds = [
            b"metadata",
            metadata::Metadata::id().as_ref(),
            mint.key().as_ref()
        ],
        bump,
        seeds::program = metadata::Metadata::id()
    )]
    token_metadata: Box<Account<'info, metadata::MetadataAccount>>,

    /// We need to deserialize this account to determine the Wormhole message fee. We do not have to
    /// check the seeds here because the Core Bridge program will do this for us.
    #[account(mut)]
    core_bridge_config: Box<Account<'info, CoreBridgeConfig>>,

    /// CHECK: This account is needed for the Core Bridge program.
    #[account(mut)]
    core_message: Signer<'info>,

    /// CHECK: We need this emitter to invoke the Core Bridge program to send Wormhole messages.
    #[account(
        seeds = [EMITTER_SEED_PREFIX],
        bump,
    )]
    core_emitter: AccountInfo<'info>,

    /// CHECK: This account is needed for the Core Bridge program.
    #[account(mut)]
    core_emitter_sequence: UncheckedAccount<'info>,

    /// CHECK: This account is needed for the Core Bridge program.
    #[account(mut)]
    core_fee_collector: Option<UncheckedAccount<'info>>,

    /// CHECK: Previously needed sysvar.
    _clock: UncheckedAccount<'info>,

    /// CHECK: Previously needed sysvar.
    _rent: UncheckedAccount<'info>,

    system_program: Program<'info, System>,
    core_bridge_program: Program<'info, CoreBridge>,
}

impl<'info> core_bridge_program::sdk::cpi::InvokeCoreBridge<'info> for AttestToken<'info> {
    fn core_bridge_program(&self) -> AccountInfo<'info> {
        self.core_bridge_program.to_account_info()
    }
}

impl<'info> core_bridge_program::sdk::cpi::InvokePostMessageV1<'info> for AttestToken<'info> {
    fn payer(&self) -> AccountInfo<'info> {
        self.payer.to_account_info()
    }

    fn config(&self) -> AccountInfo<'info> {
        self.core_bridge_config.to_account_info()
    }

    fn message(&self) -> AccountInfo<'info> {
        self.core_message.to_account_info()
    }

    fn emitter(&self) -> AccountInfo<'info> {
        self.core_emitter.to_account_info()
    }

    fn emitter_sequence(&self) -> AccountInfo<'info> {
        self.core_emitter_sequence.to_account_info()
    }

    fn fee_collector(&self) -> Option<AccountInfo<'info>> {
        self.core_fee_collector
            .as_ref()
            .map(|acc| acc.to_account_info())
    }

    fn system_program(&self) -> AccountInfo<'info> {
        self.system_program.to_account_info()
    }
}

impl<'info> AttestToken<'info> {
    fn constraints(ctx: &Context<Self>) -> Result<()> {
        // Make sure the mint authority is not the Token Bridge's. If it is, then this mint
        // originated from a foreign network.
        crate::utils::require_native_mint(&ctx.accounts.mint)
    }
}

#[access_control(AttestToken::constraints(&ctx))]
pub fn attest_token(ctx: Context<AttestToken>, args: LegacyAttestTokenArgs) -> Result<()> {
    let LegacyAttestTokenArgs { nonce } = args;

    let metadata = &ctx.accounts.token_metadata.data;
    let decimals = Mint::parse(&ctx.accounts.mint.data.borrow())
        .unwrap()
        .decimals();

    // Finally post Wormhole message via Core Bridge.
    post_token_bridge_message(
        ctx.accounts,
        ctx.bumps["core_emitter"],
        nonce,
        crate::messages::Attestation {
            token_address: ctx.accounts.mint.key().to_bytes(),
            token_chain: SOLANA_CHAIN,
            decimals,
            symbol: string_to_fixed32(&metadata.symbol),
            name: string_to_fixed32(&metadata.name),
        },
    )
}

pub(crate) fn string_to_fixed32(s: &String) -> [u8; 32] {
    let mut bytes = [0; 32];
    if s.len() > 32 {
        bytes.copy_from_slice(&s.as_bytes()[..32]);
    } else {
        bytes[..s.len()].copy_from_slice(s.as_bytes());
    }
    bytes
}

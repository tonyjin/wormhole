use crate::{
    constants::{MAX_DECIMALS, MINT_AUTHORITY_SEED_PREFIX, WRAPPED_MINT_SEED_PREFIX},
    error::TokenBridgeError,
    legacy::EmptyArgs,
    state::{Claim, RegisteredEmitter, WrappedAsset},
};
use anchor_lang::prelude::*;
use anchor_spl::{metadata, token};
use core_bridge_program::{self, constants::SOLANA_CHAIN, zero_copy::PostedVaaV1, CoreBridge};
use mpl_token_metadata::state::DataV2;
use wormhole_raw_vaas::token_bridge::{Attestation, TokenBridgeMessage};
use wormhole_solana_common::SeedPrefix;

#[derive(Accounts)]
pub struct CreateOrUpdateWrapped<'info> {
    #[account(mut)]
    payer: Signer<'info>,

    /// CHECK: Token Bridge never needed this account for this instruction.
    _config: UncheckedAccount<'info>,

    /// This account is a foreign token Bridge and is created via the Register Chain governance
    /// decree.
    ///
    /// NOTE: The seeds of this account are insane because they include the emitter address, which
    /// allows registering multiple emitter addresses for the same chain ID. These seeds are not
    /// checked via Anchor macro, but will be checked in the access control function instead.
    ///
    /// See the `require_valid_token_bridge_posted_vaa` instruction handler for more details.
    registered_emitter: Account<'info, RegisteredEmitter>,

    /// CHECK: We will be performing zero-copy deserialization in the instruction handler.
    #[account(
        seeds = [
            PostedVaaV1::SEED_PREFIX,
            PostedVaaV1::parse(&posted_vaa.try_borrow_data()?)?.message_hash().as_ref()
        ],
        bump,
        seeds::program = core_bridge_program
    )]
    posted_vaa: AccountInfo<'info>,

    #[account(
        init,
        payer = payer,
        space = Claim::INIT_SPACE,
        seeds = [
            PostedVaaV1::parse(&posted_vaa.try_borrow_data()?)?.emitter_address().as_ref(),
            PostedVaaV1::parse(&posted_vaa.try_borrow_data()?)?.emitter_chain().to_be_bytes().as_ref(),
            PostedVaaV1::parse(&posted_vaa.try_borrow_data()?)?.sequence().to_be_bytes().as_ref(),
        ],
        bump,
    )]
    claim: Account<'info, Claim>,

    /// CHECK: To avoid multiple borrows to the posted vaa account to generate seeds and other mint
    /// parameters, we perform these checks outside of this accounts context. The pubkey for this
    /// wrapped mint is checked in access control and the account is created in the instruction
    /// handler.
    #[account(
        init_if_needed,
        payer = payer,
        mint::decimals = try_attestation_decimals(&posted_vaa.try_borrow_data()?)?,
        mint::authority = mint_authority,
        seeds = [
            WRAPPED_MINT_SEED_PREFIX,
            &try_attestation_token_chain(&posted_vaa.try_borrow_data()?)?.to_be_bytes(),
            try_attestation_token_address(&posted_vaa.try_borrow_data()?)?.as_ref(),
        ],
        bump,
    )]
    wrapped_mint: Box<Account<'info, token::Mint>>,

    #[account(
        init_if_needed,
        payer = payer,
        space = WrappedAsset::INIT_SPACE,
        seeds = [WrappedAsset::SEED_PREFIX, wrapped_mint.key().as_ref()],
        bump,
    )]
    wrapped_asset: Account<'info, WrappedAsset>,

    /// CHECK: This account is managed by the MPL Token Metadata program. But we still want to
    /// verify the PDA address because we will deserialize this account once it exists to determine
    /// whether we need to update metadata based on the new VAA (before passing this account into
    /// the update metadata instruction).
    #[account(
        mut,
        seeds = [
            b"metadata",
            mpl_token_metadata_program.key().as_ref(),
            wrapped_mint.key().as_ref(),
        ],
        bump,
        seeds::program = mpl_token_metadata_program,
    )]
    token_metadata: AccountInfo<'info>,

    /// CHECK: This account is the authority that can burn and mint wrapped assets.
    #[account(
        seeds = [MINT_AUTHORITY_SEED_PREFIX],
        bump,
    )]
    mint_authority: AccountInfo<'info>,

    /// CHECK: Rent is needed for the MPL Token Metadata program.
    rent: UncheckedAccount<'info>,

    core_bridge_program: Program<'info, CoreBridge>,
    system_program: Program<'info, System>,
    token_program: Program<'info, token::Token>,
    mpl_token_metadata_program: Program<'info, metadata::Metadata>,
}

fn try_attestation_decimals(vaa_acc_data: &[u8]) -> Result<u8> {
    let vaa = PostedVaaV1::parse(vaa_acc_data)?;
    let msg = TokenBridgeMessage::parse(vaa.payload())
        .map_err(|_| TokenBridgeError::InvalidTokenBridgePayload)?;
    msg.attestation()
        .map(|attestation| cap_decimals(attestation.decimals()))
        .ok_or(error!(TokenBridgeError::InvalidTokenBridgeVaa))
}

fn try_attestation_token_chain(vaa_acc_data: &[u8]) -> Result<u16> {
    let vaa = PostedVaaV1::parse(vaa_acc_data)?;
    let msg = TokenBridgeMessage::parse(vaa.payload())
        .map_err(|_| TokenBridgeError::InvalidTokenBridgePayload)?;

    let token_chain = msg
        .attestation()
        .map(|attestation| attestation.token_chain())
        .ok_or(error!(TokenBridgeError::InvalidTokenBridgeVaa))?;

    // This token must have originated from another network.
    require_neq!(token_chain, SOLANA_CHAIN, TokenBridgeError::NativeAsset);

    // Done.
    Ok(token_chain)
}

fn try_attestation_token_address(vaa_acc_data: &[u8]) -> Result<[u8; 32]> {
    let vaa = PostedVaaV1::parse(vaa_acc_data)?;
    let msg = TokenBridgeMessage::parse(vaa.payload())
        .map_err(|_| TokenBridgeError::InvalidTokenBridgePayload)?;
    msg.attestation()
        .map(|attestation| attestation.token_address())
        .ok_or(error!(TokenBridgeError::InvalidTokenBridgeVaa))
}

impl<'info> CreateOrUpdateWrapped<'info> {
    fn constraints(ctx: &Context<Self>) -> Result<()> {
        let vaa = &ctx.accounts.posted_vaa;

        // NOTE: Other attestation validation is performed using the try_attestation_* methods,
        // which were used in the accounts context.
        crate::utils::require_valid_posted_token_bridge_vaa(
            &vaa.key(),
            &PostedVaaV1::parse(&vaa.data.borrow()).unwrap(),
            &ctx.accounts.registered_emitter,
        )
        .map(|_| ())
    }
}

#[access_control(CreateOrUpdateWrapped::constraints(&ctx))]
pub fn create_or_update_wrapped(
    ctx: Context<CreateOrUpdateWrapped>,
    _args: EmptyArgs,
) -> Result<()> {
    // Mark the claim as complete.
    ctx.accounts.claim.is_complete = true;

    // Check if token metadata has been created yet. If it isn't, we must create this account and
    // the wrapped asset account.
    if ctx.accounts.token_metadata.data_is_empty() {
        handle_create_wrapped(ctx)
    } else {
        handle_update_wrapped(ctx)
    }
}

fn handle_create_wrapped(ctx: Context<CreateOrUpdateWrapped>) -> Result<()> {
    let acc_data = ctx.accounts.posted_vaa.data.borrow();
    let vaa = PostedVaaV1::parse(&acc_data).unwrap();
    let msg = TokenBridgeMessage::parse(vaa.payload()).unwrap();
    let attestation = msg.attestation().unwrap();

    // Set wrapped asset data.
    let wrapped_asset = &mut ctx.accounts.wrapped_asset;
    wrapped_asset.set_inner(WrappedAsset {
        token_chain: attestation.token_chain(),
        token_address: attestation.token_address(),
        native_decimals: attestation.decimals(),
    });

    // The wrapped asset account data will be encoded as JSON in the token metadata's URI.
    let uri = wrapped_asset.to_uri();

    let FixedMeta { symbol, name } = fix_symbol_and_name(attestation);

    metadata::create_metadata_accounts_v3(
        CpiContext::new_with_signer(
            ctx.accounts.mpl_token_metadata_program.to_account_info(),
            metadata::CreateMetadataAccountsV3 {
                metadata: ctx.accounts.token_metadata.to_account_info(),
                mint: ctx.accounts.wrapped_mint.to_account_info(),
                mint_authority: ctx.accounts.mint_authority.to_account_info(),
                payer: ctx.accounts.payer.to_account_info(),
                update_authority: ctx.accounts.mint_authority.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            &[&[MINT_AUTHORITY_SEED_PREFIX, &[ctx.bumps["mint_authority"]]]],
        ),
        DataV2 {
            symbol,
            name,
            uri,
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        },
        true,
        true,
        None,
    )
}

fn handle_update_wrapped(ctx: Context<CreateOrUpdateWrapped>) -> Result<()> {
    let acc_data = ctx.accounts.posted_vaa.data.borrow();
    let vaa = PostedVaaV1::parse(&acc_data).unwrap();
    let msg = TokenBridgeMessage::parse(vaa.payload()).unwrap();
    let attestation = msg.attestation().unwrap();

    // Deserialize token metadata so we can check whether the name or symbol have changed in
    // this asset metadata VAA.
    let data = {
        let mut acc_data: &[u8] = &ctx.accounts.token_metadata.try_borrow_data()?;
        metadata::MetadataAccount::try_deserialize(&mut acc_data).map(|acct| acct.data.clone())?
    };

    let FixedMeta { symbol, name } = fix_symbol_and_name(attestation);

    if name != data.name || symbol != data.symbol {
        // Finally update token metadata.
        metadata::update_metadata_accounts_v2(
            CpiContext::new_with_signer(
                ctx.accounts.mpl_token_metadata_program.to_account_info(),
                metadata::UpdateMetadataAccountsV2 {
                    metadata: ctx.accounts.token_metadata.to_account_info(),
                    update_authority: ctx.accounts.mint_authority.to_account_info(),
                },
                &[&[MINT_AUTHORITY_SEED_PREFIX, &[ctx.bumps["mint_authority"]]]],
            ),
            None,
            Some(DataV2 {
                symbol,
                name,
                uri: data.uri,
                seller_fee_basis_points: 0,
                creators: None,
                collection: None,
                uses: None,
            }),
            None,
            None,
        )
    } else {
        Ok(())
    }
}

fn cap_decimals(decimals: u8) -> u8 {
    if decimals > MAX_DECIMALS {
        MAX_DECIMALS
    } else {
        decimals
    }
}

struct FixedMeta {
    symbol: String,
    name: String,
}

fn fix_symbol_and_name(attestation: &Attestation) -> FixedMeta {
    // Truncate symbol to 10 characters (the maximum length for Token Metadata's symbol).
    let mut symbol = attestation.symbol().to_string();
    symbol.truncate(mpl_token_metadata::state::MAX_SYMBOL_LENGTH);

    FixedMeta {
        symbol,
        name: attestation.name().to_string(),
    }
}

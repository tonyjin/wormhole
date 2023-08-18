use crate::{
    error::CoreBridgeError,
    state::{MessageStatus, PostedMessageV1, PostedMessageV1Info},
};
use anchor_lang::prelude::*;
use wormhole_solana_common::{utils, LegacyDiscriminator};

const START: usize = PostedMessageV1::BYTES_START;

#[derive(Accounts)]
pub struct ProcessMessageV1<'info> {
    emitter_authority: Signer<'info>,

    /// CHECK: We do not deserialize this account as `PostedMessageV1` because allocating heap
    /// memory in its deserialization uses significant compute units with every call to this
    /// instruction handler. For large messages, this can be a significant cost.
    #[account(
        mut,
        owner = crate::ID
    )]
    draft_message: AccountInfo<'info>,

    /// CHECK: Destination for lamports if the draft message account is closed.
    #[account(mut)]
    close_account_destination: Option<UncheckedAccount<'info>>,
}

impl<'info> ProcessMessageV1<'info> {
    fn constraints(ctx: &Context<Self>) -> Result<()> {
        let mut acc_data: &[u8] = &ctx.accounts.draft_message.try_borrow_data()?;
        PostedMessageV1::require_discriminator(&mut acc_data)?;

        let info = PostedMessageV1Info::deserialize(&mut acc_data)?;
        require!(
            info.status == MessageStatus::Writing,
            CoreBridgeError::MessageAlreadyPublished
        );
        require_keys_eq!(
            ctx.accounts.emitter_authority.key(),
            info.emitter_authority,
            CoreBridgeError::EmitterAuthorityMismatch
        );

        // Done.
        Ok(())
    }
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone)]
pub enum ProcessMessageV1Directive {
    CloseMessageAccount,
    Write { index: u32, data: Vec<u8> },
}

#[access_control(ProcessMessageV1::constraints(&ctx))]
pub fn process_message_v1(
    ctx: Context<ProcessMessageV1>,
    directive: ProcessMessageV1Directive,
) -> Result<()> {
    let msg_acc_info = &ctx.accounts.draft_message;
    match directive {
        ProcessMessageV1Directive::CloseMessageAccount => {
            match &ctx.accounts.close_account_destination {
                Some(sol_destination) => {
                    msg!("Directive: CloseMessageAccount");
                    utils::close_account(
                        msg_acc_info.to_account_info(),
                        sol_destination.to_account_info(),
                    )
                }
                None => err!(ErrorCode::AccountNotEnoughKeys),
            }
        }
        ProcessMessageV1Directive::Write { index, data } => {
            msg!("Directive: Write");
            write_message(
                msg_acc_info,
                index
                    .try_into()
                    .map_err(|_| CoreBridgeError::InvalidInstructionArgument)?,
                data,
            )
        }
    }
}

fn write_message(msg_acc_info: &AccountInfo, index: usize, data: Vec<u8>) -> Result<()> {
    require!(
        !data.is_empty(),
        CoreBridgeError::InvalidInstructionArgument
    );

    let msg_length = {
        let mut acc_data: &[u8] = &msg_acc_info.data.borrow();
        acc_data = &acc_data[(START - 4)..];

        let payload_len = u32::deserialize(&mut acc_data)?;
        usize::try_from(payload_len).unwrap()
    };

    let end = index.saturating_add(data.len());
    require_gte!(msg_length, end, CoreBridgeError::DataOverflow);

    let acc_data = &mut msg_acc_info.data.borrow_mut();
    acc_data[(START + index)..(START + end)].copy_from_slice(&data);

    // Done.
    Ok(())
}

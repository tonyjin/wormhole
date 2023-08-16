import * as anchor from "@coral-xyz/anchor";
import { getOrCreateAssociatedTokenAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  WrappedMintInfo,
  MINT_INFO_WRAPPED_7,
  MINT_INFO_WRAPPED_8,
  expectIxOkDetails,
  getTokenBalances,
} from "../helpers";
import * as tokenBridge from "../helpers/tokenBridge";

describe("Token Bridge -- Legacy Instruction: Transfer Tokens with Payload (Wrapped)", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const connection = provider.connection;
  const program = tokenBridge.getAnchorProgram(connection, tokenBridge.localnet());
  const payer = (provider.wallet as anchor.Wallet).payer;

  const forkedProgram = tokenBridge.getAnchorProgram(connection, tokenBridge.mainnet());

  const wrappedMints: WrappedMintInfo[] = [MINT_INFO_WRAPPED_8, MINT_INFO_WRAPPED_7];

  describe("Ok", () => {
    for (const { chain, decimals, address } of wrappedMints) {
      const transferAuthority = anchor.web3.Keypair.generate();

      it(`Invoke \`transfer_tokens_with_payload_wrapped\` (${decimals} Decimals)`, async () => {
        const [mint, forkMint] = [program, forkedProgram].map((program) =>
          tokenBridge.wrappedMintPda(program.programId, chain, Array.from(address))
        );

        // Fetch recipient token account, these accounts shoudl've been created in other tests.
        const [payerToken, forkPayerToken] = await Promise.all([
          getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey),
          getOrCreateAssociatedTokenAccount(connection, payer, forkMint, payer.publicKey),
        ]);

        // Fetch balances before.
        const balancesBefore = await getTokenBalances(
          program,
          forkedProgram,
          payerToken.address,
          forkPayerToken.address
        );

        // Amount.
        const amount = new anchor.BN("88888888");

        // Invoke the instruction.
        const [coreMessage, txDetails, forkCoreMessage, forkTxDetails] = await parallelTxDetails(
          program,
          forkedProgram,
          {
            payer: payer.publicKey,
            wrappedMint: mint,
            forkWrappedMint: forkMint,
            srcToken: payerToken.address,
            forkSrcToken: forkPayerToken.address,
            srcOwner: payerToken.owner, // Payer owns both token accounts.
          },
          defaultArgs(amount),
          payer,
          transferAuthority
        );

        await tokenBridge.expectCorrectWrappedTokenBalanceChanges(
          connection,
          payerToken.address,
          forkPayerToken.address,
          balancesBefore,
          tokenBridge.TransferDirection.Out,
          BigInt(amount.toString())
        );

        // TODO: Check that the core messages are correct.
      });
    }
  });
});

function defaultArgs(amount: anchor.BN) {
  return {
    nonce: 420,
    amount,
    redeemer: Array.from(Buffer.alloc(32, "deadbeef", "hex")),
    redeemerChain: 2,
    payload: Buffer.from("All your base are belong to us."),
    cpiProgramId: null,
  };
}

async function parallelTxDetails(
  program: tokenBridge.TokenBridgeProgram,
  forkedProgram: tokenBridge.TokenBridgeProgram,
  accounts: {
    payer: PublicKey;
    wrappedMint: PublicKey;
    forkWrappedMint: PublicKey;
    srcToken: PublicKey;
    forkSrcToken: PublicKey;
    srcOwner: PublicKey;
  },
  args: tokenBridge.LegacyTransferTokensWithPayloadArgs,
  payer: anchor.web3.Keypair,
  senderAuthority: anchor.web3.Keypair
) {
  const connection = program.provider.connection;
  const { amount } = args;
  const coreMessage = anchor.web3.Keypair.generate();
  const { payer: owner, wrappedMint, forkWrappedMint, srcToken, forkSrcToken, srcOwner } = accounts;

  const approveIx = tokenBridge.approveTransferAuthorityIx(program, srcToken, owner, amount);
  const ix = tokenBridge.legacyTransferTokensWithPayloadWrappedIx(
    program,
    {
      coreMessage: coreMessage.publicKey,
      senderAuthority: senderAuthority.publicKey,
      ...{
        payer: owner,
        wrappedMint,
        srcToken,
        srcOwner,
      },
    },
    args
  );

  const forkCoreMessage = anchor.web3.Keypair.generate();
  const forkedApproveIx = tokenBridge.approveTransferAuthorityIx(
    forkedProgram,
    forkSrcToken,
    owner,
    amount
  );
  const forkedIx = tokenBridge.legacyTransferTokensWithPayloadWrappedIx(
    forkedProgram,
    {
      coreMessage: forkCoreMessage.publicKey,
      senderAuthority: senderAuthority.publicKey,
      ...{
        payer: owner,
        wrappedMint: forkWrappedMint,
        srcToken: forkSrcToken,
        srcOwner,
      },
    },
    args
  );

  const [txDetails, forkTxDetails] = await Promise.all([
    expectIxOkDetails(connection, [approveIx, ix], [payer, coreMessage, senderAuthority]),
    expectIxOkDetails(
      connection,
      [forkedApproveIx, forkedIx],
      [payer, forkCoreMessage, senderAuthority]
    ),
  ]);
  return [coreMessage, txDetails, forkCoreMessage, forkTxDetails];
}

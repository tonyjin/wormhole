import * as anchor from "@coral-xyz/anchor";
import { NATIVE_MINT, createMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import {
  expectIxOk,
  WrappedMintInfo,
  WRAPPED_MINT_INFO_MAX_ONE,
  expectIxErr,
  expectDeepEqual,
} from "../helpers";
import * as coreBridge from "../helpers/coreBridge";
import * as tokenBridge from "../helpers/tokenBridge";
import { parseAttestMetaPayload } from "@certusone/wormhole-sdk";

describe("Token Bridge -- Legacy Instruction: Attest Token", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const connection = provider.connection;
  const program = tokenBridge.getAnchorProgram(connection, tokenBridge.localnet());
  const payer = (provider.wallet as anchor.Wallet).payer;
  const wormholeProgram = coreBridge.getAnchorProgram(connection, coreBridge.localnet());
  const forkedProgram = tokenBridge.getAnchorProgram(connection, tokenBridge.mainnet());

  const wrappedMaxMint: WrappedMintInfo = WRAPPED_MINT_INFO_MAX_ONE;

  describe("Ok", () => {
    it("Invoke `attest_token` for Mint with Metadata", async () => {
      const [coreMessage, forkedCoreMessage] = await parallelTxOk(
        program,
        forkedProgram,
        { payer: payer.publicKey, mint: NATIVE_MINT },
        defaultArgs(),
        payer
      );

      // Verify message payload.
      await coreBridge.expectEqualMessageAccounts(
        wormholeProgram,
        coreMessage,
        forkedCoreMessage,
        false,
        false // sameEmitter
      );
    });

    it("Invoke `attest_token` Again with Same Mint", async () => {
      const [coreMessage, forkedCoreMessage] = await parallelTxOk(
        program,
        forkedProgram,
        { payer: payer.publicKey, mint: NATIVE_MINT },
        defaultArgs(),
        payer
      );

      // Verify message payload.
      await coreBridge.expectEqualMessageAccounts(
        wormholeProgram,
        coreMessage,
        forkedCoreMessage,
        false,
        false // sameEmitter
      );
    });
  });

  describe("New Implementation", () => {
    it("Cannot Invoke `attest_token` With a Wrapped Mint", async () => {
      const wrappedMint = tokenBridge.wrappedMintPda(
        program.programId,
        wrappedMaxMint.chain,
        Array.from(wrappedMaxMint.address)
      );

      // Create the instruction.
      const coreMessage = anchor.web3.Keypair.generate();
      const ix = tokenBridge.legacyAttestTokenIx(
        program,
        {
          coreMessage: coreMessage.publicKey,
          payer: payer.publicKey,
          mint: wrappedMint,
        },
        defaultArgs()
      );

      // Send the transaction.
      await expectIxErr(connection, [ix], [payer, coreMessage], "WrappedAsset");
    });

    it("Cannot Invoke `attest_token` with Mint without Metadata", async () => {
      const mint = await createMint(connection, payer, payer.publicKey, null, 9);

      // Create the instruction.
      const coreMessage = anchor.web3.Keypair.generate();
      const ix = tokenBridge.legacyAttestTokenIx(
        program,
        {
          coreMessage: coreMessage.publicKey,
          payer: payer.publicKey,
          mint,
        },
        defaultArgs()
      );

      // Send the transaction.
      await expectIxErr(connection, [ix], [payer, coreMessage], "AccountNotInitialized");
    });
  });
});

function defaultArgs() {
  return {
    nonce: 420,
  };
}

async function parallelTxOk(
  program: tokenBridge.TokenBridgeProgram,
  forkedProgram: tokenBridge.TokenBridgeProgram,
  accounts: { payer: PublicKey; mint: PublicKey },
  args: tokenBridge.LegacyAttestTokenArgs,
  payer: anchor.web3.Keypair
) {
  const connection = program.provider.connection;
  const coreMessage = anchor.web3.Keypair.generate();
  const ix = tokenBridge.legacyAttestTokenIx(
    program,
    {
      coreMessage: coreMessage.publicKey,
      ...accounts,
    },
    args
  );

  const forkedCoreMessage = anchor.web3.Keypair.generate();
  const forkedIx = tokenBridge.legacyAttestTokenIx(
    forkedProgram,
    {
      coreMessage: forkedCoreMessage.publicKey,
      ...accounts,
    },
    args
  );

  await expectIxOk(connection, [ix, forkedIx], [payer, coreMessage, forkedCoreMessage]);

  return [coreMessage, forkedCoreMessage];
}

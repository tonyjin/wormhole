import * as anchor from "@coral-xyz/anchor";
import { ethers } from "ethers";
import {
  InvalidAccountConfig,
  InvalidArgConfig,
  createIfNeeded,
  expectDeepEqual,
  expectIxErr,
  expectIxOkDetails,
} from "../helpers";
import { transferMessageFeeIx } from "../helpers/coreBridge/utils";
import * as coreBridge from "../helpers/coreBridge";
import { expect } from "chai";

describe("Core Bridge -- Instruction: Post Message Unreliable", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const connection = provider.connection;
  const program = coreBridge.getAnchorProgram(
    connection,
    coreBridge.getProgramId("Bridge1p5gheXUvJ6jGWGeCsgPKgnE3YgdGKRVCMY9o")
  );
  const payer = (provider.wallet as anchor.Wallet).payer;
  const forkedProgram = coreBridge.getAnchorProgram(
    connection,
    coreBridge.getProgramId("worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth")
  );

  const commonEmitterSequence = new anchor.BN(0);
  const commonEmitter = anchor.web3.Keypair.generate();
  const messageSigner = anchor.web3.Keypair.generate();
  const forkedMessageSigner = anchor.web3.Keypair.generate();

  describe("Invalid Interaction", () => {
    const accountConfigs: InvalidAccountConfig[] = [
      {
        label: "config",
        contextName: "config",
        errorMsg: "ConstraintSeeds",
        dataLength: 24,
        owner: program.programId,
      },
      {
        label: "fee_collector",
        contextName: "feeCollector",
        errorMsg: "ConstraintSeeds",
        dataLength: 0,
        owner: anchor.web3.PublicKey.default,
      },
      {
        label: "emitter_sequence",
        contextName: "emitterSequence",
        errorMsg: "ConstraintSeeds",
        dataLength: 8,
        owner: program.programId,
      },
    ];

    for (const cfg of accountConfigs) {
      it(`Account: ${cfg.label} (${cfg.errorMsg})`, async () => {
        const message = anchor.web3.Keypair.generate();
        const emitter = anchor.web3.Keypair.generate();
        const accounts = await createIfNeeded(program.provider.connection, cfg, payer, {
          message: message.publicKey,
          emitter: emitter.publicKey,
          payer: payer.publicKey,
        } as coreBridge.LegacyPostMessageUnreliableContext);

        // Create the post message instruction.
        const ix = coreBridge.legacyPostMessageUnreliableIx(program, accounts, defaultArgs());
        await expectIxErr(connection, [ix], [payer, emitter, message], cfg.errorMsg);
      });
    }
  });

  describe("Ok", () => {
    it("Invoke `post_message_unreliable`", async () => {
      // Fetch default args.
      const { nonce, payload, finality } = defaultArgs();

      // Create parallel transaction args.
      const args: parallelTxArgs = {
        new: {
          program,
          messageSigner,
          emitterSigner: commonEmitter,
        },
        fork: {
          program: forkedProgram,
          messageSigner: forkedMessageSigner,
          emitterSigner: commonEmitter,
        },
      };

      // Invoke `postMessage`.
      const [txDetails, forkTxDetails] = await parallelTxDetails(
        args,
        { nonce, payload, finality },
        payer
      );

      // Validate bridge data account.
      await coreBridge.expectEqualBridgeAccounts(program, forkedProgram);

      // Confirm that the message data accounts are the same.
      await coreBridge.expectEqualMessageAccounts(
        program,
        messageSigner,
        forkedMessageSigner,
        true
      );

      // Validate data in the message accounts.
      await coreBridge.expectLegacyPostMessageAfterEffects(
        program,
        txDetails,
        {
          payer: payer.publicKey,
          message: messageSigner.publicKey,
          emitter: commonEmitter.publicKey,
        },
        { nonce, payload, finality },
        commonEmitterSequence,
        true,
        payload
      );

      await coreBridge.expectLegacyPostMessageAfterEffects(
        forkedProgram,
        forkTxDetails,
        {
          payer: payer.publicKey,
          message: forkedMessageSigner.publicKey,
          emitter: commonEmitter.publicKey,
        },
        { nonce, payload, finality },
        commonEmitterSequence,
        true,
        payload
      );

      // Up tick emitter sequences.
      commonEmitterSequence.iaddn(1);

      // Validate fee collector.
      const feeCollectorData = await connection.getAccountInfo(
        coreBridge.FeeCollector.address(program.programId)
      );
      expect(feeCollectorData).is.not.null;
      const forkFeeCollectorData = await connection.getAccountInfo(
        coreBridge.FeeCollector.address(program.programId)
      );
      expect(feeCollectorData.lamports).to.equal(forkFeeCollectorData.lamports);
    });

    it("Invoke `post_message_unreliable` Using Same Message Signer", async () => {
      // Fetch existing message from the program. Since we are using the same
      // signer, the message data account should be the same.
      const [existingFinality, existingNonce, existingPayload] =
        await coreBridge.PostedMessageV1Unreliable.fromAccountAddress(
          connection,
          messageSigner.publicKey
        ).then((msg): [number, number, Buffer] => [msg.finality, msg.nonce, msg.payload]);

      // Create parallel transaction args.
      const args: parallelTxArgs = {
        new: {
          program,
          messageSigner,
          emitterSigner: commonEmitter,
        },
        fork: {
          program: forkedProgram,
          messageSigner: forkedMessageSigner,
          emitterSigner: commonEmitter,
        },
      };

      // Construct a different message with the same size as the original.
      const nonce = 69;
      expect(nonce).not.equals(existingNonce);

      const finality = 0;
      expect(finality).not.equals(existingFinality);

      const payload = Buffer.alloc(existingPayload.length);
      payload.fill(0);
      payload.write("So fresh and so clean clean.");
      expect(payload.equals(existingPayload)).is.false;

      // Invoke `postMessage`.
      const [txDetails, forkTxDetails] = await parallelTxDetails(
        args,
        { nonce, payload, finality },
        payer
      );

      // Validate bridge data account.
      await coreBridge.expectEqualBridgeAccounts(program, forkedProgram);

      // Confirm that the message data accounts are the same.
      await coreBridge.expectEqualMessageAccounts(
        program,
        messageSigner,
        forkedMessageSigner,
        true
      );

      // Validate data in the message accounts.
      await coreBridge.expectLegacyPostMessageAfterEffects(
        program,
        txDetails,
        {
          payer: payer.publicKey,
          message: messageSigner.publicKey,
          emitter: commonEmitter.publicKey,
        },
        { nonce, payload, finality },
        commonEmitterSequence,
        true,
        payload
      );

      await coreBridge.expectLegacyPostMessageAfterEffects(
        forkedProgram,
        forkTxDetails,
        {
          payer: payer.publicKey,
          message: forkedMessageSigner.publicKey,
          emitter: commonEmitter.publicKey,
        },
        { nonce, payload, finality },
        commonEmitterSequence,
        true,
        payload
      );

      // Up tick emitter sequences.
      commonEmitterSequence.iaddn(1);

      // Validate fee collector.
      const feeCollectorData = await connection.getAccountInfo(
        coreBridge.FeeCollector.address(program.programId)
      );
      expect(feeCollectorData).is.not.null;
      const forkFeeCollectorData = await connection.getAccountInfo(
        coreBridge.FeeCollector.address(program.programId)
      );
      expect(feeCollectorData.lamports).to.equal(forkFeeCollectorData.lamports);
    });

    it("Invoke `post_message_unreliable` with New Message Signer", async () => {
      // Fetch default args.
      let { nonce, payload, finality } = defaultArgs();
      payload = Buffer.from("Would you just look at that?");

      // Create two new message signers.
      const newMessageSigner = anchor.web3.Keypair.generate();
      const newForkedMessageSigner = anchor.web3.Keypair.generate();

      // Create parallel transaction args.
      const args: parallelTxArgs = {
        new: {
          program,
          messageSigner: newMessageSigner,
          emitterSigner: commonEmitter,
        },
        fork: {
          program: forkedProgram,
          messageSigner: newForkedMessageSigner,
          emitterSigner: commonEmitter,
        },
      };

      // Invoke `postMessage`.
      const [txDetails, forkTxDetails] = await parallelTxDetails(
        args,
        { nonce, payload, finality },
        payer
      );

      // Validate bridge data account.
      await coreBridge.expectEqualBridgeAccounts(program, forkedProgram);

      // Confirm that the message data accounts are the same.
      await coreBridge.expectEqualMessageAccounts(
        program,
        newMessageSigner,
        newForkedMessageSigner,
        true
      );

      // Validate data in the message accounts.
      await coreBridge.expectLegacyPostMessageAfterEffects(
        program,
        txDetails,
        {
          payer: payer.publicKey,
          message: newMessageSigner.publicKey,
          emitter: commonEmitter.publicKey,
        },
        { nonce, payload, finality },
        commonEmitterSequence,
        true,
        payload
      );

      await coreBridge.expectLegacyPostMessageAfterEffects(
        forkedProgram,
        forkTxDetails,
        {
          payer: payer.publicKey,
          message: newForkedMessageSigner.publicKey,
          emitter: commonEmitter.publicKey,
        },
        { nonce, payload, finality },
        commonEmitterSequence,
        true,
        payload
      );

      // Up tick emitter sequences.
      commonEmitterSequence.iaddn(1);

      // Validate fee collector.
      const feeCollectorData = await connection.getAccountInfo(
        coreBridge.FeeCollector.address(program.programId)
      );
      expect(feeCollectorData).is.not.null;
      const forkFeeCollectorData = await connection.getAccountInfo(
        coreBridge.FeeCollector.address(program.programId)
      );
      expect(feeCollectorData.lamports).to.equal(forkFeeCollectorData.lamports);
    });

    it("Invoke `post_message_unreliable` with Payer as Emitter", async () => {
      // Fetch default args.
      let { nonce, payload, finality } = defaultArgs();
      payload = Buffer.from("Would you just look at that?");

      // Create two new message signers.
      const newMessageSigner = anchor.web3.Keypair.generate();
      const newForkedMessageSigner = anchor.web3.Keypair.generate();

      // Create parallel transaction args.
      const args: parallelTxArgs = {
        new: {
          program,
          messageSigner: newMessageSigner,
          emitterSigner: payer,
        },
        fork: {
          program: forkedProgram,
          messageSigner: newForkedMessageSigner,
          emitterSigner: payer,
        },
      };

      // Fetch the sequence before invoking the instruction.
      const sequenceBefore = await coreBridge.EmitterSequence.fromPda(
        connection,
        program.programId,
        payer.publicKey
      );

      // Invoke `postMessage`.
      const [txDetails, forkTxDetails] = await parallelTxDetails(
        args,
        { nonce, payload, finality },
        payer
      );

      // Validate bridge data account.
      await coreBridge.expectEqualBridgeAccounts(program, forkedProgram);

      // Confirm that the message data accounts are the same.
      await coreBridge.expectEqualMessageAccounts(
        program,
        newMessageSigner,
        newForkedMessageSigner,
        true
      );

      // Validate data in the message accounts.
      await coreBridge.expectLegacyPostMessageAfterEffects(
        program,
        txDetails,
        {
          payer: payer.publicKey,
          message: newMessageSigner.publicKey,
          emitter: payer.publicKey,
        },
        { nonce, payload, finality },
        sequenceBefore.sequence,
        true,
        payload
      );

      await coreBridge.expectLegacyPostMessageAfterEffects(
        forkedProgram,
        forkTxDetails,
        {
          payer: payer.publicKey,
          message: newForkedMessageSigner.publicKey,
          emitter: payer.publicKey,
        },
        { nonce, payload, finality },
        sequenceBefore.sequence,
        true,
        payload
      );

      // Validate fee collector.
      const feeCollectorData = await connection.getAccountInfo(
        coreBridge.FeeCollector.address(program.programId)
      );
      expect(feeCollectorData).is.not.null;
      const forkFeeCollectorData = await connection.getAccountInfo(
        coreBridge.FeeCollector.address(program.programId)
      );
      expect(feeCollectorData.lamports).to.equal(forkFeeCollectorData.lamports);
    });
  });

  describe("New Implmentation", () => {
    it("Cannot Invoke `post_message_unreliable` Without Paying Fee", async () => {
      // Create the post message instruction.
      const messageSigner = anchor.web3.Keypair.generate();
      const emitter = anchor.web3.Keypair.generate();
      const accounts = {
        message: messageSigner.publicKey,
        emitter: emitter.publicKey,
        payer: payer.publicKey,
      };
      const ix = coreBridge.legacyPostMessageUnreliableIx(program, accounts, defaultArgs());
      await expectIxErr(connection, [ix], [payer, emitter, messageSigner], "InsufficientFees");
    });

    it("Cannot Invoke `post_message_unreliable` With Invalid Payload", async () => {
      // Create the post message instruction.
      const messageSigner = anchor.web3.Keypair.generate();
      const emitter = anchor.web3.Keypair.generate();
      const accounts = {
        message: messageSigner.publicKey,
        emitter: emitter.publicKey,
        payer: payer.publicKey,
      };
      let { nonce, payload, finality } = defaultArgs();
      payload = Buffer.alloc(0);

      const ix = coreBridge.legacyPostMessageUnreliableIx(program, accounts, {
        nonce,
        payload,
        finality,
      });
      await expectIxErr(
        connection,
        [ix],
        [payer, emitter, messageSigner],
        "InvalidInstructionArgument"
      );
    });
  });
});

function defaultArgs() {
  return {
    nonce: 420,
    payload: Buffer.from("All your base are belong to us."),
    finality: 1,
  };
}

interface parallelTxArgs {
  new: {
    program: coreBridge.CoreBridgeProgram;
    messageSigner: anchor.web3.Keypair;
    emitterSigner: anchor.web3.Keypair;
  };
  fork: {
    program: coreBridge.CoreBridgeProgram;
    messageSigner: anchor.web3.Keypair;
    emitterSigner: anchor.web3.Keypair;
  };
}

async function parallelTxDetails(
  args: parallelTxArgs,
  postUnreliableArgs: coreBridge.LegacyPostMessageArgs,
  payer: anchor.web3.Keypair
) {
  const connection = args.new.program.provider.connection;

  // Create the post message instruction.
  const ix = coreBridge.legacyPostMessageUnreliableIx(
    args.new.program,
    {
      payer: payer.publicKey,
      message: args.new.messageSigner.publicKey,
      emitter: args.new.emitterSigner.publicKey,
    },
    postUnreliableArgs
  );

  // Create the post message instruction for the forked program.
  const forkedIx = coreBridge.legacyPostMessageUnreliableIx(
    args.fork.program,
    {
      payer: payer.publicKey,
      message: args.fork.messageSigner.publicKey,
      emitter: args.fork.emitterSigner.publicKey,
    },
    postUnreliableArgs
  );

  // Pay the fee collector prior to publishing each message.
  await Promise.all([
    expectIxOkDetails(
      connection,
      [await transferMessageFeeIx(args.new.program, payer.publicKey)],
      [payer]
    ),
    expectIxOkDetails(
      connection,
      [await transferMessageFeeIx(args.fork.program, payer.publicKey)],
      [payer]
    ),
  ]);

  return Promise.all([
    expectIxOkDetails(connection, [ix], [payer, args.new.emitterSigner, args.new.messageSigner]),
    expectIxOkDetails(
      connection,
      [forkedIx],
      [payer, args.fork.emitterSigner, args.fork.messageSigner]
    ),
  ]);
}

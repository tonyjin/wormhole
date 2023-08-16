import { parseVaa } from "@certusone/wormhole-sdk";
import { GovernanceEmitter, MockGuardians } from "@certusone/wormhole-sdk/lib/cjs/mock";
import * as anchor from "@coral-xyz/anchor";
import { execSync } from "child_process";
import * as fs from "fs";
import {
  GUARDIAN_KEYS,
  expectIxErr,
  expectIxOk,
  invokeVerifySignaturesAndPostVaa,
  loadProgramBpf,
} from "../helpers";
import * as coreBridge from "../helpers/coreBridge";
import { GOVERNANCE_EMITTER_ADDRESS } from "../helpers/coreBridge";

// Test variables.
const localVariables = new Map<string, any>();

describe("Core Bridge -- Instruction: Init Message V1", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const program = coreBridge.getAnchorProgram(connection, coreBridge.mainnet());

  describe("Invalid Interaction", () => {
    // TODO
  });

  describe("Ok", () => {
    it.skip("Invoke Legacy `post_message` With Processed Message", async () => {
      // TODO
    });

    it.skip("Cannot Invoke `legacy_post_message` With Same Processed Message", async () => {
      // TODO
    });
  });
});

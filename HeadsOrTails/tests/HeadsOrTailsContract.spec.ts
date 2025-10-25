import { KeyedMockChainParty, MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  RECOMMENDED_MIN_FEE_VALUE,
  SInt,
  SLong,
  SSigmaProp,
  SGroupElement,
  TransactionBuilder,
  OutputBuilder,
  Amount,
  ErgoTree,
} from "@fleet-sdk/core";
import { blake2b256, utf8 } from "@fleet-sdk/crypto";
import { SByte, SColl } from "@fleet-sdk/serializer";
import { gameScript, createGameScript } from "../src/contract";
import { generateRandomString } from "../src/utils";
import { beforeEach, describe, expect, it } from "vitest";

describe("Heads Or Tails Contract", () => {
  // Setup the mock chain
  const mockChain = new MockChain({ height: 1_052_944 });
  const gameEnd = mockChain.height + 10;

  // 1 ERG = 1_000_000_000n
  const partyPrice = 1_000_000_000n; //1 ERG

  // add parties
  const player1 = mockChain.newParty("Player1");
  const player2 = mockChain.newParty("Player2");
  const someoneElse = mockChain.newParty("SomeoneElse");

  const createGameContract = compile(createGameScript, {
    map: {
      player1Pk: SSigmaProp(SGroupElement(player1.key.publicKey)),
      player2Pk: SSigmaProp(SGroupElement(player2.key.publicKey)),
      partyPrice: SLong(partyPrice),
      gameEnd: SInt(gameEnd),
    },
  });

  const createGameContractParty = mockChain.addParty(
    createGameContract.toHex(),
    "createGameContract"
  );

  const gameScriptContract = compile(gameScript, {
    map: {
      player2Pk: SSigmaProp(SGroupElement(player2.key.publicKey)),
    },
  });

  const gameScriptContractParty = mockChain.addParty(
    gameScriptContract.toHex(),
    "gameScriptContract"
  );

  const gameScriptHash = blake2b256(gameScriptContract.bytes);

  const HEAD = "HEAD";
  const TAIL = "TAIL";

  const p1Choice = Math.random() >= 0.5 ? HEAD : TAIL;
  const p1Secret = generateRandomString(32);
  const p1ChoiceHash = blake2b256(utf8.decode(p1Secret + p1Choice));

  beforeEach(() => {
    mockChain.reset();

    //Adding fund for player1 & player2
    player1.addBalance({
      nanoergs: partyPrice + RECOMMENDED_MIN_FEE_VALUE,
    });

    player2.addBalance({
      nanoergs: partyPrice + RECOMMENDED_MIN_FEE_VALUE,
    });
  });

  it("Player 1 create a new game", () => {
    //Player 1 deposit to create game contract.
    createNewGame(
      mockChain,
      player1,
      partyPrice,
      createGameContract,
      gameScriptHash,
      p1ChoiceHash
    );

    expect(player1.balance).to.be.deep.equal({
      nanoergs: 0n,
      tokens: [],
    });
    expect(createGameContractParty.balance).to.be.deep.equal({
      nanoergs: partyPrice,
      tokens: [],
    });
  });

  it("Player 1 create a new game and someone else try to withdraw but fail", () => {
    createNewGame(
      mockChain,
      player1,
      partyPrice,
      createGameContract,
      gameScriptHash,
      p1ChoiceHash
    );

    const withdrawBox = new OutputBuilder(
      partyPrice - RECOMMENDED_MIN_FEE_VALUE,
      someoneElse.address
    ).setAdditionalRegisters({
      R4: SColl(SByte, new Uint8Array()),
      R5: SColl(SByte, new Uint8Array()),
      R6: SSigmaProp(SGroupElement(player1.key.publicKey)),
      R7: SLong(0n),
      R8: SInt(0),
    });

    const transaction = new TransactionBuilder(mockChain.height)
      .from(createGameContractParty.utxos)
      .to(withdrawBox)
      .sendChangeTo(someoneElse.address)
      .payMinFee()
      .build();

    expect(() =>
      mockChain.execute(transaction, { signers: [someoneElse] })
    ).toThrowError();
  });

  it("Player 1 create a new game and withdraw after timeout", () => {
    createNewGame(
      mockChain,
      player1,
      partyPrice,
      createGameContract,
      gameScriptHash,
      p1ChoiceHash
    );

    //Timeout
    mockChain.newBlocks(10);

    const withdrawBox = new OutputBuilder(
      partyPrice - RECOMMENDED_MIN_FEE_VALUE,
      player1.address
    ).setAdditionalRegisters({
      R4: SColl(SByte, utf8.decode(p1Choice)),
      R5: SColl(SByte, p1ChoiceHash),
      R6: SSigmaProp(SGroupElement(player1.key.publicKey)),
      R7: SLong(partyPrice),
      R8: SInt(gameEnd),
    });

    const transaction = new TransactionBuilder(mockChain.height)
      .from(createGameContractParty.utxos)
      .to(withdrawBox)
      .sendChangeTo(player1.address)
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction, { signers: [player1] })).to.be.true;
  });

  it("Player 2 win the game and withdraw", () => {
    //Player 1 deposit to create game contract.
    createNewGame(
      mockChain,
      player1,
      partyPrice,
      createGameContract,
      gameScriptHash,
      p1ChoiceHash
    );

    //Player 2 make his choice as same as player 1.
    const p2Choice = p1Choice;

    // Player 2 make depoist to game contract.
    const player2DepositBox = new OutputBuilder(
      2n * partyPrice,
      gameScriptContract
    ).setAdditionalRegisters({
      R4: SColl(SByte, utf8.decode(p2Choice)),
      R5: SColl(SByte, p1ChoiceHash),
      R6: SSigmaProp(SGroupElement(player1.key.publicKey)),
      R7: SLong(partyPrice),
      R8: SInt(gameEnd),
    });

    const input = player2.utxos.toArray();
    input.push(...createGameContractParty.utxos.toArray());

    const transaction2 = new TransactionBuilder(mockChain.height)
      .from(input)
      .to(player2DepositBox)
      .sendChangeTo(player2.address)
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction2, { signers: [player2] })).to.be.true;
    expect(createGameContractParty.balance).to.be.deep.equal({
      nanoergs: 0n,
      tokens: [],
    });

    expect(createGameContractParty.utxos.isEmpty).to.be.true;
    expect(gameScriptContractParty.balance).to.be.deep.equal({
      nanoergs: 2n * partyPrice,
      tokens: [],
    });

    //Withdraw winner price
    const withdrawBox = new OutputBuilder(
      partyPrice * 2n - RECOMMENDED_MIN_FEE_VALUE,
      player2.address
    ).setAdditionalRegisters({
      R4: SColl(SByte, utf8.decode(p1Choice)),
      R5: SColl(SByte, utf8.decode(p1Secret)),
    });

    const transaction3 = new TransactionBuilder(mockChain.height)
      .from(gameScriptContractParty.utxos)
      .to(withdrawBox)
      .sendChangeTo(player2.address)
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction3, { signers: [player2] })).to.be.true;
    expect(gameScriptContractParty.balance).to.be.deep.equal({
      nanoergs: 0n,
      tokens: [],
    });
    expect(player2.balance).to.be.deep.equal({
      nanoergs: 2n * partyPrice - RECOMMENDED_MIN_FEE_VALUE,
      tokens: [],
    });
  });

  it("Player 2 lost the game and can not withdraw", () => {
    //Player 1 deposit to create game contract.
    createNewGame(
      mockChain,
      player1,
      partyPrice,
      createGameContract,
      gameScriptHash,
      p1ChoiceHash
    );

    // Make a wrong choice
    const p2Choice = p1Choice == HEAD ? TAIL : HEAD;

    const player2DepositBox = new OutputBuilder(
      2n * partyPrice,
      gameScriptContract
    ).setAdditionalRegisters({
      R4: SColl(SByte, utf8.decode(p2Choice)),
      R5: SColl(SByte, p1ChoiceHash),
      R6: SSigmaProp(SGroupElement(player1.key.publicKey)),
      R7: SLong(partyPrice),
      R8: SInt(gameEnd),
    });

    const input = player2.utxos.toArray();
    input.push(...createGameContractParty.utxos.toArray());

    const transaction2 = new TransactionBuilder(mockChain.height)
      .from(input)
      .to(player2DepositBox)
      .sendChangeTo(player2.address)
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction2, { signers: [player2] })).to.be.true;
    expect(createGameContractParty.balance).to.be.deep.equal({
      nanoergs: 0n,
      tokens: [],
    });

    expect(createGameContractParty.utxos.isEmpty).to.be.true;
    expect(gameScriptContractParty.balance).to.be.deep.equal({
      nanoergs: 2n * partyPrice,
      tokens: [],
    });

    //Try to withdraw
    const withdrawBox = new OutputBuilder(
      partyPrice * 2n - RECOMMENDED_MIN_FEE_VALUE,
      player2.address
    ).setAdditionalRegisters({
      R4: SColl(SByte, utf8.decode(p1Choice)),
      R5: SColl(SByte, utf8.decode(p1Secret)),
    });

    const transaction3 = new TransactionBuilder(mockChain.height)
      .from(gameScriptContractParty.utxos)
      .to(withdrawBox)
      .sendChangeTo(player2.address)
      .payMinFee()
      .build();

    expect(() =>
      mockChain.execute(transaction3, { signers: [player2] })
    ).toThrowError();
  });

  it("Player 2 win the game but someone else try to withdraw", () => {
    //Player 1 deposit to create game contract.
    createNewGame(
      mockChain,
      player1,
      partyPrice,
      createGameContract,
      gameScriptHash,
      p1ChoiceHash
    );

    const p2Choice = p1Choice;

    const player2DepositBox = new OutputBuilder(
      2n * partyPrice,
      gameScriptContract
    ).setAdditionalRegisters({
      R4: SColl(SByte, utf8.decode(p2Choice)),
      R5: SColl(SByte, p1ChoiceHash),
      R6: SSigmaProp(SGroupElement(player1.key.publicKey)),
      R7: SLong(partyPrice),
      R8: SInt(gameEnd),
    });

    const input = player2.utxos.toArray();
    input.push(...createGameContractParty.utxos.toArray());

    const transaction2 = new TransactionBuilder(mockChain.height)
      .from(input)
      .to(player2DepositBox)
      .sendChangeTo(player2.address)
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction2, { signers: [player2] })).to.be.true;

    const withdrawBox = new OutputBuilder(
      partyPrice * 2n - RECOMMENDED_MIN_FEE_VALUE,
      someoneElse.address
    ).setAdditionalRegisters({
      R4: SColl(SByte, utf8.decode(p1Choice)),
      R5: SColl(SByte, utf8.decode(p1Secret)),
    });

    const transaction3 = new TransactionBuilder(mockChain.height)
      .from(gameScriptContractParty.utxos)
      .to(withdrawBox)
      .sendChangeTo(someoneElse.address)
      .payMinFee()
      .build();

    expect(() =>
      mockChain.execute(transaction3, { signers: [someoneElse] })
    ).toThrowError();
  });

  it("Player 2 try to deposit a small amount of erg to game contract but fail", () => {
    //Player 1 deposit to create game contract.
    createNewGame(
      mockChain,
      player1,
      partyPrice,
      createGameContract,
      gameScriptHash,
      p1ChoiceHash
    );

    const p2Choice = p1Choice;

    const player2DepositBox = new OutputBuilder(
      partyPrice + 100_000_000n,
      gameScriptContract
    ).setAdditionalRegisters({
      R4: SColl(SByte, utf8.decode(p2Choice)),
      R5: SColl(SByte, p1ChoiceHash),
      R6: SSigmaProp(SGroupElement(player1.key.publicKey)),
      R7: SLong(partyPrice),
      R8: SInt(gameEnd),
    });

    const input = player2.utxos.toArray();
    input.push(...createGameContractParty.utxos.toArray());

    const transaction2 = new TransactionBuilder(mockChain.height)
      .from(input)
      .to(player2DepositBox)
      .sendChangeTo(player2.address)
      .payMinFee()
      .build();

    expect(() =>
      mockChain.execute(transaction2, { signers: [player2] })
    ).toThrowError();
  });

  it("Player 2 deposit and player 1 not giving his choice and secret the contract will timeout and player 2 can withdraw his fund", () => {
    //Player 1 deposit to create game contract.
    createNewGame(
      mockChain,
      player1,
      partyPrice,
      createGameContract,
      gameScriptHash,
      p1ChoiceHash
    );

    // Make a wrong choice
    const p2Choice = p1Choice == HEAD ? TAIL : HEAD;

    const player2DepositBox = new OutputBuilder(
      2n * partyPrice,
      gameScriptContract
    ).setAdditionalRegisters({
      R4: SColl(SByte, utf8.decode(p2Choice)),
      R5: SColl(SByte, p1ChoiceHash),
      R6: SSigmaProp(SGroupElement(player1.key.publicKey)),
      R7: SLong(partyPrice),
      R8: SInt(gameEnd),
    });

    const input = player2.utxos.toArray();
    input.push(...createGameContractParty.utxos.toArray());

    const transaction2 = new TransactionBuilder(mockChain.height)
      .from(input)
      .to(player2DepositBox)
      .sendChangeTo(player2.address)
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction2, { signers: [player2] })).to.be.true;

    //Time out
    mockChain.newBlocks(10);

    //After time out player 2 can withdraw all the fund from the game contract..
    const withdrawBox = new OutputBuilder(
      partyPrice * 2n - RECOMMENDED_MIN_FEE_VALUE,
      player2.address
    ).setAdditionalRegisters({
      R4: SColl(SByte, new Uint8Array()),
      R5: SColl(SByte, new Uint8Array()),
    });

    const transaction3 = new TransactionBuilder(mockChain.height)
      .from(gameScriptContractParty.utxos)
      .to(withdrawBox)
      .sendChangeTo(player2.address)
      .payMinFee()
      .build();

    expect(mockChain.execute(transaction3, { signers: [player2] })).to.be.true;
    expect(gameScriptContractParty.balance).to.be.deep.equal({
      nanoergs: 0n,
      tokens: [],
    });
    expect(player2.balance).to.be.deep.equal({
      nanoergs: 2n * partyPrice - RECOMMENDED_MIN_FEE_VALUE,
      tokens: [],
    });
  });
});

function createNewGame(
  mockChain: MockChain,
  player1: KeyedMockChainParty,
  partyPrice: Amount,
  createGameContract: ErgoTree,
  gameScriptHash: Uint8Array<ArrayBufferLike>,
  p1ChoiceHash: Uint8Array<ArrayBufferLike>
) {
  //Player 1 deposit to create game contract.
  const player1DepositBox = new OutputBuilder(
    partyPrice,
    createGameContract
  ).setAdditionalRegisters({
    R4: SColl(SByte, gameScriptHash),
    R5: SColl(SByte, p1ChoiceHash),
  });

  //Create new game transaction.
  const transaction1 = new TransactionBuilder(mockChain.height)
    .from(player1.utxos)
    .to(player1DepositBox)
    .sendChangeTo(player1.address)
    .payMinFee()
    .build();

  //Sign the contract
  expect(mockChain.execute(transaction1, { signers: [player1] })).to.be.true;
}

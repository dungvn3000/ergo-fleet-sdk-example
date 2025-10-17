import { OutputBuilder, TransactionBuilder } from "@fleet-sdk/core";
import { SByte, SColl } from "@fleet-sdk/serializer";
import { compile } from "@fleet-sdk/compiler";
import { blake2b256 } from "@fleet-sdk/crypto";

(async () => {
  if (await ergoConnector.nautilus.connect()) {
    if (ergoConnector.nautilus) {
      // check if Nautilus Wallet is available
      console.log("Nautilus Wallet is ready to use");
    } else {
      alert("Nautilus Wallet is not active");
    }
  }
})();

function askPinNumber() {
  const pinNumber = prompt("Please enter your pin number: (4 number)");
  if (!pinNumber || pinNumber.length !== 4) {
    return askPinNumber();
  }

  return pinNumber;
}

async function deposit() {
  const pinNumber = askPinNumber();
  const pinLockContract = compile(
    "sigmaProp(SELF.R4[Coll[Byte]].get == blake2b256(OUTPUTS(0).R4[Coll[Byte]].get))"
  );

  const height = await ergo.get_current_height();
  const unsignedTx = new TransactionBuilder(height)
    .from(await ergo.get_utxos())
    .to(
      new OutputBuilder(
        "10000000", 
        pinLockContract
      ).setAdditionalRegisters({
        R4: SColl(SByte, blake2b256(pinNumber)),
      })
    )
    .sendChangeTo(await ergo.get_change_address())
    .payMinFee()
    .build()
    .toEIP12Object();

  const signedTx = await ergo.sign_tx(unsignedTx);
  const txId = await ergo.submit_tx(signedTx);

  //Store deposit box for withdraw.
  localStorage.setItem("depositBox", JSON.stringify(signedTx.outputs[0]));

  alert("Deposit success txId: " + txId);
}

async function withdraw() {
  const depositBox = JSON.parse(localStorage.getItem("depositBox"));

  if (!depositBox) {
    alert("Please make your deposit first!");
    return;
  }

  const pinNumber = askPinNumber();
  const height = await ergo.get_current_height();
  const unsignedTx = new TransactionBuilder(height)
    .from(depositBox)
    .to(
      new OutputBuilder(
        "8900000",
        await ergo.get_change_address()
      ).setAdditionalRegisters({
        R4: SColl(SByte, pinNumber),
      })
    )
    .sendChangeTo(await ergo.get_change_address())
    .payMinFee()
    .build()
    .toEIP12Object();

  const signedTx = await ergo.sign_tx(unsignedTx);
  const txId = await ergo.submit_tx(signedTx);
  
  //Remove depositBox from local storage after withdraw.
  localStorage.removeItem("depositBox");
  alert("Withdraw success txId: " + txId);
}

const depositBtn = document.querySelector<HTMLButtonElement>("#depositBtn");
depositBtn.addEventListener("click", deposit);

const withdrawBtn = document.querySelector<HTMLButtonElement>("#withdrawBtn");
withdrawBtn.addEventListener("click", withdraw);

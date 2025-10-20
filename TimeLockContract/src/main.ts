import { SSigmaProp, SGroupElement, ErgoAddress, OutputBuilder, TransactionBuilder } from "@fleet-sdk/core";
import { SInt } from "@fleet-sdk/serializer";
import { compile } from "@fleet-sdk/compiler";
import { first } from "@fleet-sdk/common";

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

async function deposit() {
  const height = await ergo.get_current_height();
  const owner = await ergo.get_change_address();
  const ownerPK = first(ErgoAddress.decode(owner).getPublicKeys());

  const timeLockContract = compile("ownerPK && HEIGHT > deadline", {
    map: {
      ownerPK: SSigmaProp(SGroupElement(ownerPK)),
      deadline: SInt(height + 2)
    }
  });

  const unsignedTx = new TransactionBuilder(height)
    .from(await ergo.get_utxos())
    .to(
      new OutputBuilder(
        "10000000", 
        timeLockContract
      )
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

  const height = await ergo.get_current_height();
  const unsignedTx = new TransactionBuilder(height)
    .from(depositBox)
    .to(
      new OutputBuilder(
        "8900000",
        await ergo.get_change_address()
      )
    )
    .sendChangeTo(await ergo.get_change_address())
    .payMinFee()
    .build()
    .toEIP12Object();

  try {
    const signedTx = await ergo.sign_tx(unsignedTx);
    const txId = await ergo.submit_tx(signedTx);
    
    //Remove depositBox from local storage after withdraw.
    localStorage.removeItem("depositBox");
    alert("Withdraw success txId: " + txId);
  } catch (error) {
    alert(error.info);
    console.log(error);
  }
}

const depositBtn = document.querySelector<HTMLButtonElement>("#depositBtn");
depositBtn.addEventListener("click", deposit);

const withdrawBtn = document.querySelector<HTMLButtonElement>("#withdrawBtn");
withdrawBtn.addEventListener("click", withdraw);

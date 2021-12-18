import { relay } from "./relay/main";
import { calculateFee } from "./feeCalculation/main";
const cors = require("cors");

/*
This example application is meant to model a
simple on-demand relayer for the Wormhole Token-Bridge.

More complex relayers could query the Guardians for outstanding VAAs,
or relay arbitrary VAAs, rather than just Token Bridge VAAs. 

This application serves provide a skeleton
upon which more complex relayers can be built, and also serves 
to demonstrate how to use the Wormhome Typescript SDK.

For a wordier & simpler relayer example, you may want to reference the basicRelayer.ts file
inside examples/core
*/
function startServer() {
  const express = require("express");
  const app = express();
  app.use(cors());
  const bodyParser = require("body-parser");
  app.use(bodyParser.urlencoded({ extended: true }));
  app.use(bodyParser.json());
  app.post("/relay", relay);
  app.get("/fee/:originChain/:originAsset/:targetChain", calculateFee);
  app.get("/health", (request, response) =>
    response.status(200).json({ status: "Server is healthy" })
  );
  app.listen(3111, () => {
    console.log("Server running on port 3111");
  });
}

startServer();

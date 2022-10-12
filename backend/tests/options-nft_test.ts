
import { Clarinet, Tx, Chain, Account, types, assertEquals, shiftPriceValue, liteSignatureToStacksSignature } from "./deps.ts";
import type { PricePackage, Block } from "./deps.ts";
import axiod from "https://deno.land/x/axiod@0.26.2/mod.ts";

Clarinet.test({
    name: "Ensure that can start auction with submit price data",
    async fn(chain: Chain, accounts: Map<string, Account>) {

        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""
        const deployer = accounts.get('deployer')?.address ?? ""
        let redstone_response = { timestamp: 0, liteEvmSignature:"", value:0}
        await axiod.get("https://api.redstone.finance/prices?symbol=STX&provider=redstone").then((response) => {
            redstone_response = response.data[0]
        });

        console.log(redstone_response)
		const signature = redstone_response.liteEvmSignature

		let block = chain.mineBlock([
			Tx.contractCall("options-nft", "submit-price-data", [
				types.uint(redstone_response.timestamp),
				types.uint(shiftPriceValue(redstone_response.value)),
				types.buff(liteSignatureToStacksSignature(redstone_response.liteEvmSignature))
			], wallet_1)
		]);

        console.log(block.receipts)
    },
});
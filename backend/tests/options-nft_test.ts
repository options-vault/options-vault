
import { Clarinet, Tx, Chain, Account, types, assertEquals, pricePackageToCV } from "./deps.ts";
import type { PricePackage, Block } from "./deps.ts";
import axiod from "https://deno.land/x/axiod@0.26.2/mod.ts";

Clarinet.test({
    name: "Ensure that can start auction with submit price data",
    async fn(chain: Chain, accounts: Map<string, Account>) {

        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""
        const deployer = accounts.get('deployer')?.address ?? ""
        let redstone_response = { timestamp: null, liteEvmSignature:"", value:0}
        await axiod.get("https://api.redstone.finance/prices?symbol=STX&provider=redstone").then((response) => {
            redstone_response = response.data[0]
        });

        console.log(redstone_response)


        const pricePackage: PricePackage = {
			timestamp: redstone_response.timestamp ?? 0,
			prices: [{ symbol: "STXUSD", value: redstone_response.value }]
		}

		const packageCV = pricePackageToCV(pricePackage);
		const signature = redstone_response.liteEvmSignature

		let block = chain.mineBlock([
			Tx.contractCall("options-nft", "submit-price-data", [
				packageCV.timestamp,
				packageCV.prices,
				signature
			], wallet_1)
		]);

        block = chain.mineBlock([
            /* 
             * Add transactions with: 
             * Tx.contractCall(...)
            */
        ]);
        assertEquals(block.receipts.length, 0);
        assertEquals(block.height, 3);
    },
});
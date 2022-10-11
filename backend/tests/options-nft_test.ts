
// @ts-ignore
import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v1.0.2/index.ts';
// @ts-ignore
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';
// @ts-ignore
import axiod from "https://deno.land/x/axiod/mod.ts";

Clarinet.test({
    name: "Ensure that can start auction with submit price data",
    async fn(chain: Chain, accounts: Map<string, Account>) {

        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""
        const deployer = accounts.get('deployer')?.address ?? ""
        let redstone_response;
        await axiod.get("https://api.redstone.finance/prices?symbol=STX&provider=redstone").then((response) => {
            redstone_response = response.data[0]
        });

        console.log(redstone_response)
        let block = chain.mineBlock([
            /* 
             * Add transactions with: 
             * Tx.contractCall(...)
            */
           Tx.contractCall("new-options-nft", "submit-price-data", [redstone_response.timestamp, redstone_response.value, redstone_response.liteEvmSignature], deployer)
        ]);
        assertEquals(block.receipts.length, 0);
        assertEquals(block.height, 2);

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

Clarinet.test({
    name: "Ensure that can start auction with submit price data",
    async fn(chain: Chain, accounts: Map<string, Account>) {

        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""
        const deployer = accounts.get('deployer')?.address ?? ""
        let redstone_response;
        await axiod.get("https://api.redstone.finance/prices?symbol=STX&provider=redstone").then((response) => {
            redstone_response = response.data[0]
        });

        console.log(redstone_response)
        let block = chain.mineBlock([
            /* 
             * Add transactions with: 
             * Tx.contractCall(...)
            */
           Tx.contractCall("new-options-nft", "submit-price-data", [redstone_response.timestamp, redstone_response.value, redstone_response.liteEvmSignature], deployer)
        ]);
        assertEquals(block.receipts.length, 0);
        assertEquals(block.height, 2);

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

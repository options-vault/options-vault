
// @ts-ignore
import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v1.0.2/index.ts';
// @ts-ignore
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

Clarinet.test({
    name: "Ensure that can start auction with submit price data",
    async fn(chain: Chain, accounts: Map<string, Account>) {

        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""
        const deployer = accounts.get('deployer')?.address ?? ""
        let redstone_response = [{"id":"b996448a-33bb-4cb0-9135-a168765f9f87","symbol":"STX","provider":"I-5rWUehEv-MjdK9gFw09RxfSLQX9DIHxG614Wf8qo0","value":0.3143,"liteEvmSignature":"0xb4531353566f914dbc04d2751cf76a33d66522fd524a5c8c4e97a6b97ad5c3db72ba65f5030d27e4413c0763dd567262b95dd587d6e848a902109c28603dd9a71c","permawebTx":"mock-permaweb-tx","version":"0.4","source":{"binance":0.3150315,"coinbaseprime":0.3143,"coinbasepro":0.3143,"kucoin":"error","okcoin":"error","okex5":"error"},"timestamp":1665455296151,"minutes":28,"providerPublicKey":"xyTvKiCST8bAT6sxrgkLh8UCX2N1eKvawODuxwq4qOHIdDAZFU_3N2m59rkZ0E7m77GsJuf1I8u0oEJEbxAdT7uD2JTwoYEHauXSxyJYvF0RCcZOhl5P1PJwImd44SJYa_9My7L84D5KXB9SKs8_VThe7ZyOb5HSGLNvMIK6A8IJ4Hr_tg9GYm65CRmtcu18S9mhun8vgw2wi7Gw6oR6mc4vU1I-hrU66Fi7YlXwFieP6YSy01JqoLPhU84EunPQzXPouVSbXjgRU5kFVxtdRy4GK2fzEBFYsQwCQgFrySCrFKHV8AInu9jerfof_DxNKiXkBzlB8nc22CrYnvvio_BWyh-gN0hQHZT0gwMR-A7sbXNCQJfReaIZzX_jP6XoB82PnpzmL_j1mJ2lnv2Rn001flBAx9AYxtGXd9s07pA-FggTbEG3Y2UnlWW6l3EJ93E0IfxL0PqGEUlp217mxUHvmTw9fkGDWa8rT9RPmsTyji-kMFSefclw80cBm_iOsIEutGP4S3LDbP-ZVJWDeJOBQQpSgwbisl8qbjl2sMQLQihoG2TQyNbmLwfyq-XSULkXjUi1_6BH36wnDBLWBKF-bS2bLKcGtn3Vjet72lNHxJJilcj8vpauwJG0078S_lO5uGt6oicdGR6eh_NSn6_8za_tXg0G_fohz4Yb1z8"}][0]
        
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

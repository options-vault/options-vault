import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v1.0.2/index.ts';
import { assert, assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';
import { createTwoDepositorsAndProcess } from "./init.ts"
const vaultContract = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.vault";

Clarinet.test({
    name: "Ensure that users can deposit and their funds are processed",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""
        let block = createTwoDepositorsAndProcess(chain, accounts)

        block.receipts[0].events.expectSTXTransferEvent(1000000, wallet_1, vaultContract)
        block.receipts[1].events.expectSTXTransferEvent(2000000, wallet_2, vaultContract)
        block.receipts[2].result.expectOk();
        // TODO check contract balance
        //console.log(block.receipts[0].events[0])
    },
});

Clarinet.test({
    name: "Ensure that users can withdraw correct amounts",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""
        const wallet_3 = accounts.get('wallet_3')?.address ?? ""

        let block = createTwoDepositorsAndProcess(chain, accounts)

        // console.log(wallet_3)
        // console.log(wallet_1)

        // TODO: This is great - each of the contractCalls should ideally be their own test
        block = chain.mineBlock([
            // random tries to withdraw, should fail
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000)], wallet_3),
            // user tries to withdraw their whole account, should succeed
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000)], wallet_1),
            // user withdraws part of account, should succeed 
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000)], wallet_2),
            // user withdraw the rest of their account, should succeed
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000)], wallet_2),
            // user withdraws after they have withdrawn their total account, should fail
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000)], wallet_2),
            // 
            Tx.contractCall("vault", "process-withdrawals", [], wallet_1)
            
        ]);

        // console.log(block.receipts)

        // TODO check contract balance
        //console.log(block.receipts[0].events[0])
    },
});


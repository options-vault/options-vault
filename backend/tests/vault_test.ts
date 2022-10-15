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
    name: "Ensure that non user cannot withdraw",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""
        const wallet_3 = accounts.get('wallet_3')?.address ?? ""

        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_3),
        ])
        block.receipts[0].result.expectErr()
}})

Clarinet.test({
    name: "Ensure that user can withdraw their whole account",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""
        const wallet_3 = accounts.get('wallet_3')?.address ?? ""

        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_1),

        ])
        block.receipts[0].result.expectOk()
}})

Clarinet.test({
    name: "Ensure that user can withdraw part of their account",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""

        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_2),
        ])
        block.receipts[0].result.expectOk()
}})

Clarinet.test({
    name: "Ensure that user cannot withdraw more than their accounts worth of stacks",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""

        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(2000001)], wallet_2),
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(2000000)], wallet_2),
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1)], wallet_2)

        ])
        block.receipts[0].result.expectErr()
        block.receipts[1].result.expectOk()
        block.receipts[2].result.expectErr()

}})

Clarinet.test({
    name: "Ensure that pending withdrawals are actualised correctly",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_1),
            Tx.contractCall("vault", "process-withdrawals", [], wallet_1)
        ])
        block.receipts[0].result.expectOk()
        block.receipts[1].events.expectSTXTransferEvent(1000000, vaultContract, wallet_1)
}})

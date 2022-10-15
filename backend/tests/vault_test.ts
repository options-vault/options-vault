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

        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_1),

        ])
        block.receipts[0].result.expectOk()
}})

Clarinet.test({
    name: "Ensure that user can withdraw part of their account",
    fn(chain: Chain, accounts: Map<string, Account>) {
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

Clarinet.test({
    name: "Ensure that ledger entry is set correctly during deposits",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""

        let block = createTwoDepositorsAndProcess(chain, accounts)

        // expect wallet 1 has 1 stack, wallet 2 has 2 in ledger
        chain.callReadOnlyFn("vault", "get-ledger-entry", [], wallet_1).result.expectSome().expectUint(1000000);
        chain.callReadOnlyFn("vault", "get-ledger-entry", [], wallet_2).result.expectSome().expectUint(2000000);

}})

Clarinet.test({
    name: "Ensure that ledger entry is set correctly during withdrawals",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""

        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_1),
            Tx.contractCall("vault", "process-withdrawals", [], wallet_1),

        ])

        // TODO make so ledger reads null rather than zero when user has completely withdrawn
        
         // user 1 has withdrawn their whole account already, expect they are not in ledger
        //chain.callReadOnlyFn("vault", "get-ledger-entry", [], wallet_1).result.expectNone();
        // user is actually in ledger with 0 microstacks
        chain.callReadOnlyFn("vault", "get-ledger-entry", [], wallet_1).result.expectSome().expectUint(0);

        // but user 2 still has their 2 stacks
        chain.callReadOnlyFn("vault", "get-ledger-entry", [], wallet_2).result.expectSome().expectUint(2000000);

}})

Clarinet.test({
    name: "Putting more than one queue withdrawal on the same block fails!?",
    fn(chain: Chain, accounts: Map<string, Account>) {

        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""

        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_1),
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_2),
            Tx.contractCall("vault", "process-withdrawals", [], wallet_1),

        ])
        // TODO find out why two queueu withdrawals and then prcess fails, but one works

        // TODO find out why result of get-ledger-entry is just a number, not a whole object with pending etc

         // user 1 has withdrawn their whole account already, expect they are not in ledger
         chain.callReadOnlyFn("vault", "get-ledger-entry", [], wallet_1).result.expectSome().expectUint(0);

        // but user 2 still has 1 stack left
        chain.callReadOnlyFn("vault", "get-ledger-entry", [], wallet_2).result.expectSome().expectUint(1000000);
}})
Clarinet.test({
    name: "Two separate queue withdrawals on different blocks still fails!?",
    fn(chain: Chain, accounts: Map<string, Account>) {

        const wallet_1 = accounts.get('wallet_1')?.address ?? ""
        const wallet_2 = accounts.get('wallet_2')?.address ?? ""

        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_1),
        Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_2),
            
        ])
        block = chain.mineBlock([
            Tx.contractCall("vault", "process-withdrawals", [], wallet_1),
        ])

        // TODO find out why two queueu withdrawals and then prcess fails, but one works

        // TODO find out why result of get-ledger-entry is just a number, not a whole object with pending etc

         // user 1 has withdrawn their whole account already, expect they are not in ledger
         chain.callReadOnlyFn("vault", "get-ledger-entry", [], wallet_1).result.expectSome().expectUint(0);

        // but user 2 still has 1 stack left
        chain.callReadOnlyFn("vault", "get-ledger-entry", [], wallet_2).result.expectSome().expectUint(1000000);
}})
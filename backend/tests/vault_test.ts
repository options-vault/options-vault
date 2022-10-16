import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v1.0.2/index.ts';
import { assert, assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';
import { createTwoDepositorsAndProcess, submitPriceData, initFirstAuction, redstoneDataOneMinApart, CreateAlreadyActiveAndMintingAuction } from "./init.ts"
const vaultContract = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.vault";
import { testConfig, createMintingAuction } from './init.ts';

const errorCodes = {
    INVALID_AMOUNT : 100,
    VAULT_NOT_ALLOWED : 101,
    INSUFFICIENT_FUNDS : 102,
    TX_SENDER_NOT_IN_LEDGER : 103,
    ONLY_CONTRACT_ALLOWED : 104,
    TX_NOT_APPLIED_YET : 105,
    PREMIUM_NOT_SPLITTED_CORRECTLY : 106,
}

Clarinet.test({
    name: "Ensure that users can deposit and their funds are processed",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
		const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;
        let block = createTwoDepositorsAndProcess(chain, accounts)

        block.receipts[0].events.expectSTXTransferEvent(1000000, wallet_1, vaultContract)
        block.receipts[1].events.expectSTXTransferEvent(2000000, wallet_2, vaultContract)
        block.receipts[2].result.expectOk();

        // total-balances has to equals to u1000000 or 1 STX
        chain.callReadOnlyFn('vault', 'get-total-balances', [], deployer).result.expectUint(3000000);
    },
});

Clarinet.test({
    name: "Ensure that non user cannot withdraw",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_3 = accounts.get('wallet_3')!.address;

        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_3),
        ])
        console.log(block.receipts[0])
        // ERR TX_SENDER_NOT_IN_LEDGER
        block.receipts[0].result.expectErr().expectUint(errorCodes.TX_SENDER_NOT_IN_LEDGER)
}})

Clarinet.test({
    name: "Ensure that user can withdraw their whole account",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_1 = accounts.get('wallet_1')!.address;

        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_1),

        ])
        block.receipts[0].result.expectOk()
}})

Clarinet.test({
    name: "Ensure that user can withdraw part of their account",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_2 = accounts.get('wallet_2')!.address;

        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_2),
        ])
        block.receipts[0].result.expectOk()
}})

Clarinet.test({
    name: "Ensure that user cannot withdraw more than their accounts worth of stacks",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_2 = accounts.get('wallet_2')!.address;

        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(2000001)], wallet_2),
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(2000000)], wallet_2),
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1)], wallet_2)

        ])
        block.receipts[0].result.expectErr().expectUint(errorCodes.INSUFFICIENT_FUNDS)
        block.receipts[1].result.expectOk()
        block.receipts[2].result.expectErr().expectUint(errorCodes.INSUFFICIENT_FUNDS)

}})

Clarinet.test({
    name: "Ensure that pending withdrawals are actualised correctly",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_1 = accounts.get('wallet_1')!.address;
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
		const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;

        let block = createTwoDepositorsAndProcess(chain, accounts)

        // expect wallet 1 has 1 stack, wallet 2 has 2 in ledger
        chain.callReadOnlyFn("vault", "get-ledger-entry", [ types.principal(wallet_1) ], wallet_1).result.expectSome().expectUint(1000000);
        chain.callReadOnlyFn("vault", "get-ledger-entry", [ types.principal(wallet_2) ], wallet_2).result.expectSome().expectUint(2000000);

}})

Clarinet.test({
    name: "Ensure that ledger entry is set correctly during withdrawals",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;

        let block = createTwoDepositorsAndProcess(chain, accounts);

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [ types.uint(1000000) ], wallet_1),
            Tx.contractCall("vault", "process-withdrawals", [], deployer),
        ])

        // user 1 has withdrawn their whole account already, expect they are not in ledger
        chain.callReadOnlyFn("vault", "get-ledger-entry", [ types.principal(wallet_1) ], wallet_1).result.expectNone();

        // but user 2 still has their 2 stacks
        chain.callReadOnlyFn("vault", "get-ledger-entry", [ types.principal(wallet_2) ], wallet_2).result.expectSome().expectUint(2000000);
}})

Clarinet.test({
    name: "Ensure that the two users can queue withdrawal on same block as process withdrawals",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;

        let block = createTwoDepositorsAndProcess(chain, accounts)

        block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_1),
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_2),
            Tx.contractCall("vault", "process-withdrawals", [], wallet_1),
        ])

        // TODO find out why result of get-ledger-entry is just a number, not a whole object with pending etc

        // user 1 has withdrawn their whole account already, expect they are not in ledger
        chain.callReadOnlyFn("vault", "get-ledger-entry", [ types.principal(wallet_1) ], wallet_1).result.expectNone();

        // but user 2 still has 1 stack left
        chain.callReadOnlyFn("vault", "get-ledger-entry", [ types.principal(wallet_2) ], wallet_2).result.expectSome().expectUint(1000000);

        // total-balances has to equals to u1000000 or 1 STX
        chain.callReadOnlyFn('vault', 'get-total-balances', [], deployer).result.expectUint(1000000);
}})


Clarinet.test({
    name: "Ensure that deposit must be valid amount",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_1 = accounts.get('wallet_1')!.address;

        let block = chain.mineBlock([
            Tx.contractCall("vault", "queue-deposit", [types.uint(0)], wallet_1),
        ])

        // ERR INVALID AMOUNT
        block.receipts[0].result.expectErr().expectUint(errorCodes.INVALID_AMOUNT)
}})


Clarinet.test({
    name: "Ensure that distribute pnl can only be called during the right time",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_1 = accounts.get('wallet_1')!.address;

        let block = chain.mineBlock([
            Tx.contractCall("vault", "distribute-pnl", [ types.bool(true) ], wallet_1),
        ])

        // console.log(block.receipts[0])

        // ERR TX NOT APPLIED YET
        block.receipts[0].result.expectErr().expectUint(errorCodes.TX_NOT_APPLIED_YET);
    }
})

Clarinet.test({
    name: "Ensure that we can complete a whole cycle of deposit, inti auction(mint), claim, distribute-pnl",
    fn(chain: Chain, accounts: Map<string, Account>) {
        // depositors
		let block = createMintingAuction(chain, accounts)

    }
})

// Test deposit-premium
// Test distribute-pnl
// Test create-settlement-pool

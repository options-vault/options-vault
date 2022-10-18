import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v1.0.2/index.ts';
import { assert, assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';
import { createTwoDepositorsAndProcess, submitPriceData, initFirstAuction, redstoneDataOneMinApart } from "./init.ts"
const vaultContract = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.vault";
import { testConfig } from './init.ts';

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
    name: "Ensure that distribute-pnl function adds the correct yield to each investor's balance if the pnl is 0",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;
        const wallet_3 = accounts.get('wallet_3')!.address;

        let block = createTwoDepositorsAndProcess(chain, accounts);

        block = chain.mineBlock([
            Tx.contractCall(
                'vault',
                'deposit-premium',
                [ types.uint(500000), types.principal(wallet_3) ],
                wallet_3
            ),
            Tx.contractCall(
                'vault',
                'queue-deposit',
                [ types.uint(1000000) ],
                wallet_1
            ),
            Tx.contractCall(
                'vault',
                'process-deposits',
                [],
                deployer
            ),
            Tx.contractCall(
                "vault", 
                "distribute-pnl",
                [ types.bool(false) ], 
                deployer
            )
        ])
   
        chain.callReadOnlyFn(
            "vault", 
            "get-ledger-entry", 
            [ types.principal(wallet_1) ], 
            wallet_1
        ).result.expectSome().expectUint(2250000);

        chain.callReadOnlyFn(
            "vault", 
            "get-ledger-entry", 
            [ types.principal(wallet_2) ], 
            wallet_2
        ).result.expectSome().expectUint(2250000);
        
        chain.callReadOnlyFn(
            "vault", 
            "get-total-balances", 
            [], 
            deployer
        ).result.expectUint(4500000);
    }
})

Clarinet.test({
    name: "Ensure that distribute-pnl function adds the correct amount to each investor's balance if there is pnl for case 2 (user 1 and 2 receive yield)",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;
        const wallet_3 = accounts.get('wallet_3')!.address;
        const vault = `${deployer}.vault`;
        const optionsNft = `${deployer}.options-nft`;

        let block = createTwoDepositorsAndProcess(chain, accounts);

        block = chain.mineBlock([
            Tx.contractCall(
                'vault',
                'deposit-premium',
                [ types.uint(500000), types.principal(wallet_3) ],
                wallet_3
            ),
            Tx.contractCall(
                'vault',
                'queue-deposit',
                [ types.uint(1000000) ],
                wallet_1
            ),
            Tx.contractCall(
                'vault',
                'process-deposits',
                [],
                deployer
            ),
            Tx.contractCall(
                'vault',
                'create-settlement-pool',
                [ types.uint(300000), types.principal(optionsNft)],
                deployer
            )
        ])

        // checks if the create-settlement-pool works
        block.receipts[3].events.expectSTXTransferEvent(300000, vault, optionsNft);

        block = chain.mineBlock([
            Tx.contractCall(
                "vault", 
                "distribute-pnl",
                [ types.bool(false) ], 
                deployer
            )
        ])

        chain.callReadOnlyFn(
            "vault", 
            "get-ledger-entry", 
            [ types.principal(wallet_1) ], 
            wallet_1
        ).result.expectSome().expectUint(2100000);

        chain.callReadOnlyFn(
            "vault", 
            "get-ledger-entry", 
            [ types.principal(wallet_2) ], 
            wallet_2
        ).result.expectSome().expectUint(2100000);
        
        chain.callReadOnlyFn(
            "vault", 
            "get-total-balances", 
            [], 
            deployer
        ).result.expectUint(4200000);
    }
})

Clarinet.test({
    name: "Ensure that distribute-pnl function substracts the correct amount to each investor's balance if there is pnl for case 3 (user 1 losses and user 2 receives yield)",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;
        const wallet_3 = accounts.get('wallet_3')!.address;
        const vault = `${deployer}.vault`;
        const optionsNft = `${deployer}.options-nft`;

        let block = createTwoDepositorsAndProcess(chain, accounts);

        block = chain.mineBlock([
            Tx.contractCall(
                'vault',
                'deposit-premium',
                [ types.uint(500000), types.principal(wallet_3) ],
                wallet_3
            ),
            Tx.contractCall(
                'vault',
                'queue-deposit',
                [ types.uint(1000000) ],
                wallet_1
            ),
            Tx.contractCall(
                'vault',
                'process-deposits',
                [],
                deployer
            ),
            Tx.contractCall(
                'vault',
                'create-settlement-pool',
                [ types.uint(700000), types.principal(optionsNft)],
                deployer
            )
        ])

        // checks if the create-settlement-pool works
        block.receipts[3].events.expectSTXTransferEvent(700000, vault, optionsNft);

        block = chain.mineBlock([
            Tx.contractCall(
                "vault", 
                "distribute-pnl",
                [ types.bool(false) ], 
                deployer
            )
        ])

        chain.callReadOnlyFn(
            "vault", 
            "get-ledger-entry", 
            [ types.principal(wallet_1) ], 
            wallet_1
        ).result.expectSome().expectUint(1900000);

        chain.callReadOnlyFn(
            "vault", 
            "get-ledger-entry", 
            [ types.principal(wallet_2) ], 
            wallet_2
        ).result.expectSome().expectUint(1900000);
        
        chain.callReadOnlyFn(
            "vault", 
            "get-total-balances", 
            [], 
            deployer
        ).result.expectUint(3800000);
    }
})

Clarinet.test({
    name: "Ensure that create-settlement-pool function transfers an amount form vault to options-nft contract",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const vault = `${deployer}.vault`;
        const optionsNft = `${deployer}.options-nft`;

		let block = createTwoDepositorsAndProcess(chain, accounts);

        block = chain.mineBlock([
            Tx.contractCall(
                'vault',
                'create-settlement-pool',
                [ types.uint(500000), types.principal(optionsNft)],
                deployer
            )
        ])

        // checks if the create-settlement-pool works
        block.receipts[0].events.expectSTXTransferEvent(500000, vault, optionsNft);
    }
})

Clarinet.test({
    name: "Ensure to withdraw just the balance amount if there is less than the pending withdrawal amount after distributing pnl",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;
        const wallet_3 = accounts.get('wallet_3')!.address;
        // const wallet_4 = accounts.get('wallet_4')!.address;
        const vault = `${deployer}.vault`;
        const optionsNft = `${deployer}.options-nft`;

        let block = createTwoDepositorsAndProcess(chain, accounts);

        block = chain.mineBlock([
            Tx.contractCall(
                'vault',
                'deposit-premium',
                [ types.uint(500000), types.principal(wallet_3) ],
                wallet_3
            ),
            Tx.contractCall(
                'vault',
                'queue-deposit',
                [ types.uint(1000000) ],
                wallet_1
            ),
            Tx.contractCall(
                'vault',
                'process-deposits',
                [],
                deployer
            ),
            Tx.contractCall(
                'vault',
                'create-settlement-pool',
                [ types.uint(700000), types.principal(optionsNft)],
                deployer
            )
        ])

        block = chain.mineBlock([
            Tx.contractCall(
                'vault',
                'queue-withdrawal',
                [ types.uint(2000000) ],
                wallet_1
            ),
            Tx.contractCall(
                "vault", 
                "distribute-pnl",
                [ types.bool(false) ], 
                deployer
            ),
            Tx.contractCall(
                "vault", 
                "process-withdrawals",
                [], 
                deployer
            )
        ])
        
        chain.callReadOnlyFn(
            "vault", 
            "get-ledger-entry", 
            [ types.principal(wallet_1) ], 
            wallet_1
        ).result.expectNone();

        chain.callReadOnlyFn(
            "vault", 
            "get-ledger-entry", 
            [ types.principal(wallet_2) ], 
            wallet_2
        ).result.expectSome().expectUint(1900000);
        
        chain.callReadOnlyFn(
            "vault", 
            "get-total-balances", 
            [], 
            deployer
        ).result.expectUint(1900000);
    }
});

Clarinet.test({
    name: "Ensure that create-settlement-pool function only accepts valid amouunts",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const vault = `${deployer}.vault`;
        const optionsNft = `${deployer}.options-nft`;

		let block = createTwoDepositorsAndProcess(chain, accounts);

        block = chain.mineBlock([
            Tx.contractCall(
                'vault',
                'create-settlement-pool',
                [ types.uint(0), types.principal(optionsNft)],
                deployer
            )
        ])

        // checks if the create-settlement-pool works
        block.receipts[0].result.expectErr().expectUint(errorCodes.INVALID_AMOUNT)
    }
});


// Test deposit-premium
// Test distribute-pnl
// Test create-settlement-pool

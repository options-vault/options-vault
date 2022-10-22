import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v1.0.4/index.ts';
import { assert, assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';
import { simulateTwoDepositsAndProcess, submitPriceData, initFirstAuction, redstoneDataOneMinApart } from "./init.ts"
const vaultContract = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.vault";
import { testConfig } from './init.ts';

const errorCodes = {
    ERR_INVALID_AMOUNT : 100,
    ERR_VAULT_NOT_ALLOWED : 101,
    ERR_INSUFFICIENT_FUNDS : 102,
    ERR_TX_SENDER_NOT_IN_LEDGER : 103,
    ERR_ONLY_CONTRACT_ALLOWED : 104,
    ERR_TX_NOT_APPLIED_YET : 105,
    ERR_PREMIUM_NOT_SPLITTED_CORRECTLY : 106,
}

Clarinet.test({
    name: "Ensure that users can deposit and their funds are processed",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
		const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;
        let block = simulateTwoDepositsAndProcess(chain, accounts)

        block.receipts[0].events.expectSTXTransferEvent(1000000, wallet_1, vaultContract)
        block.receipts[1].events.expectSTXTransferEvent(2000000, wallet_2, vaultContract)
        block.receipts[2].result.expectOk();

        chain.callReadOnlyFn('vault', 'get-total-balances', [], deployer).result.expectUint(3000000);
    },
});

Clarinet.test({
    name: "Ensure that a user that has not deposited can not withdraw",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_3 = accounts.get('wallet_3')!.address;

        simulateTwoDepositsAndProcess(chain, accounts)

        const block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_3),
        ])
        block.receipts[0].result.expectErr().expectUint(errorCodes.ERR_TX_SENDER_NOT_IN_LEDGER)
}})

Clarinet.test({
    name: "Ensure that a depositor can withdraw their whole balance",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_1 = accounts.get('wallet_1')!.address;

        simulateTwoDepositsAndProcess(chain, accounts)

        const block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_1),
        ])
        block.receipts[0].result.expectOk()
}})

Clarinet.test({
    name: "Ensure that a depositor can withdraw a part of their balance",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_2 = accounts.get('wallet_2')!.address;

        simulateTwoDepositsAndProcess(chain, accounts)

        const block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_2),
        ])  
        block.receipts[0].result.expectOk()
}})

Clarinet.test({
    name: "Ensure that a depositor can not withdraw more than their balance",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_2 = accounts.get('wallet_2')!.address;

        simulateTwoDepositsAndProcess(chain, accounts)

        const block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(2000001)], wallet_2),
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(2000000)], wallet_2),
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1)], wallet_2)

        ])
        block.receipts[0].result.expectErr().expectUint(errorCodes.ERR_INSUFFICIENT_FUNDS)
        block.receipts[1].result.expectOk()
        block.receipts[2].result.expectErr().expectUint(errorCodes.ERR_INSUFFICIENT_FUNDS)
}})

Clarinet.test({
    name: "Ensure that pending withdrawals are processed correctly",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_1 = accounts.get('wallet_1')!.address;
        
        simulateTwoDepositsAndProcess(chain, accounts)

        const block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_1),
            Tx.contractCall("options-nft", "process-withdrawals-from-options", [], wallet_1)
        ])
        block.receipts[0].result.expectOk()
        block.receipts[1].events.expectSTXTransferEvent(1000000, vaultContract, wallet_1)
}})

Clarinet.test({
    name: "Ensure that the ledger entry is set correctly during deposits",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;

        simulateTwoDepositsAndProcess(chain, accounts)

        // expect wallet 1 has 1 stack, wallet 2 has 2 in ledger
        chain.callReadOnlyFn("vault", "get-investor-balance", [ types.principal(wallet_1) ], wallet_1).result.expectSome().expectUint(1000000);
        chain.callReadOnlyFn("vault", "get-investor-balance", [ types.principal(wallet_2) ], wallet_2).result.expectSome().expectUint(2000000);

}})

Clarinet.test({
    name: "Ensure that the ledger entry is set correctly during withdrawals",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;

        simulateTwoDepositsAndProcess(chain, accounts);

        let block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [ types.uint(1000000) ], wallet_1),
            Tx.contractCall("options-nft", "process-withdrawals-from-options", [], deployer),
        ])

        // user 1 has withdrawn their whole account already, expect they are not in ledger
        chain.callReadOnlyFn("vault", "get-investor-balance", [ types.principal(wallet_1) ], wallet_1).result.expectNone();

        // but user 2 still has their 2 stacks
        chain.callReadOnlyFn("vault", "get-investor-balance", [ types.principal(wallet_2) ], wallet_2).result.expectSome().expectUint(2000000);
}})

Clarinet.test({
    name: "Ensure that the two users can queue withdrawals on the same block as process-withdrawals is executed",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;

        simulateTwoDepositsAndProcess(chain, accounts)

        const block = chain.mineBlock([
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_1),
            Tx.contractCall("vault", "queue-withdrawal", [types.uint(1000000)], wallet_2),
            Tx.contractCall("options-nft", "process-withdrawals-from-options", [], wallet_1),
        ])

        // user 1 has withdrawn their whole account already, expect they are not in ledger
        chain.callReadOnlyFn("vault", "get-investor-balance", [ types.principal(wallet_1) ], wallet_1).result.expectNone();

        // but user 2 still has 1 stack left
        chain.callReadOnlyFn("vault", "get-investor-balance", [ types.principal(wallet_2) ], wallet_2).result.expectSome().expectUint(1000000);

        // total-balances has to equals to u1000000 or 1 STX
        chain.callReadOnlyFn('vault', 'get-total-balances', [], deployer).result.expectUint(1000000);
}})


Clarinet.test({
    name: "Ensure that deposits must have a valid amount",
    fn(chain: Chain, accounts: Map<string, Account>) {
		const wallet_1 = accounts.get('wallet_1')!.address;

        let block = chain.mineBlock([
            Tx.contractCall("vault", "queue-deposit", [types.uint(0)], wallet_1),
        ])

        // ERR INVALID AMOUNT
        block.receipts[0].result.expectErr().expectUint(errorCodes.ERR_INVALID_AMOUNT)
}})

Clarinet.test({
    name: "Ensure that distribute-pnl correctly adds the premium from selling options-nfts to each investor's balance if the pnl is zero",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;
        const wallet_3 = accounts.get('wallet_3')!.address;

        simulateTwoDepositsAndProcess(chain, accounts);

        const block = chain.mineBlock([
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
                'options-nft',
                'process-deposits-from-options',
                [],
                deployer
            ),
            Tx.contractCall(
                "options-nft", 
                "distribute-pnl-from-options",
                [], 
                deployer
            )
        ])
   
        chain.callReadOnlyFn(
            "vault", 
            "get-investor-balance", 
            [ types.principal(wallet_1) ], 
            wallet_1
        ).result.expectSome().expectUint(2250000);

        chain.callReadOnlyFn(
            "vault", 
            "get-investor-balance", 
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

        simulateTwoDepositsAndProcess(chain, accounts);

        let block = chain.mineBlock([
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
                'options-nft',
                'process-deposits-from-options',
                [],
                deployer
            ),
            Tx.contractCall(
                'options-nft',
                'create-settlement-pool-from-options',
                [ types.uint(300000) ],
                deployer
            )
        ])

        block = chain.mineBlock([
            Tx.contractCall(
                "options-nft", 
                "distribute-pnl-from-options",
                [], 
                deployer
            )
        ])

        chain.callReadOnlyFn(
            "vault", 
            "get-investor-balance", 
            [ types.principal(wallet_1) ], 
            wallet_1
        ).result.expectSome().expectUint(2100000);

        chain.callReadOnlyFn(
            "vault", 
            "get-investor-balance", 
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
    name: "Ensure that distribute-pnl function subtracts the correct amount from each investor's balance if there is pnl for case 3 (user 1 incurs loss and user 2 receives yield)",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;
        const wallet_3 = accounts.get('wallet_3')!.address;
        const vault = `${deployer}.vault`;
        const optionsNft = `${deployer}.options-nft`;

        simulateTwoDepositsAndProcess(chain, accounts);

        let block = chain.mineBlock([
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
                'options-nft',
                'process-deposits-from-options',
                [],
                deployer
            ),
            Tx.contractCall(
                'options-nft',
                'create-settlement-pool-from-options',
                [ types.uint(700000) ],
                deployer
            )
        ])

        block = chain.mineBlock([
            Tx.contractCall(
                "options-nft", 
                "distribute-pnl-from-options",
                [], 
                deployer
            )
        ])

        chain.callReadOnlyFn(
            "vault", 
            "get-investor-balance", 
            [ types.principal(wallet_1) ], 
            wallet_1
        ).result.expectSome().expectUint(1900000);

        chain.callReadOnlyFn(
            "vault", 
            "get-investor-balance", 
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
    name: "Ensure that create-settlement-pool correctly sets the amount sent to total-settlement-pool",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;

		simulateTwoDepositsAndProcess(chain, accounts);

        const block = chain.mineBlock([
            Tx.contractCall(
                'options-nft',
                'create-settlement-pool-from-options',
                [ types.uint(500000) ],
                deployer
            )
        ])
        // checks if the create-settlement-pool works
        chain.callReadOnlyFn(
            "vault", 
            "get-total-settlement-pool", 
            [], 
            deployer
        ).result.expectUint(500000);
    }
})

Clarinet.test({
    name: "Ensure that  process-withdrawals only withdrawas the balance amount in case pending-withdrawal is less than the investor's balance after distributing pnl has run",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
		const wallet_2 = accounts.get('wallet_2')!.address;
        const wallet_3 = accounts.get('wallet_3')!.address;

        simulateTwoDepositsAndProcess(chain, accounts);

        let block = chain.mineBlock([
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
                'options-nft',
                'process-deposits-from-options',
                [],
                deployer
            ),
            Tx.contractCall(
                'options-nft',
                'create-settlement-pool-from-options',
                [ types.uint(700000) ],
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
                "options-nft", 
                "distribute-pnl-from-options",
                [], 
                deployer
            ),
            Tx.contractCall(
                "options-nft", 
                "process-withdrawals-from-options",
                [], 
                deployer
            )
        ])
        
        chain.callReadOnlyFn(
            "vault", 
            "get-investor-balance", 
            [ types.principal(wallet_1) ], 
            wallet_1
        ).result.expectNone();

        chain.callReadOnlyFn(
            "vault", 
            "get-investor-balance", 
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
    name: "Ensure that create-settlement-pool only accepts valid amounts",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const optionsNft = `${deployer}.options-nft`;

		simulateTwoDepositsAndProcess(chain, accounts);

        const block = chain.mineBlock([
            Tx.contractCall(
                'options-nft',
                'create-settlement-pool-from-options',
                [ types.uint(0) ],
                deployer
            )
        ])

        // checks if the create-settlement-pool works
        block.receipts[0].result.expectErr().expectUint(errorCodes.ERR_INVALID_AMOUNT)
    }
});

Clarinet.test({
    name: "Ensure that the premium is transferred correctly from user 2 to the vault",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
        const vault = `${deployer}.vault`;

        let block = chain.mineBlock([
            Tx.contractCall(
                'vault',
                'deposit-premium',
                [ types.uint(5000000), types.principal(wallet_1)],
                wallet_1
            )
        ])

        // checks if the deposit-premium function works
        block.receipts[0].result.expectOk().expectBool(true);
        block.receipts[0].events.expectSTXTransferEvent(5000000, wallet_1, vault);
    }
});

Clarinet.test({
    name: "Ensure that the vault cannot deposit premium to itself",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const vault = `${deployer}.vault`;

        let block = chain.mineBlock([
            Tx.contractCall(
                'vault',
                'deposit-premium',
                [ types.uint(5000000), types.principal(vault)],
                deployer
            )
        ])

        // checks if the deposit-premium function works
        block.receipts[0].result.expectErr().expectUint(errorCodes.ERR_VAULT_NOT_ALLOWED);
    }
});

Clarinet.test({
    name: "Ensure that deposit-premium only accepts valid amounts",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;

        let block = chain.mineBlock([
            Tx.contractCall(
                'vault',
                'deposit-premium',
                [ types.uint(0), types.principal(wallet_1)],
                wallet_1
            )
        ])

        // checks if the deposit-premium function works
        block.receipts[0].result.expectErr().expectUint(errorCodes.ERR_INVALID_AMOUNT);
    }
});

Clarinet.test({
    name: "Ensure that the vault transfers settlement amount to the user who claims it",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
        const vault = `${deployer}.vault`;

        simulateTwoDepositsAndProcess(chain, accounts);

        const block = chain.mineBlock([
            Tx.contractCall(
                'options-nft',
                'create-settlement-pool-from-options',
                [ types.uint(1000000) ],
                deployer
            ),
            Tx.contractCall(
                'options-nft',
                'claim-settlement-from-options',
                [ types.uint(500000), types.principal(wallet_1) ],
                deployer
            )
        ])

        chain.callReadOnlyFn(
            "vault", 
            "get-total-settlement-pool", 
            [], 
            deployer
        ).result.expectUint(500000);

        // checks if claim was successful
        block.receipts[1].events.expectSTXTransferEvent(500000, vault, wallet_1);
    }
});

Clarinet.test({
    name: "Ensure that the vault does NOT make a transfer when a settlement transaction tries to transfer more than the vault balance",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;
        const vault = `${deployer}.vault`;

        const block = chain.mineBlock([
            Tx.contractCall(
                'options-nft',
                'create-settlement-pool-from-options',
                [ types.uint(1000000) ],
                deployer
            ),
            Tx.contractCall(
                'options-nft',
                'claim-settlement-from-options',
                [ types.uint(500000), types.principal(wallet_1) ],
                deployer
            )
        ])

        // checks if claim crashes
        block.receipts[1].result.expectErr().expectUint(108);
    }
});

Clarinet.test({
    name: "Ensure that the vault does NOT make a transfer when a settlement transaction tries to transfer more than the settlement-pool balance",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;

        const block = chain.mineBlock([
            Tx.contractCall(
                'options-nft',
                'create-settlement-pool-from-options',
                [ types.uint(1000000) ],
                deployer
            ),
            Tx.contractCall(
                'options-nft',
                'claim-settlement-from-options',
                [ types.uint(5000000), types.principal(wallet_1) ],
                deployer
            )
        ])
        
        // checks if claim crashes
        block.receipts[1].result.expectErr().expectUint(107);
    }
});

Clarinet.test({
    name: "Ensure that claim only works with valid amounts",
    fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!.address;
        const wallet_1 = accounts.get('wallet_1')!.address;

        const block = chain.mineBlock([
            Tx.contractCall(
                'options-nft',
                'create-settlement-pool-from-options',
                [ types.uint(1000000) ],
                deployer
            ),
            Tx.contractCall(
                'options-nft',
                'claim-settlement-from-options',
                [ types.uint(0), types.principal(wallet_1) ],
                deployer
            )
        ])
        
        // checks if claim crashes
        block.receipts[1].result.expectErr().expectUint(100);
    }
});
